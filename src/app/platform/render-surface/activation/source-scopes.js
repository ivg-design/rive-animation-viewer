import { createSourceScope, sourceScopesMatch, scopedControlSnapshot } from '../../../rive/inspection/source-scope.js';

export function createSessionSourceScopes({ getActiveSessionId, getStagedSessionId }) {
    const scopes = new Map();
    const commands = new WeakMap();
    function get(sessionId) { return scopes.get(sessionId) || null; }
    function set(sessionId, scope) {
        scopes.set(sessionId, createSourceScope({ ...scope, sessionId }));
        const live = new Set([sessionId, getActiveSessionId?.(), getStagedSessionId?.()]);
        for (const key of scopes.keys()) if (!live.has(key)) scopes.delete(key);
    }
    function stamp(payload, sessionId) {
        if (payload && typeof payload === 'object' && !commands.has(payload)) {
            commands.set(payload, { sessionId, scope: get(sessionId) });
        }
    }
    function matchesCommand(payload, targetSessionId) {
        const origin = commands.get(payload);
        if (!origin) return true; // Internal preparation commands target their explicit session.
        if (origin.sessionId === targetSessionId) return true;
        return sourceScopesMatch(origin.scope, get(targetSessionId));
    }
    return {
        get, set, stamp, matchesCommand,
        active: () => get(getActiveSessionId?.()),
        canReplay: (from, to) => sourceScopesMatch(get(from), get(to)),
        capture: (read) => scopedControlSnapshot(read?.() || [], get(getActiveSessionId?.())),
        clear() { scopes.clear(); },
        forget: (sessionId) => scopes.delete(sessionId),
    };
}
