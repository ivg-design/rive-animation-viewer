export const DEFAULT_MAX_ENTRIES = 128;
export const DEFAULT_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_SCOPES = 16;
export const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export function positiveLimit(value, fallback) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
