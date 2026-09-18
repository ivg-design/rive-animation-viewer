import { GPU_CANVAS_PREF_STORAGE_KEY } from './constants.js';

export function loadGpuCanvasPreference(storage = globalThis.localStorage) {
    try {
        return storage?.getItem?.(GPU_CANVAS_PREF_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function persistGpuCanvasPreference(enabled, storage = globalThis.localStorage) {
    try {
        storage?.setItem?.(GPU_CANVAS_PREF_STORAGE_KEY, String(Boolean(enabled)));
    } catch {
        /* noop */
    }
}

export function resolveGpuCanvasConfig(runtimeName, enabled) {
    return runtimeName === 'webgl2' && Boolean(enabled);
}
