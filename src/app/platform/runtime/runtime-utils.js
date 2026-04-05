import {
    DEFAULT_RUNTIME_VERSION,
    DEFAULT_RUNTIME_VERSION_TOKEN,
    parseSemverParts,
    RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY,
    RUNTIME_META_STORAGE_KEY,
    RUNTIME_PACKAGE_NAMES,
    RUNTIME_VERSION_PREF_STORAGE_KEY,
} from '../../core/constants.js';

export function getRuntimePackageName(runtimeName) {
    return RUNTIME_PACKAGE_NAMES[runtimeName] || RUNTIME_PACKAGE_NAMES.webgl2;
}

export function normalizeRuntimeVersionToken(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) {
        return DEFAULT_RUNTIME_VERSION_TOKEN;
    }
    const lowered = token.toLowerCase();
    if (lowered === 'latest' || lowered === 'custom') {
        return DEFAULT_RUNTIME_VERSION_TOKEN;
    }
    return token;
}

export function getEffectiveRuntimeVersionToken(versionToken, latestResolved) {
    const normalized = normalizeRuntimeVersionToken(versionToken);
    if (normalized !== DEFAULT_RUNTIME_VERSION_TOKEN) {
        return normalized;
    }
    if (parseSemverParts(latestResolved)) {
        return latestResolved;
    }
    return DEFAULT_RUNTIME_VERSION;
}

export function getRuntimeCacheKey(runtimeName, versionToken, latestResolved) {
    return `${runtimeName}@${getEffectiveRuntimeVersionToken(versionToken, latestResolved)}`;
}

export function getRuntimeSourceUrl(runtimeName, versionToken, latestResolved) {
    const packageName = getRuntimePackageName(runtimeName);
    const resolvedToken = getEffectiveRuntimeVersionToken(versionToken, latestResolved);
    return `https://cdn.jsdelivr.net/npm/${packageName}@${resolvedToken}`;
}

export function loadRuntimeVersionPreference(storage = globalThis.localStorage) {
    try {
        return normalizeRuntimeVersionToken(storage.getItem(RUNTIME_VERSION_PREF_STORAGE_KEY));
    } catch {
        return DEFAULT_RUNTIME_VERSION_TOKEN;
    }
}

export function normalizeFileRuntimePreferenceId(rawId) {
    return String(rawId || '').trim().toLowerCase();
}

export function buildFileRuntimePreferenceId(fileName, fileSizeBytes, metadata = {}, normalizeOpenedFilePath = (value) => value) {
    const normalizedPath = normalizeOpenedFilePath(metadata?.sourcePath || '');
    if (normalizedPath) {
        return `path:${normalizeFileRuntimePreferenceId(normalizedPath)}`;
    }
    const safeName = normalizeFileRuntimePreferenceId(fileName || '');
    const safeSize = Number.isFinite(fileSizeBytes) ? Number(fileSizeBytes) : 0;
    const safeModified = Number.isFinite(metadata?.lastModified) ? Number(metadata.lastModified) : 0;
    return `name:${safeName}|size:${safeSize}|modified:${safeModified}`;
}

export function loadRuntimeVersionByFile(storage = globalThis.localStorage) {
    try {
        const raw = storage.getItem(RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }
        const normalized = {};
        Object.entries(parsed).forEach(([key, value]) => {
            const prefId = normalizeFileRuntimePreferenceId(key);
            const token = normalizeRuntimeVersionToken(value);
            if (prefId) {
                normalized[prefId] = token;
            }
        });
        return normalized;
    } catch {
        return {};
    }
}

export function loadRuntimeMeta(storage = globalThis.localStorage) {
    try {
        const raw = storage.getItem(RUNTIME_META_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function compareSemverDescending(versionA, versionB) {
    const a = parseSemverParts(versionA);
    const b = parseSemverParts(versionB);
    if (!a && !b) {
        return versionA.localeCompare(versionB);
    }
    if (!a) {
        return 1;
    }
    if (!b) {
        return -1;
    }
    for (let i = 0; i < 3; i += 1) {
        if (a[i] > b[i]) return -1;
        if (a[i] < b[i]) return 1;
    }
    return 0;
}

export function isSemverAtLeast(version, minimum) {
    const currentParts = parseSemverParts(version);
    const minimumParts = parseSemverParts(minimum);
    if (!currentParts || !minimumParts) {
        return true;
    }
    for (let i = 0; i < 3; i += 1) {
        if (currentParts[i] > minimumParts[i]) return true;
        if (currentParts[i] < minimumParts[i]) return false;
    }
    return true;
}

export { parseSemverParts };

export function extractVersionFromUrl(url) {
    const matches = [...String(url || '').matchAll(/@([^/]+)/g)];
    if (!matches.length) {
        return null;
    }
    return matches[matches.length - 1][1] || null;
}
