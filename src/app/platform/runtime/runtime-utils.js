import {
    DEFAULT_RUNTIME_VERSION,
    DEFAULT_RUNTIME_VERSION_TOKEN,
    LATEST_RUNTIME_VERSION_TOKEN,
    parseSemverParts,
    RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY,
    RUNTIME_META_STORAGE_KEY,
    RUNTIME_PACKAGE_NAMES,
    RUNTIME_VERSION_PREF_STORAGE_KEY,
} from '../../core/constants.js';

export const RUNTIME_LAYOUT_COMPATIBILITY_MIGRATION_ID = 'authored-layout-default-2.39.2-v1';
export const RUNTIME_LAYOUT_COMPATIBILITY_MIGRATION_STORAGE_KEY = 'ravRuntimeLayoutCompatibilityMigration';
const UNSAFE_PERSISTED_RUNTIME_TOKENS = new Set(['latest', '2.40.0']);

function isRuntimeLayoutCompatibilityMigrationComplete(storage) {
    try {
        const raw = storage.getItem(RUNTIME_LAYOUT_COMPATIBILITY_MIGRATION_STORAGE_KEY);
        if (raw === RUNTIME_LAYOUT_COMPATIBILITY_MIGRATION_ID) {
            return true;
        }
        return JSON.parse(raw || 'null')?.id === RUNTIME_LAYOUT_COMPATIBILITY_MIGRATION_ID;
    } catch {
        return false;
    }
}

function isUnsafePersistedRuntimeToken(value) {
    return UNSAFE_PERSISTED_RUNTIME_TOKENS.has(String(value || '').trim().toLowerCase());
}

export function getRuntimePackageName(runtimeName) {
    return RUNTIME_PACKAGE_NAMES[runtimeName] || RUNTIME_PACKAGE_NAMES.webgl2;
}

export function normalizeRuntimeVersionToken(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) {
        return DEFAULT_RUNTIME_VERSION_TOKEN;
    }
    const lowered = token.toLowerCase();
    if (lowered === 'custom') {
        return DEFAULT_RUNTIME_VERSION_TOKEN;
    }
    if (lowered === LATEST_RUNTIME_VERSION_TOKEN) {
        return LATEST_RUNTIME_VERSION_TOKEN;
    }
    return token;
}

export function getEffectiveRuntimeVersionToken(versionToken, latestResolved) {
    const normalized = normalizeRuntimeVersionToken(versionToken);
    if (normalized !== LATEST_RUNTIME_VERSION_TOKEN) {
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

export function migrateRuntimeLayoutCompatibilityPreferences(storage = globalThis.localStorage) {
    const migrationComplete = isRuntimeLayoutCompatibilityMigrationComplete(storage);
    let runtimeVersionToken = loadRuntimeVersionPreference(storage);
    const runtimeVersionByFile = loadRuntimeVersionByFile(storage);
    if (migrationComplete) {
        return {
            completed: true,
            migrated: false,
            migratedFileCount: 0,
            migratedGlobal: false,
            runtimeVersionByFile,
            runtimeVersionToken,
        };
    }

    const migratedGlobal = isUnsafePersistedRuntimeToken(runtimeVersionToken);
    if (migratedGlobal) {
        runtimeVersionToken = DEFAULT_RUNTIME_VERSION_TOKEN;
    }
    let migratedFileCount = 0;
    Object.entries(runtimeVersionByFile).forEach(([prefId, token]) => {
        if (isUnsafePersistedRuntimeToken(token)) {
            runtimeVersionByFile[prefId] = DEFAULT_RUNTIME_VERSION_TOKEN;
            migratedFileCount += 1;
        }
    });

    const audit = {
        id: RUNTIME_LAYOUT_COMPATIBILITY_MIGRATION_ID,
        migratedFileCount,
        migratedGlobal,
        safeRuntimeVersion: DEFAULT_RUNTIME_VERSION,
    };
    let completed = false;
    try {
        if (migratedGlobal) {
            storage.setItem(RUNTIME_VERSION_PREF_STORAGE_KEY, runtimeVersionToken);
        }
        if (migratedFileCount > 0) {
            storage.setItem(RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY, JSON.stringify(runtimeVersionByFile));
        }
        storage.setItem(RUNTIME_LAYOUT_COMPATIBILITY_MIGRATION_STORAGE_KEY, JSON.stringify(audit));
        completed = true;
    } catch {
        /* The sanitized in-memory preferences below still protect this session. */
    }

    return {
        ...audit,
        completed,
        migrated: migratedGlobal || migratedFileCount > 0,
        runtimeVersionByFile,
        runtimeVersionToken,
    };
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
