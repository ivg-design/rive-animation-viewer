import { measureRenderSurfaceBounds } from '../bounds.js';
import {
    createRenderSurfaceLoadDeadline,
    isRenderSurfaceLoadDeadlineError,
} from './load-deadline.js';

const TIMEOUT_MESSAGE = 'Playback surface update timed out; previous frame retained.';

export function createRenderSurfaceLoadOperation({
    activationCoordinator,
    activationFailure,
    activationLifecycle,
    autoplayPolicy,
    boundsSync,
    demoExportController,
    elements,
    eventRelay,
    fatalRecovery,
    getTauriInvoker,
    handleChildLoaded,
    imageReplayCache,
    invokeQuietly,
    isDisposed,
    isTauriEnvironment,
    loadTracker,
    logEvent,
    protocol,
    rejectStagedSession,
    sessionState,
    showError,
    timeoutMs,
    updateInfo,
    windowRef,
} = {}) {
    let loadGeneration = 0;
    let loadRequestSequence = 0;
    let sessionSequence = 0;

    async function load({ recovery = false, autoplay } = {}) {
        if (isDisposed() || !isTauriEnvironment()
            || typeof demoExportController?.buildRenderSurfaceContext !== 'function') return false;

        const loadRequestId = ++loadRequestSequence;
        activationFailure.set(null);
        const deadline = createRenderSurfaceLoadDeadline({ timeoutMs, windowRef });
        let generation = null;
        let sessionId = null;
        let nativeCreatePromise = null;
        try {
            await deadline.waitFor(activationLifecycle.wait(), 'activation handoff');
            if (isDisposed() || loadRequestId !== loadRequestSequence) return false;
            const invoke = getTauriInvoker();
            const bounds = measureRenderSurfaceBounds(elements.canvasContainer);
            if (typeof invoke !== 'function' || !bounds) return false;

            generation = ++loadGeneration;
            sessionId = `${Date.now().toString(36)}-${(++sessionSequence).toString(36)}`;
            const pendingStage = loadTracker.getPending();
            if (pendingStage) {
                await deadline.waitFor(rejectStagedSession(pendingStage.sessionId), 'prior-stage cleanup');
                if (isDisposed() || generation !== loadGeneration || loadRequestId !== loadRequestSequence) return false;
            }
            const stagePrepared = await deadline.waitFor(
                activationCoordinator.prepareStage(sessionId),
                'control preflight',
            );
            if (!stagePrepared || isDisposed() || generation !== loadGeneration) {
                activationCoordinator.endStage(sessionId, false);
                if (stagePrepared === false && generation === loadGeneration && !isDisposed()) {
                    const message = 'Playback surface update could not settle the active control transaction.';
                    activationFailure.set(new Error(message));
                    logEvent('native', 'render-surface-preflight-rejected', message);
                    if (!recovery) showError(`${message} Please retry the file change.`);
                }
                return false;
            }

            autoplayPolicy.begin(sessionId, autoplay);
            if (!recovery) fatalRecovery.beginDeliberateReplacement(sessionId);
            imageReplayCache.beginStage(sessionId);
            const activationPromise = loadTracker.begin(generation, sessionId);
            sessionState.beginStage(sessionId);
            protocol.beginSession(sessionId);
            eventRelay.getPresentationState();
            const context = await deadline.waitFor(
                demoExportController.buildRenderSurfaceContext(),
                'context preparation',
            );
            if (isDisposed() || generation !== loadGeneration) {
                autoplayPolicy.forget(sessionId);
                fatalRecovery.cancelDeliberateReplacement(sessionId);
                return false;
            }

            imageReplayCache.setStagedSource(
                sessionId,
                context.sourceIdentity,
                context.payload?.view_model_instance_name,
                context.payload?.artboard_name,
            );
            nativeCreatePromise = invoke('create_render_surface', {
                request: {
                    ...bounds,
                    payload: autoplayPolicy.applyToPayload(sessionId, context.payload),
                    sessionId,
                },
            });
            await deadline.waitFor(nativeCreatePromise, 'native creation', {
                onLateFulfilled: () => invokeQuietly('discard_render_surface', { sessionId }),
            });
            if (isDisposed() || generation !== loadGeneration
                || sessionId !== sessionState.getSurfaceSessionId()) {
                autoplayPolicy.forget(sessionId);
                fatalRecovery.cancelDeliberateReplacement(sessionId);
                await invokeQuietly('discard_render_surface', { sessionId });
                protocol.discardSession(sessionId);
                loadTracker.settle(sessionId, false);
                return false;
            }

            sessionState.markCreated();
            activationLifecycle.markCreated(sessionId);
            boundsSync.remember(bounds);
            loadTracker.armTimeout(sessionId);
            logEvent(
                'native',
                'render-surface-create',
                `Loading isolated render surface for ${context.currentFileName || 'animation'}.`,
            );
            const latchedLoaded = activationLifecycle.takeDeferred(sessionId);
            if (latchedLoaded) void handleChildLoaded(latchedLoaded);
            return await deadline.waitFor(activationPromise, 'first-frame confirmation');
        } catch (error) {
            if (sessionId) {
                autoplayPolicy.forget(sessionId);
                fatalRecovery.cancelDeliberateReplacement(sessionId);
            }
            if (isRenderSurfaceLoadDeadlineError(error)) {
                if (generation !== null && generation === loadGeneration) loadGeneration += 1;
                activationFailure.set(new Error(TIMEOUT_MESSAGE));
                logEvent('native', 'render-surface-timeout', error.message, { phase: error.phase, sessionId });
                updateInfo(TIMEOUT_MESSAGE);
                if (!recovery) showError(TIMEOUT_MESSAGE);
                if (sessionId) void rejectStagedSession(sessionId);
                return false;
            }
            if (generation !== null && generation !== loadGeneration) return false;
            const message = String(error?.message || error || 'unknown error');
            logEvent('native', 'render-surface-create-error', 'Unable to create isolated render surface.', error);
            if (!sessionId) {
                activationFailure.set(new Error(message));
                if (!recovery) showError(`Isolated render surface unavailable: ${message}`);
                return false;
            }
            return rejectStagedSession(sessionId, {
                error: recovery ? null : `Isolated render surface unavailable: ${message}`,
            });
        } finally {
            deadline.dispose();
        }
    }

    return {
        cancel() { loadRequestSequence += 1; },
        load,
        async loadForSelection(options) {
            const activated = await load(options);
            const failure = activationFailure.get();
            if (!activated && failure) throw failure;
            return activated;
        },
    };
}
