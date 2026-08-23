import {
    RAV_ANIMATION_LOADED_EVENT,
    RAV_PLAYBACK_COMMAND_EVENT,
    RAV_PRESENTATION_CHANGED_EVENT,
    RAV_VM_CONTROL_MUTATED_EVENT,
} from '../../rive/control-events.js';
import { measureRenderSurfaceBounds, renderSurfaceBoundsKey } from './bounds.js';
import { createRenderSurfaceCommandRelay } from './command-buffer.js';
import { setRenderSurfaceFpsState } from './fps-indicator.js';
import {
    createRenderSurfaceVisibilityController,
    observeBlockingMainUi,
} from './visibility.js';

export { measureRenderSurfaceBounds } from './bounds.js';

const CHILD_COMMAND_EVENT = 'render-surface:command';
const CHILD_READY_EVENT = 'render-surface:ready';
const CHILD_LOADED_EVENT = 'render-surface:loaded';
const CHILD_ERROR_EVENT = 'render-surface:error';
const CHILD_METRICS_EVENT = 'render-surface:metrics';
const LOAD_TIMEOUT_MS = 15_000;

export function createRenderSurfaceController({
    callbacks = {},
    demoExportController,
    documentRef = globalThis.document,
    elements = {},
    MutationObserverCtor = globalThis.MutationObserver,
    ResizeObserverCtor = globalThis.ResizeObserver,
    windowRef = globalThis.window,
} = {}) {
    const {
        getControlSnapshot = () => [],
        getPresentationState = () => ({}),
        getTauriEventListener = async () => null,
        getTauriInvoker = () => null,
        isTauriEnvironment = () => false,
        logEvent = () => {},
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    let boundsFrameId = null;
    let disposed = false;
    let isLoaded = false;
    let isSetup = false;
    let lastBoundsKey = null;
    let loadGeneration = 0;
    let loadTimeoutId = null;
    let mutationObserver = null;
    let pendingPresentationState = {};
    let resizeObserver = null;
    let sessionSequence = 0;
    let surfaceCreated = false;
    let surfaceSessionId = null;
    const unlistenCallbacks = [];

    const requestFrame = typeof windowRef?.requestAnimationFrame === 'function'
        ? windowRef.requestAnimationFrame.bind(windowRef)
        : (callback) => windowRef.setTimeout(callback, 0);
    const cancelFrame = typeof windowRef?.cancelAnimationFrame === 'function'
        ? windowRef.cancelAnimationFrame.bind(windowRef)
        : windowRef.clearTimeout.bind(windowRef);

    async function invokeQuietly(command, args = {}) {
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') {
            return false;
        }
        try {
            await invoke(command, args);
            return true;
        } catch {
            return false;
        }
    }

    const visibilityController = createRenderSurfaceVisibilityController({
        documentRef,
        elements,
        invokeQuietly,
        isActive: () => surfaceCreated && isLoaded && !disposed,
    });
    const { setMainCanvasVisible, sync: syncNativeVisibility } = visibilityController;
    const commandRelay = createRenderSurfaceCommandRelay({
        canSend: () => surfaceCreated && isLoaded,
        send: sendCommand,
    });

    function readPresentationState(detail = {}) {
        let current = {};
        try {
            current = getPresentationState() || {};
        } catch {
            /* retain the last valid presentation state */
        }
        return { ...pendingPresentationState, ...current, ...detail };
    }

    function clearLoadTimeout() {
        if (loadTimeoutId !== null) {
            windowRef.clearTimeout(loadTimeoutId);
            loadTimeoutId = null;
        }
    }

    function armLoadTimeout(sessionId) {
        clearLoadTimeout();
        loadTimeoutId = windowRef.setTimeout(() => {
            if (sessionId !== surfaceSessionId || isLoaded) {
                return;
            }
            setMainCanvasVisible(true);
            void invokeQuietly('hide_render_surface');
            logEvent('native', 'render-surface-timeout', 'Dedicated render surface did not report ready; using the main canvas.');
            updateInfo('Dedicated render surface timed out; using fallback canvas.');
        }, LOAD_TIMEOUT_MS);
    }

    async function syncBounds({ force = false } = {}) {
        const bounds = measureRenderSurfaceBounds(elements.canvasContainer);
        if (!bounds) {
            return false;
        }
        const nextKey = renderSurfaceBoundsKey(bounds);
        if (!force && nextKey === lastBoundsKey) {
            return true;
        }
        lastBoundsKey = nextKey;
        if (!surfaceCreated) {
            return true;
        }
        return invokeQuietly('set_render_surface_bounds', bounds);
    }

    function scheduleBoundsSync() {
        if (boundsFrameId !== null || disposed) {
            return;
        }
        boundsFrameId = requestFrame(() => {
            boundsFrameId = null;
            void syncBounds();
        });
    }

    async function loadCurrentAnimation() {
        if (disposed || !isTauriEnvironment() || typeof demoExportController?.buildRenderSurfaceContext !== 'function') {
            return false;
        }
        const invoke = getTauriInvoker();
        const bounds = measureRenderSurfaceBounds(elements.canvasContainer);
        if (typeof invoke !== 'function' || !bounds) {
            return false;
        }

        const generation = ++loadGeneration;
        const sessionId = `${Date.now().toString(36)}-${(++sessionSequence).toString(36)}`;
        surfaceSessionId = sessionId;
        isLoaded = false;
        commandRelay.clear();
        pendingPresentationState = readPresentationState();
        setMainCanvasVisible(true);
        setRenderSurfaceFpsState(documentRef, false);
        await invokeQuietly('hide_render_surface');

        try {
            const context = await demoExportController.buildRenderSurfaceContext();
            if (disposed || generation !== loadGeneration) {
                return false;
            }
            await invoke('create_render_surface', {
                request: {
                    ...bounds,
                    payload: context.payload,
                    sessionId,
                },
            });
            surfaceCreated = true;
            lastBoundsKey = renderSurfaceBoundsKey(bounds);
            armLoadTimeout(sessionId);
            logEvent(
                'native',
                'render-surface-create',
                `Loading isolated render surface for ${context.currentFileName || 'animation'}.`,
            );
            return true;
        } catch (error) {
            if (generation !== loadGeneration) {
                return false;
            }
            surfaceCreated = false;
            setMainCanvasVisible(true);
            const message = String(error?.message || error || 'unknown error');
            logEvent('native', 'render-surface-create-error', 'Unable to create isolated render surface.', error);
            showError(`Isolated render surface unavailable: ${message}`);
            return false;
        }
    }

    async function sendCommand(type, payload = {}) {
        if (!surfaceCreated || !isLoaded || !surfaceSessionId) {
            return false;
        }
        return invokeQuietly('send_render_surface_message', {
            event: CHILD_COMMAND_EVENT,
            payload: {
                sessionId: surfaceSessionId,
                type,
                payload,
            },
        });
    }

    function handleControlMutation(event) {
        const detail = event?.detail;
        const descriptor = detail?.descriptor;
        if (!descriptor || !detail?.kind) {
            return;
        }
        const isStateMachine = descriptor.source === 'state-machine';
        const isTrigger = detail.action === 'fire' || detail.kind === 'trigger';
        const command = isStateMachine
            ? (isTrigger ? 'sm-fire' : 'sm-set')
            : (isTrigger ? 'vm-fire' : 'vm-set');
        commandRelay.relay(command, {
            ...descriptor,
            kind: detail.kind,
            value: detail.value,
        });
    }

    function handlePlaybackCommand(event) {
        const command = event?.detail?.command;
        if (command === 'play' || command === 'pause' || command === 'reset') {
            commandRelay.relay(command, event?.detail?.payload || {});
        }
    }

    function handlePresentationChange(event) {
        pendingPresentationState = readPresentationState(event?.detail);
        if (surfaceCreated && isLoaded) {
            void sendCommand('presentation', pendingPresentationState);
        }
    }

    function eventMatchesCurrentSession(event) {
        const sessionId = event?.payload?.sessionId;
        return !sessionId || sessionId === surfaceSessionId;
    }

    async function handleChildLoaded(event) {
        if (!eventMatchesCurrentSession(event) || event?.payload?.command) {
            return;
        }
        clearLoadTimeout();
        isLoaded = true;
        setRenderSurfaceFpsState(documentRef, true);
        pendingPresentationState = readPresentationState();
        let snapshot = [];
        try {
            snapshot = getControlSnapshot() || [];
        } catch {
            /* the queued mutations below remain authoritative */
        }
        if (Array.isArray(snapshot) && snapshot.length) {
            await sendCommand('snapshot', { snapshot });
        }
        await sendCommand('presentation', pendingPresentationState);
        await commandRelay.flush();
        const shown = await syncNativeVisibility();
        if (shown) {
            logEvent('native', 'render-surface-loaded', 'Isolated render surface is active.');
            updateInfo('Isolated render surface active.');
        }
    }

    function handleChildError(event) {
        if (!eventMatchesCurrentSession(event)) {
            return;
        }
        clearLoadTimeout();
        isLoaded = false;
        setMainCanvasVisible(true);
        setRenderSurfaceFpsState(documentRef, false);
        void invokeQuietly('hide_render_surface');
        const message = String(event?.payload?.message || 'unknown renderer error');
        logEvent('native', 'render-surface-error', `Isolated render surface failed: ${message}`, event?.payload);
        showError(`Isolated render surface failed: ${message}`);
    }

    function handleDialogMutation() {
        void syncNativeVisibility();
    }

    function handleChildMetrics(event) {
        if (!eventMatchesCurrentSession(event) || !isLoaded) {
            return;
        }
        setRenderSurfaceFpsState(documentRef, true, event?.payload?.fps);
    }

    async function registerTauriListeners() {
        const listen = await getTauriEventListener();
        if (typeof listen !== 'function') {
            return;
        }
        const registrations = [
            [CHILD_READY_EVENT, () => {}],
            [CHILD_LOADED_EVENT, handleChildLoaded],
            [CHILD_ERROR_EVENT, handleChildError],
            [CHILD_METRICS_EVENT, handleChildMetrics],
        ];
        for (const [eventName, handler] of registrations) {
            const unlisten = await listen(eventName, handler);
            if (typeof unlisten === 'function') {
                unlistenCallbacks.push(unlisten);
            }
        }
    }

    async function setup() {
        if (isSetup || disposed || !isTauriEnvironment()) {
            return false;
        }
        isSetup = true;
        try {
            await registerTauriListeners();
        } catch (error) {
            isSetup = false;
            logEvent('native', 'render-surface-bridge-error', 'Unable to attach isolated render surface events.', error);
            return false;
        }
        documentRef?.addEventListener?.(RAV_ANIMATION_LOADED_EVENT, loadCurrentAnimation);
        documentRef?.addEventListener?.(RAV_VM_CONTROL_MUTATED_EVENT, handleControlMutation);
        documentRef?.addEventListener?.(RAV_PLAYBACK_COMMAND_EVENT, handlePlaybackCommand);
        documentRef?.addEventListener?.(RAV_PRESENTATION_CHANGED_EVENT, handlePresentationChange);
        windowRef?.addEventListener?.('resize', scheduleBoundsSync);

        if (typeof ResizeObserverCtor === 'function' && elements.canvasContainer) {
            resizeObserver = new ResizeObserverCtor(scheduleBoundsSync);
            resizeObserver.observe(elements.canvasContainer);
        }
        mutationObserver = observeBlockingMainUi({
            documentRef,
            elements,
            MutationObserverCtor,
            onChange: handleDialogMutation,
        });
        return true;
    }

    function dispose() {
        if (disposed) {
            return;
        }
        disposed = true;
        clearLoadTimeout();
        if (boundsFrameId !== null) {
            cancelFrame(boundsFrameId);
            boundsFrameId = null;
        }
        resizeObserver?.disconnect?.();
        mutationObserver?.disconnect?.();
        documentRef?.removeEventListener?.(RAV_ANIMATION_LOADED_EVENT, loadCurrentAnimation);
        documentRef?.removeEventListener?.(RAV_VM_CONTROL_MUTATED_EVENT, handleControlMutation);
        documentRef?.removeEventListener?.(RAV_PLAYBACK_COMMAND_EVENT, handlePlaybackCommand);
        documentRef?.removeEventListener?.(RAV_PRESENTATION_CHANGED_EVENT, handlePresentationChange);
        windowRef?.removeEventListener?.('resize', scheduleBoundsSync);
        unlistenCallbacks.splice(0).forEach((unlisten) => unlisten());
        setMainCanvasVisible(true);
        setRenderSurfaceFpsState(documentRef, false);
        void invokeQuietly('close_render_surface');
    }

    function getState() {
        return {
            isLoaded,
            isSetup,
            pendingCommands: commandRelay.size(),
            sessionId: surfaceSessionId,
            surfaceCreated,
        };
    }

    return {
        dispose,
        getState,
        loadCurrentAnimation,
        sendCommand,
        setup,
        syncBounds,
    };
}
