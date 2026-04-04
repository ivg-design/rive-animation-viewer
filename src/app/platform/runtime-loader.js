import {
    CURRENT_CUSTOM_RUNTIME_OPTION_VALUE,
    DEFAULT_RUNTIME_VERSION,
    DEFAULT_RUNTIME_VERSION_TOKEN,
    FALLBACK_RUNTIME_VERSION_OPTIONS,
    MIN_SCRIPTING_RUNTIME_VERSION,
    RUNTIME_CACHE_NAME,
    RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY,
    RUNTIME_META_STORAGE_KEY,
    RUNTIME_VERSION_DISCOVERY_URL,
    RUNTIME_VERSION_OPTION_COUNT,
    RUNTIME_VERSION_PREF_STORAGE_KEY,
} from '../core/constants.js';
import {
    createRuntimeAssetLoader,
    fetchRuntimeVersionOptions,
    resolveRuntimeSource,
    responseToRuntimeAsset,
} from './runtime/assets.js';
import { createRuntimeVersionPickerController } from './runtime/version-picker.js';
import {
    getEffectiveRuntimeVersionToken as resolveEffectiveRuntimeVersionToken,
    getRuntimeCacheKey as buildRuntimeCacheKey,
    getRuntimeSourceUrl as buildRuntimeSourceUrl,
    isSemverAtLeast,
    normalizeFileRuntimePreferenceId,
    normalizeRuntimeVersionToken,
} from './runtime-utils.js';

export { fetchRuntimeVersionOptions, resolveRuntimeSource, responseToRuntimeAsset } from './runtime/assets.js';

