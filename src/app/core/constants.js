export const DEFAULT_RUNTIME_VERSION = '2.34.3';
export const MIN_SCRIPTING_RUNTIME_VERSION = '2.34.0';
export const DEFAULT_CANVAS_COLOR = '#0d1117';
export const TRANSPARENT_CANVAS_COLOR = 'transparent';
export const CLICK_THROUGH_POLL_INTERVAL_MS = 42;
export const DEFAULT_RUNTIME_VERSION_TOKEN = 'latest';
export const RUNTIME_VERSION_PREF_STORAGE_KEY = 'riveRuntimeVersionPreference';
export const RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY = 'riveRuntimeVersionPreferencesByFile';
export const RUNTIME_PACKAGE_NAMES = {
    canvas: '@rive-app/canvas',
    webgl2: '@rive-app/webgl2',
};
export const RUNTIME_VERSION_DISCOVERY_URL = 'https://registry.npmjs.org/@rive-app/webgl2';
export const RUNTIME_VERSION_OPTION_COUNT = 4;

export function parseSemverParts(version) {
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(version || '').trim());
    if (!match) {
        return null;
    }
    return match.slice(1).map((part) => Number.parseInt(part, 10));
}

export function buildFallbackRuntimeVersionOptions({
    latestVersion = DEFAULT_RUNTIME_VERSION,
    minimumVersion = MIN_SCRIPTING_RUNTIME_VERSION,
    optionCount = RUNTIME_VERSION_OPTION_COUNT,
} = {}) {
    const latestParts = parseSemverParts(latestVersion);
    if (!latestParts || !Number.isInteger(optionCount) || optionCount <= 0) {
        return latestVersion ? [String(latestVersion)] : [];
    }

    const minimumParts = parseSemverParts(minimumVersion);
    const versions = [];
    let currentPatch = latestParts[2];

    while (versions.length < optionCount && currentPatch >= 0) {
        const candidate = `${latestParts[0]}.${latestParts[1]}.${currentPatch}`;
        versions.push(candidate);

        if (
            minimumParts
            && latestParts[0] === minimumParts[0]
            && latestParts[1] === minimumParts[1]
            && currentPatch <= minimumParts[2]
        ) {
            break;
        }

        currentPatch -= 1;
    }

    return versions;
}

export const FALLBACK_RUNTIME_VERSION_OPTIONS = buildFallbackRuntimeVersionOptions();
export const CURRENT_CUSTOM_RUNTIME_OPTION_VALUE = '__current-custom-runtime__';
export const DEFAULT_LAYOUT_FIT = 'contain';
export const LAYOUT_FITS = ['cover', 'contain', 'fill', 'fitWidth', 'fitHeight', 'scaleDown', 'none', 'layout'];
export const DEFAULT_LAYOUT_ALIGNMENT = 'center';
export const LAYOUT_ALIGNMENTS = [
    'topLeft',
    'topCenter',
    'topRight',
    'centerLeft',
    'center',
    'centerRight',
    'bottomLeft',
    'bottomCenter',
    'bottomRight',
];
export const RUNTIME_CACHE_NAME = 'rive-runtime-cache-v1';
export const RUNTIME_META_STORAGE_KEY = 'riveRuntimeMeta';
export const VM_CONTROL_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color', 'trigger']);
export const VM_CONTROL_SYNC_INTERVAL_MS = 120;
export const OPEN_FILE_POLL_INTERVAL_MS = 900;
export const MCP_SCRIPT_ACCESS_STORAGE_KEY = 'rav-mcp-script-access-enabled';
