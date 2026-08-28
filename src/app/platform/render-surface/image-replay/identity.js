export function normalizeScopePart(value) {
    if (value === null || typeof value === 'undefined') return null;
    const normalized = String(value).trim();
    return normalized || null;
}

export function scopeMatches(left, right) {
    return left?.sourceIdentity === right?.sourceIdentity
        && left?.artboardKey === right?.artboardKey
        && left?.vmInstanceKey === right?.vmInstanceKey;
}

export function scopeKey(scope) {
    return JSON.stringify([
        scope?.sourceIdentity ?? null,
        scope?.artboardKey ?? null,
        scope?.vmInstanceKey ?? null,
    ]);
}

export function entryKey(scope, payload) {
    return JSON.stringify([
        scope?.sourceIdentity ?? null,
        scope?.artboardKey ?? null,
        scope?.vmInstanceKey ?? null,
        payload.source || 'view-model',
        payload.path || payload.name || '',
    ]);
}
