import { normalizeScopePart } from './identity.js';

function cloneImageValue(value) {
    if (Array.isArray(value)) return [...value];
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) return new value.constructor(value);
    return value;
}

export function clonePayload(payload = {}) {
    return {
        ...payload,
        imageSelection: payload.imageSelection && typeof payload.imageSelection === 'object'
            ? { ...payload.imageSelection }
            : payload.imageSelection,
        value: cloneImageValue(payload.value),
    };
}

function imageValueBytes(value) {
    if (value == null) return 0;
    if (Array.isArray(value)) return value.length;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof value === 'string') return value.length * 2;
    try { return JSON.stringify(value).length * 2; } catch { return Number.POSITIVE_INFINITY; }
}

export function payloadBytes(payload) {
    let metadataBytes = 0;
    try {
        metadataBytes = JSON.stringify({ ...payload, value: null }).length * 2;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
    return metadataBytes + imageValueBytes(payload.value);
}

export function isReplayPayloadValid(payload) {
    const path = normalizeScopePart(payload?.path || payload?.name);
    if (!path || payload?.kind !== 'image') return false;
    if (payload.action === 'clear-image') return payload.value == null;
    if (payload.action !== 'set-image' || payload.value == null) return false;
    return Array.isArray(payload.value)
        || payload.value instanceof ArrayBuffer
        || ArrayBuffer.isView(payload.value)
        || typeof payload.value === 'string';
}

export function normalizeImageCommandPayload(payload = {}) {
    const isClear = payload.action === 'clear' || payload.action === 'clear-image' || payload.value == null;
    const clonedPayload = clonePayload(payload);
    return {
        ...clonedPayload,
        action: isClear ? 'clear-image' : 'set-image',
        imageSelection: isClear ? null : clonedPayload.imageSelection,
    };
}
