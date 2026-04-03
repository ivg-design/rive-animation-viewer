import { createSafeInspectPreview } from '../../core/safe-inspect.js';

export function normalizeSerializable(value, windowRef = globalThis.window) {
    return createSafeInspectPreview(value, { windowRef });
}

export function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const centiseconds = String(Math.floor(date.getMilliseconds() / 10)).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}.${centiseconds}`;
}

function formatArgValue(value, windowRef = globalThis.window) {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
        return String(value);
    }
    try {
        return JSON.stringify(normalizeSerializable(value, windowRef));
    } catch {
        return String(value);
    }
}

export function formatEntryMessage(entry, windowRef = globalThis.window) {
    return entry.args.map((value) => formatArgValue(value, windowRef)).join(' ');
}

export function resolveEntryLevel(method) {
    if (method === 'warn' || method === 'warning') {
        return 'warning';
    }
    if (method === 'error') {
        return 'error';
    }
    return 'info';
}

export function resolveEntryBadge(method) {
    if (method === 'command') return 'CMD';
    if (method === 'result') return 'RESULT';
    if (method === 'debug') return 'DEBUG';
    if (method === 'info') return 'INFO';
    if (method === 'warn' || method === 'warning') return 'WARN';
    if (method === 'error') return 'ERROR';
    return 'LOG';
}
