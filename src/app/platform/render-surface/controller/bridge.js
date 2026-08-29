import { setRenderSurfaceFpsState } from '../fps-indicator.js';
import { RENDER_SURFACE_PROTOCOL_VERSION } from '../protocol.js';

export function createRenderSurfaceBridgeHandlers({
    clearLoadTimeout,
    documentRef,
    fatalRecovery,
    getActiveSessionId,
    invokeQuietly,
    isDisposed,
    logEvent,
    protocol,
    rejectStagedSession,
    setStagedReady,
    onChildPointerDown = () => {},
    onChildCapture = () => false,
}) {
    function handleChildReady(event) {
        protocol.handleReady(event);
        if (isDisposed() || !protocol.matches(event)) return;
        if (event?.payload?.handshake === 'acknowledged') return;
        // The child replays ready beacons while this acknowledgement is
        // pending. Do not discard a failed send: record it so the next beacon
        // is a visible retry rather than an indistinguishable lost handshake.
        void invokeQuietly('send_render_surface_message', {
            event: 'render-surface:load',
            payload: { protocolVersion: RENDER_SURFACE_PROTOCOL_VERSION, sessionId: event.payload.sessionId },
        }).then((sent) => {
            if (sent) return;
            logEvent(
                'native',
                'render-surface-ready-ack-failed',
                'Unable to acknowledge staged renderer readiness; waiting for its retry beacon.',
                event.payload,
            );
        });
    }

    function handleChildDiagnostic(event) {
        if (isDisposed() || !protocol.matches(event)) return;
        const diagnostic = event?.payload || {};
        logEvent('native', 'render-surface-bridge-diagnostic', `Playback bridge diagnostic: ${diagnostic.phase || 'unknown'}.`, diagnostic);
        if (diagnostic.eventApi && (!diagnostic.eventApi.listen || (!diagnostic.eventApi.emitTo && !diagnostic.eventApi.emit))) {
            void rejectStagedSession(diagnostic.sessionId, {
                error: 'Isolated playback bridge is unavailable; previous frame retained.',
                logName: 'render-surface-bridge-unavailable',
                logText: 'The staged renderer could not access its bounded event bridge.',
            });
        }
    }

    function handleChildMetrics(event) {
        if (isDisposed() || !fatalRecovery.canAcceptCommands() || !protocol.matchesActive(event)) return;
        setRenderSurfaceFpsState(documentRef, true, event?.payload?.fps);
    }

    function handleChildPointerDown(event) {
        if (isDisposed() || !protocol.matchesActive(event)) return;
        onChildPointerDown(event?.payload || {});
    }

    function handleChildError(event) {
        if (isDisposed() || (!protocol.matches(event) && !protocol.matchesActive(event))) return;
        const failedSessionId = event?.payload?.sessionId;
        const initialCanonicalFailure = event?.payload?.recoverable === true
            && event?.payload?.phase === 'canonical-initial-snapshot'
            && failedSessionId !== getActiveSessionId();
        if (event?.payload?.commandId || (event?.payload?.recoverable === true && !initialCanonicalFailure)) {
            logEvent('native', 'render-surface-command-error', String(event?.payload?.message || 'Renderer command failed.'), event?.payload);
            return;
        }
        const message = String(event?.payload?.message || 'unknown renderer error');
        if (failedSessionId !== getActiveSessionId()) {
            void rejectStagedSession(failedSessionId, initialCanonicalFailure ? {
                error: `Playback controls could not be initialized: ${message}`,
                logName: 'render-surface-canonical-baseline-rejected',
                logText: 'The staged renderer did not produce a complete canonical controls baseline.',
            } : {});
        } else {
            clearLoadTimeout();
            setStagedReady(false);
            protocol.quarantineSession(failedSessionId, `Active playback surface failed: ${message}`);
            void fatalRecovery.handleActiveFailure(failedSessionId, message);
        }
        logEvent('native', 'render-surface-error', `Isolated render surface failed: ${message}`, event?.payload);
    }

    return {
        handleChildCapture(event) {
            if (isDisposed() || !protocol.matchesActive(event)) return false;
            return onChildCapture(event?.payload || {});
        },
        handleChildDiagnostic,
        handleChildError,
        handleChildMetrics,
        handleChildPointerDown,
        handleChildReady,
    };
}

export async function registerRenderSurfaceListeners({
    getTauriEventListener,
    registrations,
    unlistenCallbacks,
}) {
    const listen = await getTauriEventListener();
    if (typeof listen !== 'function') return;
    for (const [eventName, handler] of registrations) {
        const unlisten = await listen(eventName, handler);
        if (typeof unlisten === 'function') unlistenCallbacks.push(unlisten);
    }
}
