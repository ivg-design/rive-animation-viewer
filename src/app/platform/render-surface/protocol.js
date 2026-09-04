import {
    bufferTopologyDelta,
    materializeTopologyDelta,
    reconcileRenderSurfaceState,
    stateRevisionOf,
    topologyRevisionOf,
} from './protocol/state-reconciliation.js';

export { reconcileRenderSurfaceState };
export const CHILD_COMMAND_EVENT = 'render-surface:command';
export const CHILD_READY_EVENT = 'render-surface:ready';
export const CHILD_ACK_EVENT = 'render-surface:ack';
export const CHILD_STATE_EVENT = 'render-surface:state';
export const CHILD_TIMELINE_EVENT = 'render-surface:timeline';
export const CHILD_POINTER_DOWN_EVENT = 'render-surface:pointerdown';
export const RENDER_SURFACE_PROTOCOL_VERSION = 2;
export const RENDER_SURFACE_COMMAND_RESULT_EVENT = 'rav:render-surface-command-result';

const CANONICAL_STATE_EVENT = 'rav:render-surface-state';
const COMMAND_ACK_TIMEOUT_MS = 3_000;
const LONG_COMMAND_ACK_TIMEOUT_MS = 10_000;
const CAPTURE_COMMAND_ACK_TIMEOUT_MS = 60_000;
const CANONICAL_BASELINE_TIMEOUT_MS = 10_000;

export function renderSurfaceCommandTimeoutMs(type) {
    if (type === 'capture-canvas' || type.startsWith('media-')) return CAPTURE_COMMAND_ACK_TIMEOUT_MS;
    return type === 'reset' || type === 'vm-image-set'
        ? LONG_COMMAND_ACK_TIMEOUT_MS
        : COMMAND_ACK_TIMEOUT_MS;
}

