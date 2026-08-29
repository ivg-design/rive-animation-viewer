import { RAV_ANIMATION_LOADED_EVENT } from '../../rive/control-events.js';
import { createRenderSurfaceActivationCoordinator } from './activation/coordinator.js';
import { measureRenderSurfaceBounds } from './bounds.js';
import { createRenderSurfaceActivationHandler } from './controller/activation-handler.js';
import { createRenderSurfaceBridgeHandlers } from './controller/bridge.js';
import { createRenderSurfaceAutoplayPolicy } from './controller/autoplay-policy.js';
import { createRenderSurfaceBoundsSync } from './controller/bounds-sync.js';
import { createRenderSurfaceLoadOperation } from './controller/load-operation.js';
import { createRenderSurfaceLoadTracker } from './controller/load-tracker.js';
import { createRenderSurfaceActivationLifecycle, registerRenderSurfaceControllerListeners } from './controller/listeners.js';
import { buildRenderSurfaceState, createRenderSurfaceControllerState, createRenderSurfaceDisposer } from './controller/state.js';
import { setRenderSurfaceFpsState } from './fps-indicator.js';
import { createRenderSurfaceImageReplayCache } from './image-replay-cache.js';
import { createRenderSurfaceEventRelay, dispatchCanonicalTimelineProgress } from './event-relay.js';
import { createRenderSurfaceFatalRecovery } from './fatal-recovery.js';
import { createRenderSurfaceProtocol, RENDER_SURFACE_PROTOCOL_VERSION } from './protocol.js';
import { createRenderSurfaceVisibilityController, observeBlockingMainUi } from './visibility.js';
import { createRenderSurfaceCaptureSession } from './capture-router.js';
export { measureRenderSurfaceBounds } from './bounds.js';
const LOAD_TIMEOUT_MS = 15_000;
export const RENDER_SURFACE_AUTHORITY_EVENT = 'rav:render-surface-authority-change';
export function createRenderSurfaceController({
    callbacks = {},
    demoExportController,
    documentRef = globalThis.document,
    elements = {},
    MutationObserverCtor = globalThis.MutationObserver,
    ResizeObserverCtor = globalThis.ResizeObserver,
    windowRef = globalThis.window,
} = {}) {
    const { getControlSnapshot = () => [], getPresentationState = () => ({}),
        getTauriEventListener = async () => null, getTauriInvoker = () => null,
        isTauriEnvironment = () => false, logEvent = () => {}, onCanonicalState = () => {},
        onCommandResult = () => {}, showError = () => {}, updateInfo = () => {} } = callbacks;
    let activeSessionId = null, activatingSessionId = null;
    let mutationObserver = null, resizeObserver = null, surfaceSessionId = null;
    let disposed = false, isLoaded = false, isSetup = false, stagedReady = false, surfaceCreated = false;
    let lastActivationFailure = null;
    let fatalRecovery = null;
    const autoplayPolicy = createRenderSurfaceAutoplayPolicy();
    const imageReplayCache = createRenderSurfaceImageReplayCache({
        onOutcome: (outcome) => {
            if (!outcome?.status || ['cleared', 'replaced', 'replay-retained', 'stored'].includes(outcome.status)) return;
            logEvent(
                'native',
                'render-surface-image-replay-cache',
                `Image replay cache ${outcome.status}${outcome.path ? ` for ${outcome.path}` : ''}.`,
                outcome,
            );
        },
    });
    const unlistenCallbacks = [];
    const controllerState = createRenderSurfaceControllerState({
        activeSessionId: () => activeSessionId,
        canAcceptCommands: () => !disposed && isLoaded && Boolean(activeSessionId)
            && (fatalRecovery?.canAcceptCommands() ?? true),
        documentRef,
        getFatalRecovery: () => fatalRecovery,
        isLoaded: () => isLoaded,
        logEvent,
        showError,
    });
    const { handleCommandOverflow, publishAuthorityState } = controllerState;
    const invokeQuietly = (command, args = {}) => controllerState.invokeQuietly(command, args, getTauriInvoker);
    const boundsSync = createRenderSurfaceBoundsSync({
        elements,
        hasSurface: () => surfaceCreated,
        invokeQuietly,
        isDisposed: () => disposed,
        windowRef,
    });
    function handleCanonicalState(state) {
        onCanonicalState(state);
        dispatchCanonicalTimelineProgress(documentRef, state);
    }
    const protocol = createRenderSurfaceProtocol({
        canSend: (targetSessionId) => !disposed && (targetSessionId === activeSessionId
            ? (fatalRecovery?.canAcceptCommands() ?? true)
            : targetSessionId === surfaceSessionId && surfaceCreated && stagedReady),
        documentRef,
        invokeQuietly,
        logEvent,
        onCanonicalState: handleCanonicalState,
        onCommandResult,
        windowRef,
    });
    const activationLifecycle = createRenderSurfaceActivationLifecycle({
        getProtocolVersion: () => protocol.getState().childProtocolVersion,
        matches: protocol.matches,
        protocolVersion: RENDER_SURFACE_PROTOCOL_VERSION,
    });
    const activationCoordinator = createRenderSurfaceActivationCoordinator({
        getActiveSessionId: () => activeSessionId,
        getStagedSessionId: () => surfaceCreated && stagedReady ? surfaceSessionId : null,
        isSessionAddressable: (targetSessionId) => !disposed && (targetSessionId === activeSessionId
            ? (fatalRecovery?.canAcceptCommands() ?? true)
            : targetSessionId === surfaceSessionId && surfaceCreated && stagedReady),
        onCommandResult: ({ metadata, payload, result, targetSessionId }) => imageReplayCache.resolveCommand({
            metadata, payload, result, targetSessionId,
        }),
        onOverflow: handleCommandOverflow,
        protocol,
    });
    fatalRecovery = createRenderSurfaceFatalRecovery({
        getActiveSessionId: () => activeSessionId,
        loadReplacement: () => loadCurrentAnimation({ recovery: true }),
        onFailed: ({ reason }) => {
            const message = `Playback surface recovery failed: ${reason}`;
            logEvent('native', 'render-surface-recovery-failed', message);
            showError(message);
            publishAuthorityState();
        },
        onRecovering: () => {
            isLoaded = false;
            setRenderSurfaceFpsState(documentRef, false);
            updateInfo('Playback surface interrupted; recovering.');
            void invokeQuietly('hide_render_surface');
            publishAuthorityState();
        },
    });
    const visibilityController = createRenderSurfaceVisibilityController({
        canShowMainCanvas: () => fatalRecovery.canShowNativeSurface(),
        documentRef,
        elements,
        invokeQuietly,
        isActive: () => Boolean(activeSessionId) && !disposed && fatalRecovery.canShowNativeSurface(),
    });
    const { canReveal, setMainCanvasVisible, sync: syncNativeVisibility } = visibilityController;
    const eventRelay = createRenderSurfaceEventRelay({
        commandRelay: activationCoordinator.relay,
        documentRef,
        getPresentationState,
        onImageCommand: (payload) => imageReplayCache.capture(
            payload,
            activationCoordinator.getCommandSessionId(),
        ),
    });
    const loadTracker = createRenderSurfaceLoadTracker({
        isStillStaged: (sessionId) => sessionId === surfaceSessionId && activeSessionId !== sessionId,
        onTimeout: (sessionId) => {
            void rejectStagedSession(sessionId, {
                info: 'Playback surface update timed out; previous frame retained.',
                logName: 'render-surface-timeout',
                logText: 'Staged render surface did not report a first frame; retaining the previous surface.',
            });
        },
        timeoutMs: LOAD_TIMEOUT_MS,
        windowRef,
    });
    function restoreActiveSession() {
        surfaceSessionId = activeSessionId; surfaceCreated = Boolean(activeSessionId); stagedReady = Boolean(activeSessionId);
        if (activeSessionId) protocol.beginSession(activeSessionId, RENDER_SURFACE_PROTOCOL_VERSION);
    }
    async function rejectStagedSession(sessionId, { error = null, info = null, logName = null, logText = null } = {}) {
        if (!sessionId || sessionId === activeSessionId) return false;
        if (!activationLifecycle.beginRejection(sessionId)) return false;
        autoplayPolicy.forget(sessionId); fatalRecovery.cancelDeliberateReplacement(sessionId);
        const ownsCurrentStage = sessionId === surfaceSessionId;
        const failureMessage = error?.message || error || info || logText;
        if (ownsCurrentStage && failureMessage) lastActivationFailure = new Error(String(failureMessage));
        if (ownsCurrentStage) {
            loadTracker.clearTimeout();
            stagedReady = false;
        }
        imageReplayCache.rejectStage(sessionId);
        if (activatingSessionId === sessionId) activatingSessionId = null;
        // Revoke JS routing and authority synchronously. A late loaded receipt
        // received while native disposal is pending can no longer reactivate
        // this candidate or receive a control command.
        protocol.discardSession(sessionId);
        loadTracker.settle(sessionId, false);
        activationCoordinator.endStage(sessionId, false);
        if (ownsCurrentStage) {
            restoreActiveSession();
            if (activeSessionId) void activationCoordinator.flushQueued();
            else activationCoordinator.clear();
        }
        if (logName) logEvent('native', logName, logText || info || error || 'Staged playback surface rejected.');
        if (info) updateInfo(info);
        if (error) showError(error);
        await invokeQuietly('discard_render_surface', { sessionId });
        activationLifecycle.endRejection(sessionId);
        return false;
    }
    const loadOperation = createRenderSurfaceLoadOperation({
        activationCoordinator,
        activationFailure: {
            get: () => lastActivationFailure,
            set: (value) => { lastActivationFailure = value; },
        },
        activationLifecycle, autoplayPolicy, boundsSync, demoExportController, elements, eventRelay,
        fatalRecovery, getTauriInvoker, handleChildLoaded, imageReplayCache, invokeQuietly,
        isDisposed: () => disposed, isTauriEnvironment, loadTracker, logEvent, protocol,
        rejectStagedSession,
        sessionState: {
            beginStage: (sessionId) => {
                surfaceSessionId = sessionId;
                stagedReady = false;
            },
            getSurfaceSessionId: () => surfaceSessionId,
            markCreated: () => { surfaceCreated = true; },
        },
        showError, timeoutMs: LOAD_TIMEOUT_MS, updateInfo, windowRef,
    });
    const loadCurrentAnimation = loadOperation.load;
    const loadCurrentAnimationForSelection = loadOperation.loadForSelection;
    const sendCommand = (type, payload = {}) => activationCoordinator.requestCommand(type, payload);
    const captureSession = createRenderSurfaceCaptureSession({
        getSessionId: () => activeSessionId,
        isActive: () => Boolean(activeSessionId) && !disposed && fatalRecovery.canAcceptCommands(),
        sendCommand,
        windowRef,
    });
    const requestImageCommand = (payload = {}) => {
        imageReplayCache.capture(payload, activationCoordinator.getCommandSessionId());
        return activationCoordinator.requestCommand('vm-image-set', payload);
    };
    const activateChildLoaded = createRenderSurfaceActivationHandler({
        activationCoordinator, autoplayPolicy, boundsSync, canReveal, documentRef, eventRelay,
        fatalRecovery, getControlSnapshot, imageReplayCache, invokeQuietly, loadTracker, logEvent,
        protocol, publishAuthorityState, rejectStagedSession,
        sessionState: {
            getActiveSessionId: () => activeSessionId,
            getActivatingSessionId: () => activatingSessionId,
            getSurfaceSessionId: () => surfaceSessionId,
            clearActivatingSessionId: (sessionId) => {
                if (activatingSessionId === sessionId) activatingSessionId = null;
            },
            isDisposed: () => disposed,
            isCurrentSession: (sessionId) => sessionId === surfaceSessionId
                && activationLifecycle.isCurrent(sessionId, surfaceSessionId),
            isRejectingSession: activationLifecycle.isRejecting,
            runActivationTransaction: activationLifecycle.run,
            setActiveSessionId: (value) => {
                if (activeSessionId && activeSessionId !== value) {
                    activationLifecycle.retire(activeSessionId);
                }
                activeSessionId = value;
            },
            setActivatingSessionId: (value) => { activatingSessionId = value; },
            setLoaded: (value) => { isLoaded = value; },
            setStagedReady: (value) => { stagedReady = value; },
            setSurfaceIdentity: (value) => {
                surfaceSessionId = value; surfaceCreated = true; stagedReady = true;
            },
        },
        syncNativeVisibility,
        updateInfo,
    });
    function handleChildLoaded(event) {
        return activationLifecycle.handleLoaded(event, activateChildLoaded);
    }
    const handlers = createRenderSurfaceBridgeHandlers({
        clearLoadTimeout: loadTracker.clearTimeout,
        documentRef,
        fatalRecovery,
        getActiveSessionId: () => activeSessionId,
        invokeQuietly,
        isDisposed: () => disposed,
        logEvent,
        onChildPointerDown: (detail) => {
            const CustomEventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
            if (typeof documentRef?.dispatchEvent !== 'function' || typeof CustomEventCtor !== 'function') return;
            documentRef.dispatchEvent(new CustomEventCtor('rav:render-surface-pointerdown', { detail }));
        },
        onChildCapture: captureSession.handleResponse,
        protocol,
        rejectStagedSession,
        setStagedReady: (value) => { stagedReady = value; },
    });
    async function setup() {
        if (isSetup || disposed || !isTauriEnvironment()) {
            return false;
        }
        isSetup = true;
        try {
            await registerRenderSurfaceControllerListeners({
                getTauriEventListener,
                handlers: {
                    ...handlers,
                    handleChildAck: protocol.handleAck,
                    handleChildState: protocol.handleState,
                    handleChildLoaded,
                },
                unlistenCallbacks,
            });
        } catch (error) {
            isSetup = false;
            logEvent('native', 'render-surface-bridge-error', 'Unable to attach isolated render surface events.', error);
            return false;
        }
        publishAuthorityState();
        documentRef?.addEventListener?.(RAV_ANIMATION_LOADED_EVENT, loadCurrentAnimation);
        eventRelay.setup();
        windowRef?.addEventListener?.('resize', boundsSync.schedule);
        if (typeof ResizeObserverCtor === 'function' && elements.canvasContainer) {
            resizeObserver = new ResizeObserverCtor(boundsSync.schedule);
            resizeObserver.observe(elements.canvasContainer);
        }
        mutationObserver = observeBlockingMainUi({
            documentRef,
            elements,
            MutationObserverCtor,
            onChange: syncNativeVisibility,
        });
        return true;
    }
    const disposeController = createRenderSurfaceDisposer({ activationCoordinator, boundsSync, documentRef,
        eventRelay, imageReplayCache, invokeQuietly, isDisposed: () => disposed,
        loadCurrentAnimation, loadTracker, markDisposed: () => { disposed = true; },
        mutationObserver, publishAuthorityState, protocol, resizeObserver,
        setFpsState: setRenderSurfaceFpsState, setLoaded: (value) => { isLoaded = value; },
        setMainCanvasVisible, unlistenCallbacks, windowRef });
    function dispose() {
        captureSession.dispose();
        loadOperation.cancel();
        activationLifecycle.dispose();
        return disposeController();
    }
    function getState() {
        const protocolState = protocol.getState();
        return buildRenderSurfaceState({
            activatingSessionId,
            activeSessionId,
            canAcceptCommands: !disposed && isLoaded && Boolean(activeSessionId) && fatalRecovery.canAcceptCommands(),
            isLoaded,
            isSetup,
            pendingCommands: activationCoordinator.pendingQueued() + activationCoordinator.pendingStage(),
            protocolState,
            recoveryState: fatalRecovery.getState().state,
            sessionId: surfaceSessionId,
            stagedReady,
            surfaceCreated,
        });
    }
    return {
        dispose,
        getCanonicalState: () => protocol.getState().canonicalState,
        getState,
        loadCurrentAnimation,
        loadCurrentAnimationForSelection,
        requestImageCommand,
        requestCommand: sendCommand,
        sendCommand,
        setup,
        syncBounds: boundsSync.sync,
    };
}
