import { registerRenderSurfaceListeners } from './bridge.js';
import {
    CHILD_ACK_EVENT,
    CHILD_POINTER_DOWN_EVENT,
    CHILD_READY_EVENT,
    CHILD_STATE_EVENT,
} from '../protocol.js';

const CHILD_LOADED_EVENT = 'render-surface:loaded';
const CHILD_ERROR_EVENT = 'render-surface:error';
const CHILD_DIAGNOSTIC_EVENT = 'render-surface:diagnostic';
const CHILD_METRICS_EVENT = 'render-surface:metrics';
const CHILD_CAPTURE_EVENT = 'render-surface:capture';

export function createRenderSurfaceActivationLifecycle({
    getProtocolVersion = () => 1,
    matches = () => false,
    protocolVersion = 2,
} = {}) {
    let activation = null;
    const claimed = new Set();
    const created = new Set();
    const deferredLoaded = new Map();
    const processing = new Map();
    const rejecting = new Set();

    function run(sessionId, task) {
        const current = activation;
        if (current) {
            if (current.sessionId === sessionId) return current.promise;
            return current.promise.catch(() => false).then(() => run(sessionId, task));
        }
        const record = { promise: null, sessionId };
        activation = record;
        let outcome;
        try { outcome = task(); } catch (error) { outcome = Promise.reject(error); }
        record.promise = Promise.resolve(outcome).finally(() => {
            if (activation === record) activation = null;
        });
        return record.promise;
    }

    function handleLoaded(event, handler) {
        const sessionId = event?.payload?.sessionId;
        if (!sessionId) return handler(event);
        if (rejecting.has(sessionId) || claimed.has(sessionId)) return true;
        if (matches(event) && !created.has(sessionId)) {
            const deferred = deferredLoaded.get(sessionId);
            const priority = (receipt) => receipt?.payload?.firstFrame === true
                ? 2
                : receipt?.payload?.firstFrame === false ? 0 : 1;
            if (!deferred || priority(event) >= priority(deferred)) deferredLoaded.set(sessionId, event);
            return false;
        }
        if (getProtocolVersion() >= protocolVersion && event?.payload?.firstFrame !== true) return handler(event);
        if (processing.has(sessionId)) return processing.get(sessionId);
        const pending = Promise.resolve(handler(event)).then((consumed) => {
            if (consumed !== false) claimed.add(sessionId);
            return consumed;
        }).finally(() => {
            if (processing.get(sessionId) === pending) processing.delete(sessionId);
        });
        processing.set(sessionId, pending);
        return pending;
    }

    return {
        beginRejection(sessionId) {
            if (rejecting.has(sessionId)) return false;
            rejecting.add(sessionId); claimed.add(sessionId);
            deferredLoaded.delete(sessionId); created.delete(sessionId);
            return true;
        },
        dispose() {
            claimed.clear(); created.clear(); deferredLoaded.clear(); processing.clear(); rejecting.clear();
        },
        endRejection: (sessionId) => rejecting.delete(sessionId),
        handleLoaded,
        isCurrent: (sessionId, currentSessionId) => sessionId === currentSessionId
            && created.has(sessionId) && !rejecting.has(sessionId),
        isRejecting: (sessionId) => rejecting.has(sessionId),
        markCreated: (sessionId) => created.add(sessionId),
        retire(sessionId) { claimed.delete(sessionId); created.delete(sessionId); },
        run,
        takeDeferred(sessionId) {
            const event = deferredLoaded.get(sessionId) || null;
            deferredLoaded.delete(sessionId);
            return event;
        },
        async wait() {
            const current = activation;
            if (current) try { await current.promise; } catch {}
        },
    };
}

export function createRenderSurfaceStartupReceiptGate() {
    const accepted = new Set();
    const processing = new Map();
    return function gate(eventName, handler) {
        return function handleStartupReceipt(event) {
            const payload = event?.payload || {};
            if (!payload.sessionId) return handler(event);
            const attempt = eventName === CHILD_READY_EVENT ? payload.attempt ?? '' : '';
            const firstFrame = eventName === CHILD_LOADED_EVENT ? payload.firstFrame === true : '';
            const phase = eventName === CHILD_ERROR_EVENT ? payload.phase || '' : '';
            const key = `${payload.sessionId}\u0000${eventName}\u0000${attempt}\u0000${firstFrame}\u0000${phase}`;
            if (accepted.has(key)) return undefined;
            if (processing.has(key)) return processing.get(key);
            let result;
            try {
                result = handler(event);
            } catch (error) {
                throw error;
            }
            if (!result || typeof result.then !== 'function') {
                // A handler can explicitly return false when the receipt is
                // valid but must be retried later (for example, loaded arrived
                // before native child creation acknowledged).
                if (result !== false) accepted.add(key);
                return result;
            }
            const pending = Promise.resolve(result)
                .then((outcome) => {
                    if (outcome !== false) accepted.add(key);
                    return outcome;
                })
                .finally(() => {
                    if (processing.get(key) === pending) processing.delete(key);
                });
            processing.set(key, pending);
            return pending;
        };
    };
}

export function registerRenderSurfaceControllerListeners({
    getTauriEventListener,
    handlers,
    unlistenCallbacks,
}) {
    const gateStartupReceipt = createRenderSurfaceStartupReceiptGate();
    return registerRenderSurfaceListeners({
        getTauriEventListener,
        registrations: [
            [CHILD_READY_EVENT, gateStartupReceipt(CHILD_READY_EVENT, handlers.handleChildReady)],
            [CHILD_DIAGNOSTIC_EVENT, handlers.handleChildDiagnostic],
            [CHILD_ACK_EVENT, handlers.handleChildAck],
            [CHILD_STATE_EVENT, handlers.handleChildState],
            [CHILD_POINTER_DOWN_EVENT, handlers.handleChildPointerDown],
            [CHILD_LOADED_EVENT, gateStartupReceipt(CHILD_LOADED_EVENT, handlers.handleChildLoaded)],
            [CHILD_ERROR_EVENT, gateStartupReceipt(CHILD_ERROR_EVENT, handlers.handleChildError)],
            [CHILD_METRICS_EVENT, handlers.handleChildMetrics],
            [CHILD_CAPTURE_EVENT, handlers.handleChildCapture || (() => {})],
        ],
        unlistenCallbacks,
    });
}
