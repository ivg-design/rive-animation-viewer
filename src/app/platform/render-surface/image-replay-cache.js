import {
    entryKey,
    normalizeScopePart,
    scopeKey,
    scopeMatches,
} from './image-replay/identity.js';
import {
    DEFAULT_MAX_ENTRIES,
    DEFAULT_MAX_ENTRY_BYTES,
    DEFAULT_MAX_SCOPES,
    DEFAULT_MAX_TOTAL_BYTES,
    positiveLimit,
} from './image-replay/limits.js';
import { oldestLruKey, touchLruEntry } from './image-replay/lru.js';
import {
    clonePayload,
    isReplayPayloadValid,
    normalizeImageCommandPayload,
    payloadBytes,
} from './image-replay/payload.js';

export function createRenderSurfaceImageReplayCache({
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES,
    maxScopes = DEFAULT_MAX_SCOPES,
    maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
    onOutcome = () => {},
} = {}) {
    const limits = {
        maxEntries: positiveLimit(maxEntries, DEFAULT_MAX_ENTRIES),
        maxEntryBytes: positiveLimit(maxEntryBytes, DEFAULT_MAX_ENTRY_BYTES),
        maxScopes: positiveLimit(maxScopes, DEFAULT_MAX_SCOPES),
        maxTotalBytes: positiveLimit(maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES),
    };
    let activeScope = null;
    let accessSequence = 0;
    let lastOutcome = null;
    let provisionalBytes = 0;
    let sequence = 0;
    let staged = null;
    let totalBytes = 0;
    const entries = new Map();
    const provisional = new Map();
    const payloadTokens = new WeakMap();
    const scopes = new Map();

    function emit(status, detail = {}) {
        lastOutcome = { ...detail, status };
        try { onOutcome(lastOutcome); } catch {}
        return lastOutcome;
    }

    function scopeForSession(sessionId) {
        if (!sessionId) return null;
        if (staged?.sessionId === sessionId) return staged.scope;
        if (activeScope?.sessionId === sessionId) return activeScope;
        return null;
    }

    function touchScope(scope) {
        const key = scopeKey(scope);
        touchLruEntry(scopes, key, ++accessSequence);
    }

    function removeEntry(key, reason, detail = {}) {
        const entry = entries.get(key);
        if (!entry) return false;
        entries.delete(key);
        totalBytes = Math.max(0, totalBytes - entry.byteSize);
        const cachedScopeKey = scopeKey(entry.scope);
        if (![...entries.values()].some((candidate) => scopeKey(candidate.scope) === cachedScopeKey)) {
            scopes.delete(cachedScopeKey);
        }
        emit(reason, {
            artboardKey: entry.scope.artboardKey,
            entryId: entry.id,
            path: entry.payload.path || entry.payload.name || '',
            sourceIdentity: entry.scope.sourceIdentity,
            ...detail,
        });
        return true;
    }

    function removeProvisional(token, reason = null) {
        const entry = provisional.get(token);
        if (!entry) return null;
        provisional.delete(token);
        provisionalBytes = Math.max(0, provisionalBytes - entry.byteSize);
        if (reason) emit(reason, { entryId: entry.id, path: entry.payload.path || '' });
        return entry;
    }

    function touchEntry(entry) {
        if (entries.get(entry.key) !== entry) return;
        touchLruEntry(entries, entry.key, entry);
        touchScope(entry.scope);
    }

    function enforceBounds() {
        while (scopes.size > limits.maxScopes) {
            const oldestScopeKey = oldestLruKey(scopes);
            const keys = [...entries]
                .filter(([, entry]) => scopeKey(entry.scope) === oldestScopeKey)
                .map(([key]) => key);
            keys.forEach((key) => removeEntry(key, 'evicted-scope-lru'));
            scopes.delete(oldestScopeKey);
        }
        while (entries.size > limits.maxEntries || totalBytes > limits.maxTotalBytes) {
            const oldestKey = oldestLruKey(entries);
            if (typeof oldestKey === 'undefined') break;
            removeEntry(oldestKey, entries.size > limits.maxEntries
                ? 'evicted-entry-lru'
                : 'evicted-byte-lru');
        }
    }

    function capture(payload = {}, targetSessionId = null) {
        sequence += 1;
        const explicitScope = scopeForSession(targetSessionId);
        const scope = explicitScope ?? (targetSessionId ? null : (activeScope ?? staged?.scope ?? null));
        const token = `image:${sequence}`;
        const normalizedPayload = normalizeImageCommandPayload(payload);
        const byteSize = payloadBytes(normalizedPayload);
        if (!isReplayPayloadValid(normalizedPayload) || !Number.isFinite(byteSize)) {
            emit('dropped-corrupt', { path: normalizedPayload.path || '' });
            return null;
        }
        if (byteSize > limits.maxEntryBytes || byteSize > limits.maxTotalBytes) {
            emit('dropped-oversize', { byteSize, path: normalizedPayload.path || '' });
            return null;
        }
        const entry = {
            byteSize,
            id: token,
            key: entryKey(scope, normalizedPayload),
            payload: normalizedPayload,
            sequence,
            scope,
            targetSessionId,
        };
        if (provisional.size >= limits.maxEntries) {
            const oldestToken = oldestLruKey(provisional);
            removeProvisional(oldestToken, 'dropped-provisional-lru');
        }
        while (totalBytes + provisionalBytes + byteSize > limits.maxTotalBytes) {
            if (provisional.size) {
                removeProvisional(oldestLruKey(provisional), 'dropped-provisional-byte-lru');
            } else if (entries.size) {
                removeEntry(oldestLruKey(entries), 'evicted-byte-lru');
            } else {
                break;
            }
        }
        if (totalBytes + provisionalBytes + byteSize > limits.maxTotalBytes) {
            emit('dropped-provisional-budget', {
                byteSize,
                path: normalizedPayload.path || '',
            });
            return null;
        }
        provisional.set(token, entry);
        provisionalBytes += byteSize;
        if (payload && typeof payload === 'object') payloadTokens.set(payload, token);
        return token;
    }

    function resolveCommand({ metadata, payload, result, targetSessionId = null } = {}) {
        if (!payload || typeof payload !== 'object') return false;
        const token = payloadTokens.get(payload);
        if (!token) return false;
        if (!result?.applied && metadata?.requeued === true) return false;
        payloadTokens.delete(payload);
        const entry = removeProvisional(token);
        if (!entry || !result?.applied) return false;

        // Delivery target is authoritative. This prevents an A acknowledgement
        // from being journaled into B, and lets a command held by the barrier
        // follow whichever session actually receives it after the outcome.
        entry.scope = targetSessionId ? scopeForSession(targetSessionId) : entry.scope;
        if (entry.scope?.sourceIdentity == null) {
            emit('dropped-unscoped', { entryId: entry.id, path: entry.payload.path || '' });
            return false;
        }
        entry.key = entryKey(entry.scope, entry.payload);
        if (entries.has(entry.key)) removeEntry(entry.key, 'replaced');
        entries.set(entry.key, entry);
        totalBytes += entry.byteSize;
        touchEntry(entry);
        enforceBounds();
        emit('stored', { byteSize: entry.byteSize, entryId: entry.id, path: entry.payload.path || '' });
        return true;
    }

    function beginStage(sessionId) {
        if (staged?.sessionId && staged.sessionId !== sessionId) {
            for (const entry of provisional.values()) {
                if (entry.targetSessionId === staged.sessionId) {
                    entry.scope = null;
                    entry.targetSessionId = null;
                }
            }
        }
        staged = { sessionId, scope: null, startSequence: sequence };
    }

    function setStagedSource(sessionId, sourceIdentity, vmInstanceKey = null, artboardKey = null) {
        if (staged?.sessionId !== sessionId) return false;
        staged.scope = {
            artboardKey: normalizeScopePart(artboardKey),
            sessionId,
            sourceIdentity: normalizeScopePart(sourceIdentity),
            vmInstanceKey: normalizeScopePart(vmInstanceKey),
        };
        if (staged.scope.sourceIdentity != null) {
            for (const entry of provisional.values()) {
                const belongsToStage = entry.targetSessionId === sessionId
                    || (activeScope == null && entry.targetSessionId == null && entry.sequence > staged.startSequence);
                if (entry.scope == null && belongsToStage) {
                    entry.scope = staged.scope;
                    entry.key = entryKey(entry.scope, entry.payload);
                }
            }
        }
        return true;
    }

    function planReplayForStage(sessionId) {
        if (staged?.sessionId !== sessionId || staged.scope?.sourceIdentity == null) return [];
        const matching = [...entries.values()]
            .filter((entry) => scopeMatches(entry.scope, staged.scope))
            .sort((left, right) => left.sequence - right.sequence);
        matching.forEach(touchEntry);
        return matching.map((entry) => ({
            entryId: entry.id,
            key: entry.key,
            payload: clonePayload(entry.payload),
        }));
    }

    function replayForStage(sessionId) {
        return planReplayForStage(sessionId).map((entry) => entry.payload);
    }

    function validateReplayEntry(sessionId, replayEntry) {
        if (staged?.sessionId !== sessionId || staged.scope?.sourceIdentity == null) {
            return { status: 'stale-stage', valid: false };
        }
        const current = replayEntry?.key ? entries.get(replayEntry.key) : null;
        if (!current || current.id !== replayEntry?.entryId || !scopeMatches(current.scope, staged.scope)) {
            return { entryId: replayEntry?.entryId ?? null, status: 'stale-entry', valid: false };
        }
        if (!isReplayPayloadValid(replayEntry.payload)) {
            removeEntry(current.key, 'evicted-corrupt-replay');
            return { entryId: current.id, status: 'corrupt-entry', valid: false };
        }
        touchEntry(current);
        return { payload: replayEntry.payload, status: 'ready', valid: true };
    }

    function recordReplayOutcome(sessionId, replayEntry, result) {
        const current = replayEntry?.key ? entries.get(replayEntry.key) : null;
        if (!current || current.id !== replayEntry?.entryId || !scopeMatches(current.scope, staged?.scope)) {
            return emit('stale-replay-outcome', { entryId: replayEntry?.entryId ?? null });
        }
        if (staged?.sessionId !== sessionId) {
            return emit('stale-replay-stage', { entryId: current.id });
        }
        if (result?.applied) {
            touchEntry(current);
            return emit('replay-retained', { entryId: current.id, path: current.payload.path || '' });
        }
        removeEntry(current.key, 'evicted-failed-replay', {
            message: result?.message || null,
            resultStatus: result?.status || 'rejected',
        });
        return lastOutcome;
    }

    function commitStage(sessionId) {
        if (staged?.sessionId !== sessionId) return false;
        activeScope = staged.scope;
        staged = null;
        enforceBounds();
        return true;
    }

    function rejectStage(sessionId) {
        if (staged?.sessionId !== sessionId) return false;
        const rejectedScope = staged.scope;
        for (const entry of provisional.values()) {
            if (entry.targetSessionId === sessionId || scopeMatches(entry.scope, rejectedScope)) {
                // A command held by the activation barrier may still be routed
                // back to the predecessor after rejection. Keep its bounded
                // provisional token and let the actual delivery target decide.
                entry.scope = null;
                entry.targetSessionId = null;
            }
        }
        staged = null;
        return true;
    }

    function clear() {
        activeScope = null;
        entries.clear();
        provisional.clear();
        provisionalBytes = 0;
        scopes.clear();
        staged = null;
        totalBytes = 0;
        emit('cleared');
    }

    return {
        beginStage,
        capture,
        clear,
        commitStage,
        dispose: clear,
        getState: () => ({
            activeScope: activeScope ? { ...activeScope } : null,
            entryCount: entries.size,
            lastOutcome,
            limits: { ...limits },
            provisionalBytes,
            provisionalCount: provisional.size,
            scopeCount: scopes.size,
            stagedScope: staged?.scope ? { ...staged.scope } : null,
            retainedBytes: totalBytes,
            totalBytes: totalBytes + provisionalBytes,
        }),
        planReplayForStage,
        recordReplayOutcome,
        rejectStage,
        replayForStage,
        resolveCommand,
        setStagedSource,
        validateReplayEntry,
    };
}
