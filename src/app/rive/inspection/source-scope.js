const normalize = (value) => value == null || value === '' ? null : String(value);

export function createSourceScope({ sourceIdentity, runtimeKey, artboardKey, vmInstanceKey, sessionId } = {}) {
    return Object.freeze({ sourceIdentity: normalize(sourceIdentity), runtimeKey: normalize(runtimeKey),
        artboardKey: normalize(artboardKey), vmInstanceKey: normalize(vmInstanceKey), sessionId: normalize(sessionId) });
}

export function sourceScopesMatch(left, right, { requireSession = false } = {}) {
    if (!left?.sourceIdentity || !right?.sourceIdentity || !left.runtimeKey || !right.runtimeKey) return false;
    return ['sourceIdentity', 'runtimeKey', 'artboardKey', 'vmInstanceKey']
        .every((key) => normalize(left[key]) === normalize(right[key]))
        && (!requireSession || Boolean(left.sessionId && left.sessionId === right.sessionId));
}

export function scopedControlSnapshot(snapshot, sourceScope) {
    return { sourceScope: createSourceScope(sourceScope), snapshot: Array.isArray(snapshot) ? snapshot : [] };
}

export function snapshotForScope(envelope, targetScope) {
    return sourceScopesMatch(envelope?.sourceScope, targetScope) && Array.isArray(envelope?.snapshot)
        ? envelope.snapshot : [];
}

export function createSnapshotScopeGuard(getCurrentScope) {
    const scopes = new WeakMap();
    let pendingScope = null;
    return {
        capture(snapshot) { if (getCurrentScope) scopes.set(snapshot, getCurrentScope()); return snapshot; },
        accept(snapshot) {
            pendingScope = scopes.get(snapshot) || null;
            return !getCurrentScope || sourceScopesMatch(pendingScope, getCurrentScope());
        },
        isCurrent: () => !getCurrentScope || sourceScopesMatch(pendingScope, getCurrentScope()),
    };
}
