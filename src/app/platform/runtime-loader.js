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
    compareSemverDescending,
    extractVersionFromUrl,
    getEffectiveRuntimeVersionToken as resolveEffectiveRuntimeVersionToken,
    getRuntimeCacheKey as buildRuntimeCacheKey,
    getRuntimeSourceUrl as buildRuntimeSourceUrl,
    isSemverAtLeast,
    normalizeFileRuntimePreferenceId,
    normalizeRuntimeVersionToken,
    parseSemverParts,
} from './runtime-utils.js';

export async function fetchRuntimeVersionOptions({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    discoveryUrl = RUNTIME_VERSION_DISCOVERY_URL,
    defaultRuntimeVersion = DEFAULT_RUNTIME_VERSION,
    optionCount = RUNTIME_VERSION_OPTION_COUNT,
} = {}) {
    const response = await fetchImpl(discoveryUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to fetch runtime versions (${response.status})`);
    }
    const payload = await response.json();
    const versions = Object.keys(payload?.versions || {})
        .filter((version) => parseSemverParts(version))
        .sort(compareSemverDescending);

    const distTagLatest = payload?.['dist-tags']?.latest;
    const latest = parseSemverParts(distTagLatest) ? distTagLatest : (versions[0] || defaultRuntimeVersion);
    const unique = [];
    [latest, ...versions].forEach((version) => {
        if (!version || unique.includes(version)) {
            return;
        }
        unique.push(version);
    });

    return {
        latest,
        versions: unique.slice(0, optionCount),
    };
}

export async function resolveRuntimeSource({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    scriptUrl,
    metaKey,
    runtimeMeta,
    logger = console,
} = {}) {
    try {
        const response = await fetchImpl(scriptUrl, { method: 'HEAD' });
        if (!response.ok) {
            throw new Error(`Failed to resolve runtime version (${response.status})`);
        }
        const resolvedUrl = response.url || scriptUrl;
        const headerVersion = response.headers.get('x-jsd-version') || response.headers.get('x-rv-version');
        return {
            resolvedUrl,
            version: headerVersion || extractVersionFromUrl(resolvedUrl),
        };
    } catch (error) {
        const stored = runtimeMeta?.[metaKey];
        if (stored?.resolvedUrl) {
            logger.warn('Falling back to cached runtime metadata', error);
            return {
                resolvedUrl: stored.resolvedUrl,
                version: stored.version || null,
            };
        }
        logger.warn('Unable to resolve runtime version metadata', error);
        return { resolvedUrl: scriptUrl, version: null };
    }
}

export async function responseToRuntimeAsset(response, {
    blobCtor = globalThis.Blob,
    urlApi = globalThis.URL,
} = {}) {
    let text = await response.clone().text();

    // Strip sourceMappingURL to prevent blob warnings in Tauri/WebKit.
    text = text.replace(/\/\/# sourceMappingURL=.*$/gm, '');

    const blob = new blobCtor([text], { type: 'application/javascript' });
    const objectUrl = urlApi.createObjectURL(blob);
    return { text, objectUrl };
}

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

    async function setupRuntimeVersionPicker() {
        const select = elements?.runtimeVersionSelect;
        if (!select) {
            return;
        }

        select.innerHTML = '<option value="latest">Loading versions…</option>';
        select.disabled = true;

        const applyCustom = async () => {
            const input = elements.runtimeVersionCustomInput;
            const value = String(input?.value || '').trim();
            if (!value) {
                showError('Enter a runtime version before applying custom.');
                return;
            }
            await applyRuntimeVersionToken(value, { source: 'custom' });
            renderRuntimeVersionPickerOptions();
        };

        select.addEventListener('change', async (event) => {
            const selected = event.target.value;
            if (selected === 'custom') {
                setRuntimeVersionCustomVisibility(true);
                elements.runtimeVersionCustomInput?.focus();
                return;
            }
            setRuntimeVersionCustomVisibility(false);
            const tokenToApply = selected === CURRENT_CUSTOM_RUNTIME_OPTION_VALUE
                ? normalizeRuntimeVersionToken(getRuntimeVersionToken())
                : selected;
            await applyRuntimeVersionToken(tokenToApply, { source: 'preset' });
            renderRuntimeVersionPickerOptions();
        });

        elements.runtimeVersionApplyButton?.addEventListener('click', () => {
            applyCustom().catch(() => {
                /* noop */
            });
        });

        elements.runtimeVersionCustomInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyCustom().catch(() => {
                    /* noop */
                });
            }
        });

        try {
            const discovered = await fetchRuntimeVersionOptions({ fetchImpl });
            runtimeVersionOptionsState.latest = discovered.latest || DEFAULT_RUNTIME_VERSION;
            runtimeVersionOptionsState.versions = discovered.versions?.length
                ? discovered.versions
                : [DEFAULT_RUNTIME_VERSION];
        } catch (error) {
            logger.warn('[rive-viewer] failed to discover runtime versions, using fallback list:', error);
            runtimeVersionOptionsState.latest = FALLBACK_RUNTIME_VERSION_OPTIONS[0];
            runtimeVersionOptionsState.versions = FALLBACK_RUNTIME_VERSION_OPTIONS.slice(0, RUNTIME_VERSION_OPTION_COUNT);
        } finally {
            renderRuntimeVersionPickerOptions();
            select.disabled = false;
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

    async function fetchRuntimeAsset(resolvedUrl) {
        if (typeof cachesRef === 'undefined') {
            return fetchRuntimeDirectly(resolvedUrl);
        }

        const cache = await cachesRef.open(RUNTIME_CACHE_NAME);
        let response = await cache.match(resolvedUrl);
        if (!response) {
            response = await fetchRuntimeRequest(resolvedUrl);
            await cache.put(resolvedUrl, response.clone());
        }
        return responseToRuntimeAsset(response, { blobCtor, urlApi });
    }

    async function fetchRuntimeDirectly(resolvedUrl) {
        const response = await fetchRuntimeRequest(resolvedUrl);
        return responseToRuntimeAsset(response, { blobCtor, urlApi });
    }

    async function fetchRuntimeRequest(resolvedUrl) {
        const response = await fetchImpl(resolvedUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to download runtime (${response.status})`);
        }
        return response;
    }

    async function prepareRuntimeAsset(runtimeName) {
        const cacheKey = getRuntimeCacheKey(runtimeName);
        if (runtimeAssets[cacheKey]) {
            return runtimeAssets[cacheKey];
        }

        const scriptUrl = getRuntimeSourceUrl(runtimeName);
        if (!scriptUrl) {
            throw new Error(`Unknown runtime: ${runtimeName}`);
        }

        const { resolvedUrl, version } = await resolveRuntimeSource({
            fetchImpl,
            scriptUrl,
            metaKey: cacheKey,
            runtimeMeta,
            logger,
        });
        const asset = await fetchRuntimeAsset(resolvedUrl);
        const record = {
            objectUrl: asset.objectUrl,
            text: asset.text,
            resolvedUrl,
            version: version || runtimeMeta[cacheKey]?.version || extractVersionFromUrl(resolvedUrl) || 'unknown',
        };

        if (runtimeBlobUrls[cacheKey]) {
            urlApi.revokeObjectURL(runtimeBlobUrls[cacheKey]);
        }

        runtimeBlobUrls[cacheKey] = record.objectUrl;
        runtimeSourceTexts[cacheKey] = record.text;
        runtimeResolvedUrls[cacheKey] = resolvedUrl;
        runtimeVersions[cacheKey] = record.version;
        runtimeAssets[cacheKey] = record;
        persistRuntimeMeta(cacheKey, {
            resolvedUrl,
            version: record.version,
            cachedAt: Date.now(),
        });

        return record;
    }

    function loadRuntime(runtimeName) {
        const cacheKey = getRuntimeCacheKey(runtimeName);
        if (runtimeRegistry[cacheKey]) {
            return Promise.resolve(runtimeRegistry[cacheKey]);
        }

        if (runtimePromises[cacheKey]) {
            return runtimePromises[cacheKey];
        }

        runtimePromises[cacheKey] = (async () => {
            const asset = await prepareRuntimeAsset(runtimeName);
            return new Promise((resolve, reject) => {
                const script = documentRef.createElement('script');
                script.src = asset.objectUrl;
                script.async = true;
                script.onload = () => {
                    if (!windowRef.rive) {
                        reject(new Error('Runtime did not expose the expected API'));
                        return;
                    }
                    runtimeRegistry[cacheKey] = windowRef.rive;
                    if (runtimeName === getCurrentRuntime()) {
                        updateVersionInfo();
                    }
                    resolve(windowRef.rive);
                };
                script.onerror = () => reject(new Error(`Failed to load runtime from ${script.src}`));
                documentRef.head.appendChild(script);
            });
        })();

        return runtimePromises[cacheKey];
    }

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
        const runtime = await loadRuntime(runtimeName);
        windowRef.rive = runtime;
        warnIfRuntimeLacksScripting(runtimeName);
        if (runtimeName === getCurrentRuntime()) {
            updateVersionInfo();
        }
        return runtime;
    }

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