export function createRenderSurfaceProtocol({
    canSend,
    documentRef,
    invokeQuietly,
    logEvent = () => {},
    onCanonicalState = () => {},
    onCommandResult = () => {},
    windowRef,
} = {}) {
    let activeSessionId = null;
    let canonicalState = null;
    let sessionId = null;
    const pendingAcks = new Map();
    const pendingCanonicalBaselines = new Map();
    const pendingTopologyDeltas = new Map();
    const quarantinedSessions = new Set();
    const sessionCommands = new Map();
    const sessionStates = new Map();

    function commandState(targetSessionId, knownProtocolVersion = 1) {
        if (!sessionCommands.has(targetSessionId)) {
            sessionCommands.set(targetSessionId, {
                commandRevision: 0,
                commandSequence: 0,
                protocolVersion: knownProtocolVersion,
            });
        }
        return sessionCommands.get(targetSessionId);
    }

    function matches(event) {
        return Boolean(event?.payload?.sessionId && event.payload.sessionId === sessionId);
    }

    function matchesActive(event) {
        return Boolean(event?.payload?.sessionId && event.payload.sessionId === activeSessionId);
    }

    function publishCanonicalState(nextState) {
        canonicalState = nextState;
        onCanonicalState(nextState);
        const CustomEventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
        if (typeof documentRef?.dispatchEvent === 'function' && typeof CustomEventCtor === 'function') {
            documentRef.dispatchEvent(new CustomEventCtor(CANONICAL_STATE_EVENT, { detail: nextState }));
        }
    }

    function publishCommandResult(result, type, payload) {
        if (type.startsWith("media-")) { const { canonicalState: _state, ...receipt } = result; return receipt; }
        const detail = { ...result, commandType: type, commandPayload: payload };
        onCommandResult(detail);
        const CustomEventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
        if (typeof documentRef?.dispatchEvent === 'function' && typeof CustomEventCtor === 'function') {
            documentRef.dispatchEvent(new CustomEventCtor(RENDER_SURFACE_COMMAND_RESULT_EVENT, { detail }));
        }
        return detail;
    }

    function hasCanonicalBaseline(targetSessionId) {
        return Boolean(sessionStates.get(targetSessionId)?.canonical?.controlsHierarchy);
    }

    function settleCanonicalBaseline(targetSessionId, result) {
        const waiters = pendingCanonicalBaselines.get(targetSessionId);
        if (!waiters) return;
        pendingCanonicalBaselines.delete(targetSessionId);
        waiters.forEach((waiter) => {
            windowRef.clearTimeout(waiter.timeoutId);
            waiter.resolve(result);
        });
    }

    function clear(reason = 'Render surface session ended.') {
        pendingAcks.forEach((pending) => {
            windowRef.clearTimeout(pending.timeoutId);
            pending.resolve({ applied: false, message: reason, status: 'cancelled' });
        });
        pendingAcks.clear();
        pendingCanonicalBaselines.forEach((_waiters, targetSessionId) => {
            settleCanonicalBaseline(targetSessionId, { ready: false, message: reason, status: 'cancelled' });
        });
        sessionCommands.clear();
        quarantinedSessions.clear();
    }

    function cancelPendingForSession(targetSessionId, reason) {
        pendingAcks.forEach((pending, commandId) => {
            if (pending.sessionId !== targetSessionId) return;
            windowRef.clearTimeout(pending.timeoutId);
            pendingAcks.delete(commandId);
            pending.resolve({ applied: false, message: reason, status: 'cancelled' });
        });
    }

    function beginSession(nextSessionId, knownProtocolVersion = 1) {
        if (sessionId && sessionId !== activeSessionId && sessionId !== nextSessionId) {
            cancelPendingForSession(sessionId, 'A newer render surface session replaced this command.');
            // Keep the superseded session record until its controller
            // transaction explicitly commits or discards it. Native reveal can
            // already be in flight when a newer child starts staging, and the
            // JS authority must still be able to converge on that native
            // result before the newer child wins or fails.
        }
        sessionId = nextSessionId;
        commandState(nextSessionId, knownProtocolVersion);
    }

    function handleReady(event) {
        if (!matches(event)) return;
        const advertised = Number(event?.payload?.protocolVersion ?? event?.payload?.protocol);
        commandState(sessionId).protocolVersion = Number.isFinite(advertised) && advertised > 0 ? advertised : 1;
    }

    function handleAck(event) {
        const result = event?.payload || {};
        const pending = pendingAcks.get(result.commandId);
        if (!pending || pending.sessionId !== result.sessionId) return;
        if (result.status === 'progress') {
            if (pending.type === 'media-record-stop' && Number.isSafeInteger(result.progress) && result.progress > pending.progress) {
                pending.progress = result.progress;
                windowRef.clearTimeout(pending.timeoutId);
                pending.timeoutId = windowRef.setTimeout(pending.expire, pending.timeoutMs);
            }
            return;
        }
        if (result.canonicalDelta && typeof result.canonicalDelta === 'object') {
            handleState({ payload: { ...result.canonicalDelta, sessionId: result.sessionId } });
        }
        windowRef.clearTimeout(pending.timeoutId);
        pendingAcks.delete(result.commandId);
        pending.resolve(result);
    }

    function handleState(event) {
        const stateSessionId = event?.payload?.sessionId;
        if (quarantinedSessions.has(stateSessionId)) return;
        if (!stateSessionId || (stateSessionId !== sessionId && stateSessionId !== activeSessionId)) return;
        const payload = event.payload;
        const previousRecord = sessionStates.get(stateSessionId) || null;
        const currentTopologyRevision = topologyRevisionOf(previousRecord?.canonical);
        const incomingTopologyRevision = topologyRevisionOf(payload, currentTopologyRevision);
        const isDelta = payload.stateType === 'delta'
            || (!payload.controlsHierarchy && Array.isArray(payload.controlChanges));
        if (isDelta && (!previousRecord?.canonical || incomingTopologyRevision !== currentTopologyRevision)) {
            const buffered = pendingTopologyDeltas.get(stateSessionId) || new Map();
            bufferTopologyDelta(buffered, payload);
            pendingTopologyDeltas.set(stateSessionId, buffered);
            return;
        }
        let nextRecord = reconcileRenderSurfaceState(previousRecord, payload);
        if (!nextRecord || nextRecord === previousRecord) return;
        if (payload.controlsHierarchy) {
            const buffered = pendingTopologyDeltas.get(stateSessionId) || new Map();
            const topologyRevision = topologyRevisionOf(nextRecord.canonical);
            const matchingDelta = materializeTopologyDelta(buffered.get(topologyRevision));
            if (matchingDelta) nextRecord = reconcileRenderSurfaceState(nextRecord, matchingDelta);
            [...buffered.keys()].forEach((revision) => {
                if (revision <= topologyRevision) buffered.delete(revision);
            });
            if (buffered.size) pendingTopologyDeltas.set(stateSessionId, buffered);
            else pendingTopologyDeltas.delete(stateSessionId);
        }
        sessionStates.set(stateSessionId, nextRecord);
        if (hasCanonicalBaseline(stateSessionId)) {
            settleCanonicalBaseline(stateSessionId, {
                canonicalState: nextRecord.canonical,
                ready: true,
                status: 'ready',
            });
        }
        if (stateSessionId === activeSessionId) publishCanonicalState(nextRecord.canonical);
    }

    function activateSession(nextActiveSessionId) {
        if (!nextActiveSessionId || !sessionCommands.has(nextActiveSessionId)) return false;
        const commands = commandState(nextActiveSessionId);
        if (commands.protocolVersion >= RENDER_SURFACE_PROTOCOL_VERSION
            && !hasCanonicalBaseline(nextActiveSessionId)) return false;
        activeSessionId = nextActiveSessionId;
        quarantinedSessions.delete(nextActiveSessionId);
        const activeState = sessionStates.get(nextActiveSessionId)?.canonical;
        if (activeState) publishCanonicalState(activeState);
        [...sessionStates.keys()].forEach((storedSessionId) => {
            if (storedSessionId !== activeSessionId && storedSessionId !== sessionId) {
                cancelPendingForSession(storedSessionId, 'The previous render surface was retired.');
                sessionCommands.delete(storedSessionId);
                sessionStates.delete(storedSessionId);
                pendingTopologyDeltas.delete(storedSessionId);
                quarantinedSessions.delete(storedSessionId);
            }
        });
        return true;
    }

    function discardSession(discardedSessionId) {
        if (!discardedSessionId || discardedSessionId === activeSessionId) return;
        settleCanonicalBaseline(discardedSessionId, {
            ready: false,
            message: 'The staged render surface was discarded.',
            status: 'cancelled',
        });
        cancelPendingForSession(discardedSessionId, 'The staged render surface was discarded.');
        sessionCommands.delete(discardedSessionId);
        sessionStates.delete(discardedSessionId);
        pendingTopologyDeltas.delete(discardedSessionId);
        quarantinedSessions.delete(discardedSessionId);
    }

    function deactivateSession(deactivatedSessionId) {
        if (!deactivatedSessionId || deactivatedSessionId !== activeSessionId) return false;
        settleCanonicalBaseline(deactivatedSessionId, {
            ready: false,
            message: 'The active render surface ended.',
            status: 'cancelled',
        });
        sessionStates.delete(deactivatedSessionId);
        pendingTopologyDeltas.delete(deactivatedSessionId);
        cancelPendingForSession(deactivatedSessionId, 'The active render surface ended.');
        sessionCommands.delete(deactivatedSessionId);
        quarantinedSessions.delete(deactivatedSessionId);
        activeSessionId = null;
        canonicalState = null;
        onCanonicalState(null);
        const CustomEventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
        if (typeof documentRef?.dispatchEvent === 'function' && typeof CustomEventCtor === 'function') {
            documentRef.dispatchEvent(new CustomEventCtor(CANONICAL_STATE_EVENT, { detail: null }));
        }
        return true;
    }

    async function requestCommand(type, payload = {}, options = {}) {
        const targetSessionId = options.targetSessionId || sessionId;
        if (!targetSessionId || quarantinedSessions.has(targetSessionId) || !canSend?.(targetSessionId)) {
            return publishCommandResult({ applied: false, status: 'unavailable' }, type, payload);
        }
        const commands = commandState(targetSessionId);
        const configuredTimeoutMs = Number(options.timeoutMs);
        const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs >= 0
            ? configuredTimeoutMs
            : renderSurfaceCommandTimeoutMs(type);
        const commandId = `${targetSessionId}:${(++commands.commandSequence).toString(36)}`;
        const revision = ++commands.commandRevision;
        let ackPromise = null;
        if (commands.protocolVersion >= RENDER_SURFACE_PROTOCOL_VERSION) {
            ackPromise = new Promise((resolve) => {
                const expire = () => {
                    if (!pendingAcks.has(commandId)) return;
                    pendingAcks.delete(commandId);
                    resolve({ applied: false, commandId, revision, status: 'timeout' });
                };
                const timeoutId = windowRef.setTimeout(expire, timeoutMs);
                pendingAcks.set(commandId, { resolve, sessionId: targetSessionId, timeoutId, timeoutMs, expire, type, progress: 0 });
            });
        }
        const sent = await invokeQuietly('send_render_surface_message', {
            event: CHILD_COMMAND_EVENT,
            payload: { commandId, protocolVersion: RENDER_SURFACE_PROTOCOL_VERSION, revision, sessionId: targetSessionId, type, payload },
        });
        if (!sent) {
            const pending = pendingAcks.get(commandId);
            if (pending) {
                windowRef.clearTimeout(pending.timeoutId);
                pendingAcks.delete(commandId);
                pending.resolve({ applied: false, commandId, revision, status: 'transport-error' });
            }
            return publishCommandResult(
                { applied: false, commandId, revision, status: 'transport-error' },
                type,
                payload,
            );
        }
        if (!ackPromise) {
            return publishCommandResult(
                { applied: true, canonicalState: sessionStates.get(targetSessionId)?.canonical || canonicalState, commandId, legacy: true, revision, status: 'applied' },
                type,
                payload,
            );
        }
        const result = await ackPromise;
        if (result?.status === 'rejected') {
            logEvent('native', 'render-surface-command-rejected', `The visible renderer rejected ${type}: ${result.message || 'unknown reason'}.`, result);
        }
        return publishCommandResult({
            ...result,
            canonicalState: sessionStates.get(targetSessionId)?.canonical || canonicalState,
        }, type, payload);
    }

    async function sendCommand(type, payload = {}) {
        return requestCommand(type, payload);
    }

    function quarantineSession(quarantinedSessionId, reason = 'Render surface session failed.') {
        if (!quarantinedSessionId) return false;
        quarantinedSessions.add(quarantinedSessionId);
        settleCanonicalBaseline(quarantinedSessionId, {
            ready: false,
            message: reason,
            status: 'cancelled',
        });
        cancelPendingForSession(quarantinedSessionId, reason);
        pendingTopologyDeltas.delete(quarantinedSessionId);
        return true;
    }

    function waitForCanonicalBaseline(targetSessionId, { timeoutMs = CANONICAL_BASELINE_TIMEOUT_MS } = {}) {
        if (!targetSessionId || !sessionCommands.has(targetSessionId)
            || quarantinedSessions.has(targetSessionId)) {
            return Promise.resolve({ ready: false, status: 'unavailable' });
        }
        if (commandState(targetSessionId).protocolVersion < RENDER_SURFACE_PROTOCOL_VERSION) {
            return Promise.resolve({ legacy: true, ready: true, status: 'ready' });
        }
        const canonicalState = sessionStates.get(targetSessionId)?.canonical;
        if (canonicalState?.controlsHierarchy) {
            return Promise.resolve({ canonicalState, ready: true, status: 'ready' });
        }
        return new Promise((resolve) => {
            const timeoutId = windowRef.setTimeout(() => {
                const waiters = pendingCanonicalBaselines.get(targetSessionId);
                if (waiters) {
                    waiters.delete(waiter);
                    if (!waiters.size) pendingCanonicalBaselines.delete(targetSessionId);
                }
                resolve({ ready: false, status: 'timeout' });
            }, timeoutMs);
            const waiter = { resolve, timeoutId };
            const waiters = pendingCanonicalBaselines.get(targetSessionId) || new Set();
            waiters.add(waiter);
            pendingCanonicalBaselines.set(targetSessionId, waiters);
        });
    }

    return {
        activateSession,
        beginSession,
        clear,
        deactivateSession,
        discardSession,
        getState: () => ({
            activeSessionId,
            canonicalState,
            childProtocolVersion: sessionId ? commandState(sessionId).protocolVersion : 1,
        }),
        handleAck,
        handleReady,
        handleState,
        matches,
        matchesActive,
        quarantineSession,
        requestCommand,
        sendCommand,
        waitForCanonicalBaseline,
    };
}