export function createRuntimeLoaderController({
    elements,
    state,
    callbacks = {},
    documentRef = globalThis.document,
    windowRef = globalThis,
    storage = globalThis.localStorage,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    cachesRef = globalThis.caches,
    urlApi = globalThis.URL,
    blobCtor = globalThis.Blob,
    logger = console,
} = {}) {
    const {
        runtimeAssets = {},
        runtimeBlobUrls = {},
        runtimeMeta = {},
        runtimePromises = {},
        runtimeRegistry = {},
        runtimeResolvedUrls = {},
        runtimeSourceTexts = {},
        runtimeVersionByFile = {},
        runtimeVersions = {},
        runtimeVersionOptionsState = {},
        runtimeWarningsShown = new Set(),
        getCurrentFileName = () => null,
        getCurrentFilePreferenceId = () => null,
        getCurrentFileUrl = () => null,
        getCurrentRuntime = () => 'webgl2',
        getRuntimeVersionToken = () => DEFAULT_RUNTIME_VERSION_TOKEN,
        setRuntimeVersionToken = () => {},
    } = state || {};
    const {
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        reloadCurrentAnimation = null,
        refreshInfoStrip = () => {},
        showError = () => {},
        updateVersionInfo = () => {},
    } = callbacks;
    let runtimeVersionMutationId = 0;

    function getEffectiveRuntimeVersionToken(versionToken = getRuntimeVersionToken()) {
        return resolveEffectiveRuntimeVersionToken(versionToken, runtimeVersionOptionsState.latest);
    }

    function getRuntimeCacheKey(runtimeName, versionToken = getRuntimeVersionToken()) {
        return buildRuntimeCacheKey(runtimeName, versionToken, runtimeVersionOptionsState.latest);
    }

    function getRuntimeSourceUrl(runtimeName, versionToken = getRuntimeVersionToken()) {
        return buildRuntimeSourceUrl(runtimeName, versionToken, runtimeVersionOptionsState.latest);
    }

    function getCurrentRuntimeCacheKey(runtimeName = getCurrentRuntime()) {
        return getRuntimeCacheKey(runtimeName, getRuntimeVersionToken());
    }

    function getCurrentRuntimeVersion(runtimeName = getCurrentRuntime()) {
        const key = getCurrentRuntimeCacheKey(runtimeName);
        return runtimeVersions[key] || runtimeRegistry[key]?.version || null;
    }

    function getCurrentRuntimeSource(runtimeName = getCurrentRuntime()) {
        const key = getCurrentRuntimeCacheKey(runtimeName);
        return runtimeResolvedUrls[key] || getRuntimeSourceUrl(runtimeName);
    }

    function getLoadedRuntime(runtimeName = getCurrentRuntime()) {
        return runtimeRegistry[getCurrentRuntimeCacheKey(runtimeName)] || null;
    }

    function getRuntimeAsset(runtimeName = getCurrentRuntime()) {
        return runtimeAssets[getRuntimeCacheKey(runtimeName)] || null;
    }

    function getRuntimeSourceText(runtimeName = getCurrentRuntime()) {
        return runtimeSourceTexts[getRuntimeCacheKey(runtimeName)] || null;
    }

    function getRuntimeVersion(runtimeName = getCurrentRuntime()) {
        return runtimeVersions[getRuntimeCacheKey(runtimeName)] || null;
    }

    function persistRuntimeVersionPreference() {
        try {
            storage.setItem(
                RUNTIME_VERSION_PREF_STORAGE_KEY,
                normalizeRuntimeVersionToken(getRuntimeVersionToken()),
            );
        } catch {
            /* ignore storage errors */
        }
    }

    function persistRuntimeVersionByFile() {
        try {
            storage.setItem(
                RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY,
                JSON.stringify(runtimeVersionByFile),
            );
        } catch {
            /* ignore storage errors */
        }
    }

    function getStoredRuntimeVersionForCurrentFile() {
        const prefId = normalizeFileRuntimePreferenceId(getCurrentFilePreferenceId());
        if (!prefId) {
            return null;
        }
        return runtimeVersionByFile[prefId] || null;
    }

    function persistRuntimeVersionForCurrentFile(versionToken = getRuntimeVersionToken()) {
        const prefId = normalizeFileRuntimePreferenceId(getCurrentFilePreferenceId());
        if (!prefId) {
            return;
        }
        runtimeVersionByFile[prefId] = normalizeRuntimeVersionToken(versionToken);
        persistRuntimeVersionByFile();
    }

    async function applyStoredRuntimeVersionForCurrentFile() {
        const storedToken = getStoredRuntimeVersionForCurrentFile();
        if (!storedToken) {
            return;
        }
        await applyRuntimeVersionToken(storedToken, {
            reloadAnimation: false,
            source: 'file-pref',
        });
        renderRuntimeVersionPickerOptions();
    }

    function clearRuntimeInMemoryCaches() {
        Object.keys(runtimePromises).forEach((key) => {
            delete runtimePromises[key];
        });
        Object.keys(runtimeRegistry).forEach((key) => {
            delete runtimeRegistry[key];
        });
        Object.keys(runtimeVersions).forEach((key) => {
            delete runtimeVersions[key];
        });
        Object.keys(runtimeResolvedUrls).forEach((key) => {
            delete runtimeResolvedUrls[key];
        });
        Object.keys(runtimeSourceTexts).forEach((key) => {
            delete runtimeSourceTexts[key];
        });
        Object.keys(runtimeAssets).forEach((key) => {
            delete runtimeAssets[key];
        });
        Object.keys(runtimeBlobUrls).forEach((key) => {
            const url = runtimeBlobUrls[key];
            if (url) {
                urlApi.revokeObjectURL(url);
            }
            delete runtimeBlobUrls[key];
        });
    }

    function setRuntimeVersionCustomVisibility(visible) {
        if (!elements?.runtimeVersionCustomRow) {
            return;
        }
        elements.runtimeVersionCustomRow.hidden = !visible;
    }

    function renderRuntimeVersionPickerOptions() {
        const select = elements?.runtimeVersionSelect;
        if (!select) {
            return;
        }
        const { latest, versions } = runtimeVersionOptionsState;
        const selectedToken = normalizeRuntimeVersionToken(getRuntimeVersionToken());
        const matchesKnownOption = selectedToken === DEFAULT_RUNTIME_VERSION_TOKEN || versions.includes(selectedToken);
        select.replaceChildren();
        const appendOption = (value, label) => {
            const option = documentRef.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        };
        appendOption(DEFAULT_RUNTIME_VERSION_TOKEN, `Latest (auto: ${latest})`);
        versions.forEach((version) => appendOption(version, version));
        if (!matchesKnownOption) {
            appendOption(CURRENT_CUSTOM_RUNTIME_OPTION_VALUE, `Current: ${selectedToken}`);
        }
        appendOption('custom', 'Custom');

        if (matchesKnownOption) {
            select.value = selectedToken;
        } else {
            select.value = CURRENT_CUSTOM_RUNTIME_OPTION_VALUE;
        }
        setRuntimeVersionCustomVisibility(false);
        if (elements.runtimeVersionCustomInput) {
            elements.runtimeVersionCustomInput.value = '';
        }
    }

    async function applyRuntimeVersionToken(nextToken, { reloadAnimation = true, source = 'settings' } = {}) {
        const mutationId = ++runtimeVersionMutationId;
        const normalizedCurrent = normalizeRuntimeVersionToken(getRuntimeVersionToken());
        const normalizedNext = normalizeRuntimeVersionToken(nextToken);
        const effectiveCurrent = getEffectiveRuntimeVersionToken(normalizedCurrent);
        const effectiveNext = getEffectiveRuntimeVersionToken(normalizedNext);
        if (normalizedNext === normalizedCurrent && effectiveNext === effectiveCurrent) {
            return;
        }

        setRuntimeVersionToken(normalizedNext);
        persistRuntimeVersionPreference();
        persistRuntimeVersionForCurrentFile(normalizedNext);
        clearRuntimeInMemoryCaches();
        updateVersionInfo('Loading runtime...');
        refreshInfoStrip();
        logEvent(
            'ui',
            'runtime-version',
            `Runtime version set to ${getRuntimeVersionToken()} -> ${getEffectiveRuntimeVersionToken(getRuntimeVersionToken())} (${source}).`,
        );

        try {
            await ensureRuntime(getCurrentRuntime());
            if (mutationId !== runtimeVersionMutationId) {
                return;
            }
            updateVersionInfo();
            if (!reloadAnimation) {
                return;
            }
            if (typeof reloadCurrentAnimation === 'function' && getCurrentFileUrl() && getCurrentFileName()) {
                await reloadCurrentAnimation();
            } else if (getCurrentFileUrl() && getCurrentFileName()) {
                await loadRiveAnimation(getCurrentFileUrl(), getCurrentFileName());
            }
        } catch (error) {
            if (mutationId !== runtimeVersionMutationId) {
                return;
            }
            showError(`Failed to load runtime version ${getRuntimeVersionToken()}: ${error.message}`);
            logEvent(
                'native',
                'runtime-version-load-failed',
                `Failed to load runtime version ${getRuntimeVersionToken()}.`,
                error,
            );
        }
    }

    function persistRuntimeMeta(metaKey, meta) {
        runtimeMeta[metaKey] = meta;
        try {
            storage.setItem(RUNTIME_META_STORAGE_KEY, JSON.stringify(runtimeMeta));
        } catch {
            /* ignore storage errors */
        }
    }

    const runtimeAssetLoader = createRuntimeAssetLoader({
        blobCtor,
        cachesRef,
        documentRef,
        fetchImpl,
        getCurrentRuntime,
        getRuntimeCacheKey,
        getRuntimeSourceUrl,
        logger,
        persistRuntimeMeta,
        runtimeAssets,
        runtimeBlobUrls,
        runtimeMeta,
        runtimePromises,
        runtimeRegistry,
        runtimeResolvedUrls,
        runtimeSourceTexts,
        runtimeVersions,
        updateVersionInfo,
        urlApi,
        windowRef,
    });

    function warnIfRuntimeLacksScripting(runtimeName) {
        const cacheKey = getRuntimeCacheKey(runtimeName);
        const version = runtimeVersions[cacheKey] || runtimeRegistry[cacheKey]?.version;
        if (!version || isSemverAtLeast(version, MIN_SCRIPTING_RUNTIME_VERSION)) {
            return;
        }
        const warningKey = `${runtimeName}@${version}`;
        if (runtimeWarningsShown.has(warningKey)) {
            return;
        }
        runtimeWarningsShown.add(warningKey);
        showError(`Runtime ${runtimeName}@${version} is below ${MIN_SCRIPTING_RUNTIME_VERSION}; VM scripting may be unavailable.`);
    }

    async function ensureRuntime(runtimeName) {
        const runtime = await runtimeAssetLoader.loadRuntime(runtimeName);
        windowRef.rive = runtime;
        warnIfRuntimeLacksScripting(runtimeName);
        if (runtimeName === getCurrentRuntime()) {
            updateVersionInfo();
        }
        return runtime;
    }

    const setupRuntimeVersionPicker = createRuntimeVersionPickerController({
        applyRuntimeVersionToken,
        documentRef,
        elements,
        fetchImpl,
        getRuntimeVersionToken,
        logger,
        renderRuntimeVersionPickerOptions,
        runtimeVersionOptionsState,
        setRuntimeVersionCustomVisibility,
        showError,
    });

    return {
        applyRuntimeVersionToken,
        applyStoredRuntimeVersionForCurrentFile,
        ensureRuntime,
        getCurrentRuntimeSource,
        getCurrentRuntimeVersion,
        getEffectiveRuntimeVersionToken,
        getLoadedRuntime,
        getRuntimeAsset,
        getRuntimeCacheKey,
        getRuntimeSourceText,
        getRuntimeVersion,
        setupRuntimeVersionPicker,
    };
}
