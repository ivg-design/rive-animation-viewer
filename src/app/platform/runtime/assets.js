import {
    DEFAULT_RUNTIME_VERSION,
    RUNTIME_CACHE_NAME,
    RUNTIME_VERSION_DISCOVERY_URL,
    RUNTIME_VERSION_OPTION_COUNT,
} from '../../core/constants.js';
import {
    compareSemverDescending,
    extractVersionFromUrl,
    getRuntimeCacheKey as buildRuntimeCacheKey,
    getRuntimeSourceUrl as buildRuntimeSourceUrl,
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
        if (version && !unique.includes(version)) unique.push(version);
    });
    return { latest, versions: unique.slice(0, optionCount) };
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
        if (!response.ok) throw new Error(`Failed to resolve runtime version (${response.status})`);
        const resolvedUrl = response.url || scriptUrl;
        const headerVersion = response.headers.get('x-jsd-version') || response.headers.get('x-rv-version');
        return { resolvedUrl, version: headerVersion || extractVersionFromUrl(resolvedUrl) };
    } catch (error) {
        const stored = runtimeMeta?.[metaKey];
        if (stored?.resolvedUrl) {
            logger.warn('Falling back to cached runtime metadata', error);
            return { resolvedUrl: stored.resolvedUrl, version: stored.version || null };
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
    text = text.replace(/\/\/# sourceMappingURL=.*$/gm, '');
    const blob = new blobCtor([text], { type: 'application/javascript' });
    return { objectUrl: urlApi.createObjectURL(blob), text };
}

export function createRuntimeAssetLoader({
    blobCtor = globalThis.Blob,
    cachesRef = globalThis.caches,
    documentRef = globalThis.document,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    getCurrentRuntime = () => 'webgl2',
    getRuntimeCacheKey = (runtimeName) => buildRuntimeCacheKey(runtimeName, normalizeRuntimeVersionToken('latest'), null),
    getRuntimeSourceUrl = (runtimeName) => buildRuntimeSourceUrl(runtimeName, normalizeRuntimeVersionToken('latest'), null),
    logger = console,
    persistRuntimeMeta = () => {},
    runtimeAssets = {},
    runtimeBlobUrls = {},
    runtimeMeta = {},
    runtimePromises = {},
    runtimeRegistry = {},
    runtimeResolvedUrls = {},
    runtimeSourceTexts = {},
    runtimeVersions = {},
    updateVersionInfo = () => {},
    urlApi = globalThis.URL,
    windowRef = globalThis,
} = {}) {
    async function fetchRuntimeRequest(resolvedUrl) {
        const response = await fetchImpl(resolvedUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to download runtime (${response.status})`);
        return response;
    }

    async function fetchRuntimeDirectly(resolvedUrl) {
        const response = await fetchRuntimeRequest(resolvedUrl);
        return responseToRuntimeAsset(response, { blobCtor, urlApi });
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

    async function prepareRuntimeAsset(runtimeName) {
        const cacheKey = getRuntimeCacheKey(runtimeName);
        if (runtimeAssets[cacheKey]) return runtimeAssets[cacheKey];

        const scriptUrl = getRuntimeSourceUrl(runtimeName);
        if (!scriptUrl) throw new Error(`Unknown runtime: ${runtimeName}`);

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
        persistRuntimeMeta(cacheKey, { resolvedUrl, version: record.version, cachedAt: Date.now() });
        return record;
    }

    function loadRuntime(runtimeName) {
        const cacheKey = getRuntimeCacheKey(runtimeName);
        if (runtimeRegistry[cacheKey]) return Promise.resolve(runtimeRegistry[cacheKey]);
        if (runtimePromises[cacheKey]) return runtimePromises[cacheKey];

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
                    if (runtimeName === getCurrentRuntime()) updateVersionInfo();
                    resolve(windowRef.rive);
                };
                script.onerror = () => reject(new Error(`Failed to load runtime from ${script.src}`));
                documentRef.head.appendChild(script);
            });
        })();

        return runtimePromises[cacheKey];
    }

    return {
        loadRuntime,
    };
}
