import {
    createRenderSurfaceController,
    measureRenderSurfaceBounds,
    RENDER_SURFACE_AUTHORITY_EVENT,
} from '../../../src/app/platform/render-surface/controller.js';
import {
    dispatchPlaybackCommand,
    dispatchPresentationChanged,
    dispatchVmControlMutation,
} from '../../../src/app/rive/control-events.js';

class FakeResizeObserver {
    constructor(callback) {
        this.callback = callback;
    }

    observe() {}

    disconnect() {}
}

function deferred() {
    let reject, resolve;
    const promise = new Promise((next, fail) => { resolve = next; reject = fail; });
    return { promise, reject, resolve };
}

async function withRealTimers(callback) {
    vi.useRealTimers();
    try {
        return await callback();
    } finally {
        vi.useFakeTimers();
    }
}

function canonicalNumberHierarchy(value, path = 'Test Color') {
    return {
        children: [{
            children: [],
            inputs: [{
                descriptor: { kind: 'color', name: path, path, source: 'view-model' },
                kind: 'color',
                name: path,
                path,
                source: 'view-model',
                value,
            }],
            kind: 'vm',
            label: 'Root VM',
            path: '<root>',
        }],
        inputs: [],
        kind: 'controls',
        label: 'Controls',
        path: '<controls>',
    };
}

function createHarness({
    acknowledgeCommand = null,
    autoAcknowledge = false,
    autoCanonicalBaseline = true,
    canonicalBaseline = null,
    controlSnapshot = [],
    invokeCommand = null,
    presentationState = {},
    renderSurfaceContexts = null,
} = {}) {
    document.body.innerHTML = `
        <div id="fps-chip"><span class="dot"></span>-- FPS</div>
        <div id="error-message"></div>
        <div id="settings-popover" hidden></div>
        <aside id="install-counter-notice" hidden></aside>
        <div id="canvas-container"><canvas id="rive-canvas"></canvas></div>
    `;
    const canvasContainer = document.getElementById('canvas-container');
    const canvas = document.getElementById('rive-canvas');
    canvasContainer.getBoundingClientRect = () => ({
        bottom: 440,
        height: 360,
        left: 100,
        right: 740,
        top: 80,
        width: 640,
        x: 100,
        y: 80,
    });

    const eventHandlers = new Map();
    const latestStateBySession = new Map();
    const showError = vi.fn();
    const updateInfo = vi.fn();
    const invoke = vi.fn(async (command, args) => {
        if ((autoAcknowledge || acknowledgeCommand) && command === 'send_render_surface_message') {
            const override = acknowledgeCommand?.(args.payload) || {};
            if (!override.defer) queueMicrotask(() => {
                eventHandlers.get('render-surface:ack')?.({ payload: {
                    applied: override.applied ?? true,
                    canonicalDelta: override.canonicalDelta,
                    commandId: args.payload.commandId,
                    message: override.message,
                    revision: args.payload.revision,
                    sessionId: args.payload.sessionId,
                    status: override.status || 'applied',
                } });
                if (autoCanonicalBaseline && (override.applied ?? true)
                    && args.payload.type === 'prepare-frame') {
                    const previous = latestStateBySession.get(args.payload.sessionId) || {};
                    if (!previous.controlsHierarchy) {
                        queueMicrotask(() => eventHandlers.get('render-surface:state')?.({ payload: {
                            ...previous,
                            controlsHierarchy: canonicalBaseline || {
                                children: [], inputs: [], kind: 'controls', label: 'Controls', path: '<controls>',
                            },
                            sessionId: args.payload.sessionId,
                            stateRevision: Math.max(
                                Number(previous.stateRevision ?? previous.revision) || 0,
                                args.payload.revision,
                            ) + 1,
                            stateType: 'snapshot',
                            topologyRevision: Math.max(1, Number(previous.topologyRevision) || 0),
                        } }));
                    }
                }
            });
        }
        return invokeCommand ? invokeCommand(command, args) : null;
    });
    const contexts = Array.isArray(renderSurfaceContexts) ? [...renderSurfaceContexts] : null;
    const buildRenderSurfaceContext = vi.fn(async () => contexts?.shift() || ({
        currentFileName: 'complex-demo.riv',
        payload: { file_name: 'complex-demo.riv' },
        sourceIdentity: 'file-1',
    }));
    const controller = createRenderSurfaceController({
        callbacks: {
            getControlSnapshot: () => controlSnapshot,
            getPresentationState: () => presentationState,
            getTauriEventListener: async () => async (eventName, handler) => {
                eventHandlers.set(eventName, eventName === 'render-surface:state'
                    ? (event) => {
                        if (event?.payload?.sessionId) latestStateBySession.set(event.payload.sessionId, event.payload);
                        return handler(event);
                    }
                    : handler);
                return () => eventHandlers.delete(eventName);
            },
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
            logEvent: vi.fn(),
            showError,
            updateInfo,
        },
        demoExportController: { buildRenderSurfaceContext },
        documentRef: document,
        elements: {
            canvasContainer,
            error: document.getElementById('error-message'),
            installCounterNotice: document.getElementById('install-counter-notice'),
            settingsPopover: document.getElementById('settings-popover'),
        },
        MutationObserverCtor: MutationObserver,
        ResizeObserverCtor: FakeResizeObserver,
        windowRef: window,
    });

    return {
        buildRenderSurfaceContext,
        canvas,
        controller,
        eventHandlers,
        invoke,
        showError,
        settingsPopover: document.getElementById('settings-popover'),
        updateInfo,
    };
}

async function activateInitialSurface(harness, artboard = 'Previous Artboard') {
    const load = harness.controller.loadCurrentAnimation();
    await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
    const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
    harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId } });
    harness.eventHandlers.get('render-surface:state')({ payload: {
        artboard,
        controlsHierarchy: canonicalNumberHierarchy(23, 'Previous Value'),
        sessionId,
        stateRevision: 1,
        stateType: 'snapshot',
        topologyRevision: 1,
    } });
    await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId } });
    await expect(load).resolves.toBe(true);
    return sessionId;
}

describe('platform/render-surface/controller', () => {
    it('measures logical child-WebView bounds from the canvas host', () => {
        const element = {
            getBoundingClientRect: () => ({ left: 10.4, top: 20.6, width: 799.7, height: 449.5 }),
        };
        expect(measureRenderSurfaceBounds(element)).toEqual({ x: 10, y: 21, width: 800, height: 450 });
        expect(measureRenderSurfaceBounds({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 10 }) })).toBeNull();
    });

    it('swaps to the synchronized child and relays live control/playback commands', async () => {
        const harness = createHarness({
            presentationState: {
                canvasColor: '#0d1117',
                canvasSizing: { mode: 'auto' },
                canvasTransparent: false,
                layoutAlignment: 'center',
                layoutFit: 'contain',
            },
        });
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));

        const createCall = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface');
        expect(createCall?.[1]?.request).toEqual(expect.objectContaining({
            height: 360,
            payload: { file_name: 'complex-demo.riv' },
            width: 640,
            x: 100,
            y: 80,
        }));
        const sessionId = createCall[1].request.sessionId;
        expect(harness.canvas.style.visibility).toBe('');

        await harness.eventHandlers.get('render-surface:loaded')({ payload: { sessionId } });
        await expect(loadPromise).resolves.toBe(true);
        expect(harness.invoke).toHaveBeenCalledWith('activate_render_surface', { reveal: true, sessionId });
        expect(harness.invoke).toHaveBeenCalledWith('restore_render_surface', {});
        expect(harness.canvas.style.visibility).toBe('hidden');
        expect(harness.canvas.style.pointerEvents).toBe('none');
        expect(document.getElementById('fps-chip').textContent).toBe('-- FPS');
        expect(document.querySelector('#fps-chip .fps-chip-pending-label')).toBeNull();
        const initialRelays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
        expect(initialRelays.map(([, args]) => args.payload.type)).toEqual([
            'presentation', 'activate-callbacks', 'prepare-frame', 'prepare-frame',
        ]);
        const createCountBeforeCommands = harness.invoke.mock.calls.filter(
            ([command]) => command === 'create_render_surface',
        ).length;
        const hideCountBeforeCommands = harness.invoke.mock.calls.filter(
            ([command]) => command === 'hide_render_surface',
        ).length;

        harness.eventHandlers.get('render-surface:metrics')({ payload: { fps: 59.6, sessionId } });
        expect(document.getElementById('fps-chip').textContent).toBe('60 FPS');

        dispatchVmControlMutation(document, {
            descriptor: { kind: 'number', name: 'speed', path: 'speed', source: 'view-model' },
            kind: 'number',
            value: 42,
        });
        dispatchPlaybackCommand(document, 'pause');
        dispatchPlaybackCommand(document, 'reset', {
            params: { artboard: 'Main', autoplay: true, stateMachines: 'State Machine 1' },
            snapshot: [{ descriptor: { path: 'speed' }, kind: 'number', value: 42 }],
        });
        await vi.waitFor(() => {
            const relays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
            expect(relays).toHaveLength(7);
        });
        const relays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
        expect(relays[4][1].payload).toEqual(expect.objectContaining({
            commandId: expect.stringContaining(sessionId),
            payload: {
                kind: 'number',
                name: 'speed',
                path: 'speed',
                source: 'view-model',
                value: 42,
            },
            sessionId,
            type: 'vm-set',
        }));
        expect(relays[4][1].payload.protocolVersion).toBe(2);
        expect(relays[4][1].payload.revision).toBeGreaterThan(0);
        expect(relays[5][1].payload.type).toBe('pause');
        expect(relays[6][1].payload).toEqual(expect.objectContaining({
            payload: expect.objectContaining({
                params: expect.objectContaining({ artboard: 'Main', autoplay: true }),
                snapshot: expect.any(Array),
            }),
            type: 'reset',
        }));
        expect(harness.controller.getState().sessionId).toBe(sessionId);
        expect(harness.invoke.mock.calls.filter(
            ([command]) => command === 'create_render_surface',
        )).toHaveLength(createCountBeforeCommands);
        expect(harness.invoke.mock.calls.filter(
            ([command]) => command === 'hide_render_surface',
        )).toHaveLength(hideCountBeforeCommands);

        harness.controller.dispose();
        expect(harness.canvas.style.visibility).toBe('');
        expect(document.getElementById('fps-chip').textContent).toBe('-- FPS');
    });

    it('parks the authoritative native child while inline fallback Settings is visible', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const createCall = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface');
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { sessionId: createCall[1].request.sessionId } });
        await expect(loadPromise).resolves.toBe(true);
        harness.invoke.mockClear();

        harness.settingsPopover.hidden = false;
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('park_render_surface', {}));
        expect(harness.invoke).not.toHaveBeenCalledWith('hide_render_surface', {});
        expect(harness.canvas.style.visibility).toBe('');

        harness.settingsPopover.hidden = true;
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('restore_render_surface', {}));
        expect(harness.canvas.style.visibility).toBe('hidden');
        harness.controller.dispose();
    });

    it('activates playback normally while Settings is independently overlaid', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface')[1].request.sessionId;

        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId } });
        await expect(loadPromise).resolves.toBe(true);
        expect(harness.invoke).toHaveBeenCalledWith('activate_render_surface', { reveal: true, sessionId });
        expect(harness.invoke).toHaveBeenCalledWith('restack_ui_overlay', {});
        const restackOrder = harness.invoke.mock.invocationCallOrder[
            harness.invoke.mock.calls.findIndex(([command]) => command === 'restack_ui_overlay')
        ];
        const activationOrder = harness.invoke.mock.invocationCallOrder[
            harness.invoke.mock.calls.findIndex(([command]) => command === 'activate_render_surface')
        ];
        expect(restackOrder).toBeLessThan(activationOrder);
        expect(harness.invoke).not.toHaveBeenCalledWith('show_render_surface', {});
        expect(harness.canvas.style.visibility).toBe('hidden');

        expect(harness.canvas.style.visibility).toBe('hidden');
        harness.controller.dispose();
    });

    it('publishes command authority only for a loaded idle native session', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        const authority = [];
        const onAuthority = (event) => authority.push(event.detail);
        document.addEventListener(RENDER_SURFACE_AUTHORITY_EVENT, onAuthority);
        await harness.controller.setup();
        expect(authority.at(-1)).toEqual(expect.objectContaining({
            activeSessionId: null,
            canAcceptCommands: false,
            isLoaded: false,
            recoveryState: 'idle',
        }));

        const load = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId } });
        await load;
        expect(authority.at(-1)).toEqual(expect.objectContaining({
            activeSessionId: sessionId,
            canAcceptCommands: true,
            isLoaded: true,
            recoveryState: 'idle',
        }));

        harness.buildRenderSurfaceContext.mockRejectedValueOnce(new Error('recovery failed'));
        harness.eventHandlers.get('render-surface:error')({ payload: {
            message: 'active child failed',
            sessionId,
        } });
        await vi.waitFor(() => expect(harness.controller.getState().recoveryState).toBe('failed'));
        expect(authority.some((detail) => detail.recoveryState === 'recovering'
            && detail.canAcceptCommands === false)).toBe(true);
        expect(authority.at(-1)).toEqual(expect.objectContaining({
            activeSessionId: sessionId,
            canAcceptCommands: false,
            isLoaded: false,
            recoveryState: 'failed',
        }));

        document.removeEventListener(RENDER_SURFACE_AUTHORITY_EVENT, onAuthority);
        harness.controller.dispose();
    });

    it('keeps the active surface visible until a staged child confirms its first frame', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstCreate = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface');
        const firstSession = firstCreate[1].request.sessionId;
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { sessionId: firstSession } });
        await expect(firstLoad).resolves.toBe(true);

        harness.invoke.mockClear();
        const secondLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const secondCreate = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface');
        const secondSession = secondCreate[1].request.sessionId;
        expect(secondSession).not.toBe(firstSession);
        expect(harness.invoke).not.toHaveBeenCalledWith('hide_render_surface', {});
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', expect.any(Object));
        expect(harness.canvas.style.visibility).toBe('hidden');

        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: secondSession } });
        await expect(secondLoad).resolves.toBe(true);
        expect(harness.invoke).toHaveBeenCalledWith('activate_render_surface', { reveal: true, sessionId: secondSession });
        harness.controller.dispose();
    });

    it('lets an explicit autoplay selection replace a paused child without inheriting its pause', async () => {
        let replacementSession = null;
        const harness = createHarness({
            acknowledgeCommand: (command) => ({
                applied: true,
                canonicalDelta: command.sessionId === replacementSession && command.type === 'prepare-frame'
                    ? {
                        artboard: 'B',
                        controlsHierarchy: { children: [], inputs: [] },
                        playback: {
                            isPaused: false,
                            isPlaying: true,
                            name: 'Bounce',
                            type: 'animation',
                        },
                        stateRevision: 5,
                        topologyRevision: 1,
                    }
                    : undefined,
                status: 'applied',
            }),
        });
        await harness.controller.setup();

        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'A',
            controlsHierarchy: { children: [], inputs: [] },
            playback: { isPaused: true, isPlaying: false, name: 'Main', type: 'stateMachine' },
            stateRevision: 1,
            topologyRevision: 1,
            sessionId: firstSession,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;
        expect(harness.controller.getCanonicalState()?.playback).toMatchObject({
            isPaused: true,
            isPlaying: false,
        });

        harness.invoke.mockClear();
        const replacement = harness.controller.loadCurrentAnimation({ autoplay: true });
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const createRequest = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request;
        replacementSession = createRequest.sessionId;
        expect(createRequest.payload.autoplay).toBe(true);
        harness.eventHandlers.get('render-surface:ready')({ payload: {
            protocolVersion: 2,
            sessionId: replacementSession,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId: replacementSession,
        } });
        await replacement;

        const replacementCommands = harness.invoke.mock.calls
            .filter(([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === replacementSession
                && typeof args.payload.type === 'string')
            .map(([, args]) => args.payload.type);
        expect(replacementCommands).toEqual([
            'presentation', 'activate-callbacks', 'prepare-frame', 'prepare-frame',
        ]);
        expect(harness.controller.getCanonicalState()).toMatchObject({
            artboard: 'B',
            playback: {
                isPaused: false,
                isPlaying: true,
                name: 'Bounce',
                type: 'animation',
            },
        });
        harness.controller.dispose();
    });

    it('uses protocol-v2 command acknowledgements before activating the first rendered frame', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const createCall = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface');
        const sessionId = createCall[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId } });
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('send_render_surface_message', {
            event: 'render-surface:load',
            payload: { protocolVersion: 2, sessionId },
        }));
        harness.eventHandlers.get('render-surface:ready')({
            payload: { handshake: 'acknowledged', protocolVersion: 2, sessionId },
        });
        expect(harness.invoke.mock.calls.filter(([command, args]) => (
            command === 'send_render_surface_message' && args.event === 'render-surface:load'
        ))).toHaveLength(1);

        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: false, sessionId } });
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', expect.any(Object));
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId } });
        await expect(loadPromise).resolves.toBe(true);
        const sent = harness.invoke.mock.calls.filter(([command, args]) => (
            command === 'send_render_surface_message' && args.event === 'render-surface:command'
        ));
        expect(sent).toHaveLength(4);
        expect(sent[0][1].payload).toEqual(expect.objectContaining({
            commandId: `${sessionId}:1`,
            protocolVersion: 2,
            type: 'presentation',
        }));
        expect(sent[1][1].payload.type).toBe('activate-callbacks');
        expect(sent[2][1].payload.type).toBe('prepare-frame');
        expect(sent[3][1].payload.type).toBe('prepare-frame');
        expect(harness.invoke).toHaveBeenCalledWith('activate_render_surface', { reveal: true, sessionId });
        harness.controller.dispose();
    });

    it('rejects a staged child immediately when its bounded event facade is unavailable', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:diagnostic')({ payload: {
            eventApi: { available: false, emit: false, emitTo: false, listen: false },
            phase: 'event-api-missing',
            sessionId,
        } });

        await expect(loadPromise).resolves.toBe(false);
        expect(harness.invoke).toHaveBeenCalledWith('discard_render_surface', { sessionId });
        expect(harness.showError).toHaveBeenCalledWith(expect.stringContaining('bridge is unavailable'));
        harness.controller.dispose();
    });

    it('rejects a staged child immediately when its initial canonical baseline traversal fails', async () => {
        const harness = createHarness({ autoAcknowledge: true, autoCanonicalBaseline: false });
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId } });
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Broken Candidate',
            reason: 'load',
            sessionId,
            stateRevision: 1,
            stateType: 'bootstrap',
            topologyRevision: 0,
        } });
        const activation = harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId,
        } });
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === sessionId
                && args.payload.type === 'prepare-frame',
        )).toBe(true));

        harness.eventHandlers.get('render-surface:error')({ payload: {
            message: 'deep traversal failed',
            phase: 'canonical-initial-snapshot',
            recoverable: true,
            sessionId,
        } });

        await activation;
        await expect(loadPromise).resolves.toBe(false);
        expect(harness.invoke).toHaveBeenCalledWith('discard_render_surface', { sessionId });
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', expect.any(Object));
        expect(harness.showError).toHaveBeenCalledWith(expect.stringContaining('Playback controls could not be initialized'));
        harness.controller.dispose();
    });

    it('replays coalesced loading-time controls and forwards presentation changes', async () => {
        const harness = createHarness({
            controlSnapshot: [{
                descriptor: { kind: 'number', path: 'speed', source: 'view-model' },
                kind: 'number',
                value: 12,
            }],
            presentationState: { layoutAlignment: 'center', layoutFit: 'contain' },
        });
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        dispatchVmControlMutation(document, {
            descriptor: { kind: 'number', path: 'speed', source: 'view-model' },
            kind: 'number',
            value: 41,
        });
        dispatchVmControlMutation(document, {
            descriptor: { kind: 'number', path: 'speed', source: 'view-model' },
            kind: 'number',
            value: 42,
        });
        dispatchPlaybackCommand(document, 'pause');
        expect(harness.controller.getState().pendingCommands).toBe(2);

        const createCall = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface');
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { sessionId: createCall[1].request.sessionId } });
        await expect(loadPromise).resolves.toBe(true);
        const loadedRelays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
        expect(loadedRelays.map(([, args]) => args.payload.type)).toEqual([
            'snapshot',
            'presentation',
            'vm-set',
            'pause',
            'activate-callbacks',
            'prepare-frame',
            'prepare-frame',
        ]);
        expect(loadedRelays[2][1].payload.payload.value).toBe(42);
        expect(harness.controller.getState().pendingCommands).toBe(0);

        dispatchPresentationChanged(document, {
            canvasColor: '#112233',
            canvasSizing: { mode: 'fixed', width: 800, height: 600 },
            canvasTransparent: false,
            layoutAlignment: 'bottomRight',
            layoutFit: 'cover',
        });
        await vi.waitFor(() => {
            const relays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
            expect(relays.at(-1)[1].payload).toEqual(expect.objectContaining({
                type: 'presentation',
                payload: expect.objectContaining({
                    canvasColor: '#112233',
                    layoutAlignment: 'bottomRight',
                    layoutFit: 'cover',
                }),
            }));
        });
        harness.controller.dispose();
    });

    it('queues mutations at the activation barrier and applies them to the newly visible session', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;

        harness.invoke.mockClear();
        const secondLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const secondSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: secondSession } });
        const activation = harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: secondSession } });
        dispatchVmControlMutation(document, {
            descriptor: { kind: 'number', path: 'speed', source: 'view-model' },
            kind: 'number',
            value: 73,
        });
        await activation;
        await secondLoad;
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === secondSession
                && args.payload.type === 'vm-set'
                && args.payload.payload.value === 73,
        )).toBe(true));
        expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === firstSession
                && args.payload.payload?.value === 73,
        )).toBe(false);
        harness.controller.dispose();
    });

    it('publishes only active canonical state while a replacement stages', async () => {
        const harness = createHarness();
        const published = [];
        const onState = (event) => published.push(event.detail?.artboard);
        document.addEventListener('rav:render-surface-state', onState);
        await harness.controller.setup();

        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:state')({ payload: { artboard: 'A', revision: 1, sessionId: firstSession } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await expect(firstLoad).resolves.toBe(true);
        expect(published).toEqual(['A']);

        harness.invoke.mockClear();
        const secondLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const secondSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:state')({ payload: { artboard: 'B', revision: 1, sessionId: secondSession } });
        expect(harness.controller.getCanonicalState().artboard).toBe('A');
        expect(published).toEqual(['A']);

        harness.eventHandlers.get('render-surface:state')({ payload: { artboard: 'A-live', revision: 2, sessionId: firstSession } });
        expect(published).toEqual(['A', 'A-live']);
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: secondSession } });
        await expect(secondLoad).resolves.toBe(true);
        expect(published).toEqual(['A', 'A-live', 'B']);

        harness.eventHandlers.get('render-surface:state')({ payload: { artboard: 'stale-A', revision: 99, sessionId: firstSession } });
        expect(harness.controller.getCanonicalState().artboard).toBe('B');
        document.removeEventListener('rav:render-surface-state', onState);
        harness.controller.dispose();
    });

    it('does not activate or declare command authority until the staged canonical controls baseline is usable', async () => {
        const harness = createHarness({ autoAcknowledge: true, autoCanonicalBaseline: false });
        await harness.controller.setup();

        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'A',
            controlsHierarchy: canonicalNumberHierarchy(0xff000001),
            revision: 1,
            sessionId: firstSession,
            topologyRevision: 1,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await expect(firstLoad).resolves.toBe(true);

        harness.invoke.mockClear();
        const replacementLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const replacementSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: replacementSession } });
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'B',
            reason: 'load',
            revision: 1,
            sessionId: replacementSession,
            stateRevision: 1,
            stateType: 'bootstrap',
            topologyRevision: 0,
        } });
        const activation = harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId: replacementSession,
        } });
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === replacementSession
                && args.payload.type === 'prepare-frame',
        )).toBe(true));

        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId: replacementSession,
        });
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            isLoaded: true,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'A',
            controlsHierarchy: canonicalNumberHierarchy(0xff000001),
        }));

        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'B',
            controlsHierarchy: canonicalNumberHierarchy(0xff000002),
            revision: 2,
            sessionId: replacementSession,
            stateRevision: 2,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        await activation;
        await expect(replacementLoad).resolves.toBe(true);

        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: replacementSession,
            canAcceptCommands: true,
            isLoaded: true,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'B',
            controlsHierarchy: canonicalNumberHierarchy(0xff000002),
        }));
        expect(harness.invoke).toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId: replacementSession,
        });
        harness.controller.dispose();
    });

    it('keeps the old active surface when staged presentation is rejected', async () => {
        let rejectedSession = null;
        const harness = createHarness({
            acknowledgeCommand: (command) => command.sessionId === rejectedSession && command.type === 'presentation'
                ? { applied: false, message: 'layout refused', status: 'rejected' }
                : { applied: true, status: 'applied' },
        });
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await expect(firstLoad).resolves.toBe(true);

        harness.invoke.mockClear();
        const secondLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const secondSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        rejectedSession = secondSession;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: secondSession } });
        dispatchVmControlMutation(document, {
            descriptor: { kind: 'number', path: 'speed', source: 'view-model' },
            kind: 'number',
            value: 99,
        });
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === firstSession
                && args.payload.type === 'vm-set'
                && args.payload.payload.value === 99,
        )).toBe(true));
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: secondSession } });

        await expect(secondLoad).resolves.toBe(false);
        expect(harness.invoke).toHaveBeenCalledWith('discard_render_surface', { sessionId: secondSession });
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', { reveal: true, sessionId: secondSession });
        expect(harness.controller.getState().activeSessionId).toBe(firstSession);
        expect(harness.controller.getState().pendingCommands).toBe(0);
        expect(harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.type === 'vm-set'
                && args.payload.payload.value === 99,
        )).toHaveLength(1);
        expect(harness.showError).toHaveBeenCalledWith(expect.stringContaining('layout refused'));

        rejectedSession = null;
        dispatchVmControlMutation(document, {
            descriptor: { kind: 'number', path: 'speed', source: 'view-model' },
            kind: 'number',
            value: 100,
        });
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === firstSession
                && args.payload.type === 'vm-set'
                && args.payload.payload.value === 100,
        )).toBe(true));
        harness.controller.dispose();
    });

    it('activates a first-frame notification only once and ignores duplicates', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId } });
        const firstFrame = { payload: { firstFrame: true, sessionId } };
        await Promise.all([
            harness.eventHandlers.get('render-surface:loaded')(firstFrame),
            harness.eventHandlers.get('render-surface:loaded')(firstFrame),
        ]);
        await expect(loadPromise).resolves.toBe(true);
        expect(harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'activate_render_surface' && args.sessionId === sessionId,
        )).toHaveLength(1);
        harness.controller.dispose();
    });

    it('activates from the native fallback and deduplicates matching native and IPC startup receipts', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        const ready = {
            attempt: 0,
            handshake: 'pending',
            protocolVersion: 2,
            sessionId,
        };

        harness.eventHandlers.get('render-surface:ready')({ payload: { ...ready, transport: 'custom-protocol' } });
        harness.eventHandlers.get('render-surface:ready')({ payload: ready });
        await Promise.resolve();
        expect(harness.invoke.mock.calls.filter(([name, args]) => (
            name === 'send_render_surface_message' && args.event === 'render-surface:load'
        ))).toHaveLength(1);

        const loaded = { firstFrame: true, protocolVersion: 2, sessionId };
        await Promise.all([
            harness.eventHandlers.get('render-surface:loaded')({
                payload: { ...loaded, transport: 'custom-protocol' },
            }),
            harness.eventHandlers.get('render-surface:loaded')({ payload: loaded }),
        ]);
        await expect(loadPromise).resolves.toBe(true);
        expect(harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'activate_render_surface' && args.sessionId === sessionId,
        )).toHaveLength(1);
        harness.controller.dispose();
    });

    it('adopts protocol v2 from an early loaded receipt and waits for canonical controls before activation', async () => {
        const harness = createHarness({ autoAcknowledge: true, autoCanonicalBaseline: false });
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;

        const activation = harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            protocolVersion: 2,
            sessionId,
        } });
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === sessionId
                && args.payload.type === 'prepare-frame',
        )).toBe(true));
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId,
        });
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: null,
            canAcceptCommands: false,
            isLoaded: false,
        }));

        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Early Loaded',
            controlsHierarchy: canonicalNumberHierarchy(7),
            sessionId,
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        await activation;
        await expect(loadPromise).resolves.toBe(true);
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: sessionId,
            canAcceptCommands: true,
            isLoaded: true,
        }));
        harness.controller.dispose();
    });

    it('never exposes healthy authority when protocol state is discarded during native activation', async () => {
        let delayedSession = null;
        const nativeActivation = deferred();
        const harness = createHarness({
            autoAcknowledge: true,
            invokeCommand: (command, args) => command === 'activate_render_surface'
                && args.sessionId === delayedSession
                ? nativeActivation.promise
                : null,
        });
        const authority = [];
        const onAuthority = (event) => authority.push(event.detail);
        document.addEventListener(RENDER_SURFACE_AUTHORITY_EVENT, onAuthority);
        await harness.controller.setup();

        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;

        harness.invoke.mockClear();
        const replacementLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        delayedSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: delayedSession } });
        const activating = harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId: delayedSession,
        } });
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId: delayedSession,
        }));

        harness.eventHandlers.get('render-surface:error')({ payload: {
            message: 'candidate state was discarded',
            sessionId: delayedSession,
        } });
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('discard_render_surface', {
            sessionId: delayedSession,
        }));
        await expect(replacementLoad).resolves.toBe(false);
        harness.buildRenderSurfaceContext.mockRejectedValueOnce(new Error('recovery failed'));

        nativeActivation.resolve(null);
        await activating;
        await vi.waitFor(() => expect(harness.controller.getState().recoveryState).toBe('failed'));

        expect(authority).not.toContainEqual(expect.objectContaining({
            activeSessionId: delayedSession,
            canAcceptCommands: true,
            isLoaded: true,
        }));
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: delayedSession,
            canAcceptCommands: false,
            isLoaded: false,
            recoveryState: 'failed',
        }));

        document.removeEventListener(RENDER_SURFACE_AUTHORITY_EVENT, onAuthority);
        harness.controller.dispose();
    });

    it('serializes B native activation before staging a back-to-back C replacement', async () => {
        let delayedSession = null;
        const nativeActivation = deferred();
        const harness = createHarness({
            autoAcknowledge: true,
            invokeCommand: (command, args) => command === 'activate_render_surface'
                && args.sessionId === delayedSession
                ? nativeActivation.promise
                : null,
        });
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;

        harness.invoke.mockClear();
        const activatingLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        delayedSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: delayedSession } });
        const activating = harness.eventHandlers.get('render-surface:loaded')({
            payload: { firstFrame: true, sessionId: delayedSession },
        });
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId: delayedSession,
        }));

        const newerLoad = harness.controller.loadCurrentAnimation();
        await Promise.resolve();
        expect(harness.invoke.mock.calls.filter(([name]) => name === 'create_render_surface')).toHaveLength(1);
        expect(harness.controller.getState().activeSessionId).toBe(firstSession);

        nativeActivation.resolve(null);
        await activating;
        await expect(activatingLoad).resolves.toBe(true);
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: delayedSession,
            canAcceptCommands: true,
            isLoaded: true,
        }));
        await vi.waitFor(() => expect(harness.invoke.mock.calls.filter(
            ([name]) => name === 'create_render_surface',
        )).toHaveLength(2));
        const newerSession = harness.invoke.mock.calls.filter(
            ([name]) => name === 'create_render_surface',
        ).at(-1)[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: newerSession } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId: newerSession,
        } });
        await expect(newerLoad).resolves.toBe(true);
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: newerSession,
            canAcceptCommands: true,
            sessionId: newerSession,
        }));
        expect(harness.invoke.mock.calls.filter(
            ([name]) => name === 'activate_render_surface',
        ).map(([, args]) => args.sessionId)).toEqual([delayedSession, newerSession]);
        harness.controller.dispose();
    });

    it('latches loaded receipts until that exact native child create resolves and consumes them once', async () => {
        const nativeCreate = deferred();
        const harness = createHarness({
            autoAcknowledge: true,
            invokeCommand: (command) => command === 'create_render_surface' ? nativeCreate.promise : null,
        });
        await harness.controller.setup();
        const load = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        const loaded = { payload: { firstFrame: true, protocolVersion: 2, sessionId } };
        expect(await harness.eventHandlers.get('render-surface:loaded')(loaded)).toBe(false);
        expect(await harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: false,
            protocolVersion: 2,
            sessionId,
        } })).toBe(false);
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', expect.any(Object));

        nativeCreate.resolve(null);
        await expect(load).resolves.toBe(true);
        expect(harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'activate_render_surface' && args.sessionId === sessionId,
        )).toHaveLength(1);
        await harness.eventHandlers.get('render-surface:loaded')(loaded);
        expect(harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'activate_render_surface' && args.sessionId === sessionId,
        )).toHaveLength(1);
        harness.controller.dispose();
    });

    it('revokes a rejected stage before native discard and ignores a loaded receipt during disposal', async () => {
        let discardedSession = null;
        const nativeDiscard = deferred();
        const harness = createHarness({
            autoAcknowledge: true,
            invokeCommand: (command, args) => command === 'discard_render_surface'
                && args.sessionId === discardedSession ? nativeDiscard.promise : null,
        });
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Last Good Artboard',
            controlsHierarchy: canonicalNumberHierarchy(17, 'Last Good Value'),
            sessionId: firstSession,
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;

        harness.invoke.mockClear();
        const rejectedLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        discardedSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:diagnostic')({ payload: {
            eventApi: { emit: false, emitTo: false, listen: false },
            phase: 'bridge-ready',
            sessionId: discardedSession,
        } });
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('discard_render_surface', {
            sessionId: discardedSession,
        }));
        await harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            protocolVersion: 2,
            sessionId: discardedSession,
        } });
        await expect(rejectedLoad).resolves.toBe(false);
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId: discardedSession,
        });
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            sessionId: firstSession,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'Last Good Artboard',
            sessionId: firstSession,
        }));
        nativeDiscard.resolve(null);
        await Promise.resolve();
        harness.controller.dispose();
    });

    it('preserves the previous file identity and canonical metadata when a staged load times out', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Previous File Artboard',
            controlsHierarchy: canonicalNumberHierarchy(23, 'Previous File Value'),
            sessionId: firstSession,
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;

        harness.invoke.mockClear();
        const timedOutLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const timedOutSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        await vi.advanceTimersByTimeAsync(15_000);
        await expect(timedOutLoad).resolves.toBe(false);
        expect(harness.invoke).toHaveBeenCalledWith('discard_render_surface', { sessionId: timedOutSession });
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            sessionId: firstSession,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'Previous File Artboard',
            sessionId: firstSession,
        }));
        harness.controller.dispose();
    });

    it('times out a stalled context build while preserving the previous visible frame', async () => {
        const stalledContext = deferred();
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();
        const firstSession = await activateInitialSurface(harness, 'Context Baseline');

        harness.invoke.mockClear();
        harness.buildRenderSurfaceContext.mockImplementationOnce(() => stalledContext.promise);
        const replacement = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.buildRenderSurfaceContext).toHaveBeenCalledTimes(2));
        const stagedSession = harness.controller.getState().sessionId;
        expect(stagedSession).not.toBe(firstSession);
        expect(harness.invoke).not.toHaveBeenCalledWith('create_render_surface', expect.any(Object));

        await vi.advanceTimersByTimeAsync(15_000);
        await expect(replacement).resolves.toBe(false);
        expect(harness.invoke).toHaveBeenCalledWith('discard_render_surface', { sessionId: stagedSession });
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            isLoaded: true,
            sessionId: firstSession,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'Context Baseline',
            sessionId: firstSession,
        }));
        expect(harness.canvas.style.visibility).toBe('hidden');

        stalledContext.reject(new Error('late context failure'));
        await Promise.resolve();
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId: stagedSession,
        });
        harness.controller.dispose();
    });

    it('discards a native surface that finishes creating after the outer deadline', async () => {
        let stallNativeCreate = false;
        const nativeCreate = deferred();
        const harness = createHarness({
            autoAcknowledge: true,
            invokeCommand: (command) => command === 'create_render_surface' && stallNativeCreate
                ? nativeCreate.promise
                : null,
        });
        await harness.controller.setup();
        const firstSession = await activateInitialSurface(harness, 'Native Baseline');

        harness.invoke.mockClear();
        stallNativeCreate = true;
        const replacement = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const stagedSession = harness.invoke.mock.calls.find(
            ([name]) => name === 'create_render_surface',
        )[1].request.sessionId;

        await vi.advanceTimersByTimeAsync(15_000);
        await expect(replacement).resolves.toBe(false);
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            isLoaded: true,
            sessionId: firstSession,
        }));
        expect(harness.canvas.style.visibility).toBe('hidden');
        expect(harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'discard_render_surface' && args.sessionId === stagedSession,
        )).toHaveLength(1);

        nativeCreate.resolve(null);
        await vi.waitFor(() => expect(harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'discard_render_surface' && args.sessionId === stagedSession,
        )).toHaveLength(2));
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId: stagedSession,
        });
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'Native Baseline',
            sessionId: firstSession,
        }));
        harness.controller.dispose();
    });

    it('times out stalled control preflight without creating or replacing the visible child', async () => {
        let heldCommand = null;
        const heldTransport = deferred();
        const harness = createHarness({
            autoAcknowledge: true,
            invokeCommand: (command, args) => {
                if (command === 'send_render_surface_message' && args.payload.type === 'pause') {
                    heldCommand = args.payload;
                    return heldTransport.promise;
                }
                return null;
            },
        });
        await harness.controller.setup();
        const firstSession = await activateInitialSurface(harness, 'Preflight Baseline');
        const pendingCommand = harness.controller.sendCommand('pause');
        await vi.waitFor(() => expect(heldCommand).toEqual(expect.objectContaining({
            sessionId: firstSession,
            type: 'pause',
        })));

        harness.invoke.mockClear();
        const replacement = harness.controller.loadCurrentAnimation();
        await Promise.resolve();
        expect(harness.invoke).not.toHaveBeenCalledWith('create_render_surface', expect.any(Object));
        await vi.advanceTimersByTimeAsync(15_000);
        await expect(replacement).resolves.toBe(false);

        const discarded = harness.invoke.mock.calls.filter(([name]) => name === 'discard_render_surface');
        expect(discarded).toHaveLength(1);
        expect(discarded[0][1].sessionId).not.toBe(firstSession);
        expect(harness.invoke).not.toHaveBeenCalledWith('create_render_surface', expect.any(Object));
        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            isLoaded: true,
            sessionId: firstSession,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'Preflight Baseline',
            sessionId: firstSession,
        }));
        expect(harness.canvas.style.visibility).toBe('hidden');

        heldTransport.resolve(null);
        await expect(pendingCommand).resolves.toEqual(expect.objectContaining({ applied: true }));
        await Promise.resolve();
        expect(harness.invoke).not.toHaveBeenCalledWith('create_render_surface', expect.any(Object));
        harness.controller.dispose();
    });

    it('restores cached image controls when staging a replacement surface', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;
        dispatchVmControlMutation(document, {
            action: 'set-image',
            descriptor: { kind: 'image', path: 'avatar', source: 'view-model' },
            kind: 'image',
            value: [1, 2, 3],
        });
        await harness.controller.getState();

        harness.invoke.mockClear();
        const secondLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const secondSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: secondSession } });
        await secondLoad;
        const sent = harness.invoke.mock.calls.filter(([name]) => name === 'send_render_surface_message');
        expect(sent.map(([, args]) => args.payload.type)).toEqual([
            'vm-image-set', 'presentation', 'activate-callbacks', 'prepare-frame', 'prepare-frame',
        ]);
        expect(sent[0][1].payload.payload).toEqual(expect.objectContaining({ path: 'avatar', value: [1, 2, 3] }));
        harness.controller.dispose();
    });

    it('transfers an image changed during staging when the source file is unchanged', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;

        harness.invoke.mockClear();
        const secondLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const secondSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        dispatchVmControlMutation(document, {
            action: 'set-image',
            descriptor: { kind: 'image', path: 'avatar', source: 'view-model' },
            kind: 'image',
            value: [4, 5, 6],
        });
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === firstSession
                && args.payload.type === 'vm-image-set',
        )).toBe(true));
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: secondSession } });
        await secondLoad;
        expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === secondSession
                && args.payload.type === 'vm-image-set'
                && args.payload.payload.value.join(',') === '4,5,6',
        )).toBe(true);
        harness.controller.dispose();
    });

    it('journals direct MCP image set and clear ACKs for same-source surface replacement', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();

        const loadNextSurface = async () => {
            const previousCreateCount = harness.invoke.mock.calls.filter(
                ([name]) => name === 'create_render_surface',
            ).length;
            const load = harness.controller.loadCurrentAnimation();
            await vi.waitFor(() => expect(harness.invoke.mock.calls.filter(
                ([name]) => name === 'create_render_surface',
            )).toHaveLength(previousCreateCount + 1));
            const sessionId = harness.invoke.mock.calls.filter(
                ([name]) => name === 'create_render_surface',
            ).at(-1)[1].request.sessionId;
            await harness.eventHandlers.get('render-surface:loaded')({
                payload: { firstFrame: true, sessionId },
            });
            await expect(load).resolves.toBe(true);
            return sessionId;
        };

        await loadNextSurface();
        const leftImage = {
            action: 'set-image',
            descriptor: { kind: 'image', path: 'sub_1/sub_1_im', source: 'view-model' },
            imageSelection: { kind: 'file', label: 'left.png' },
            kind: 'image',
            path: 'sub_1/sub_1_im',
            source: 'view-model',
            value: [1, 2, 3],
        };
        const rightImage = {
            action: 'set-image',
            descriptor: { kind: 'image', path: 'sub_2/sub_2_im', source: 'view-model' },
            imageSelection: { kind: 'file', label: 'right.png' },
            kind: 'image',
            path: 'sub_2/sub_2_im',
            source: 'view-model',
            value: [4, 5, 6],
        };
        await expect(harness.controller.requestImageCommand(leftImage)).resolves.toEqual(
            expect.objectContaining({ applied: true }),
        );
        await expect(harness.controller.requestImageCommand(rightImage)).resolves.toEqual(
            expect.objectContaining({ applied: true }),
        );

        const resetSession = await loadNextSurface();
        let replayed = harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === resetSession
                && args.payload.type === 'vm-image-set',
        );
        expect(replayed.map(([, args]) => args.payload.payload)).toEqual([leftImage, rightImage]);

        const clearLeft = {
            ...leftImage,
            action: 'clear-image',
            imageSelection: null,
            value: null,
        };
        await expect(harness.controller.requestImageCommand(clearLeft)).resolves.toEqual(
            expect.objectContaining({ applied: true }),
        );

        const secondResetSession = await loadNextSurface();
        replayed = harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === secondResetSession
                && args.payload.type === 'vm-image-set',
        );
        expect(replayed.map(([, args]) => args.payload.payload)).toEqual([rightImage, clearLeft]);
        harness.controller.dispose();
    });

    it('waits for a delayed WebP ACK before creating B, then settles A -> B -> A without a replay loop', () => withRealTimers(async () => {
        let heldImageCommand = null;
        const harness = createHarness({
            acknowledgeCommand: (command) => {
                if (command.type === 'vm-image-set' && !heldImageCommand) {
                    heldImageCommand = command;
                    return { defer: true };
                }
                return {};
            },
            renderSurfaceContexts: [
                { currentFileName: 'images-a.riv', payload: { file_name: 'images-a.riv' }, sourceIdentity: 'images-a' },
                { currentFileName: 'other-b.riv', payload: { file_name: 'other-b.riv' }, sourceIdentity: 'other-b' },
                { currentFileName: 'images-a.riv', payload: { file_name: 'images-a.riv' }, sourceIdentity: 'images-a' },
            ],
        });
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId: firstSession } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;
        dispatchVmControlMutation(document, {
            action: 'set-image',
            descriptor: { kind: 'image', path: 'avatar', source: 'view-model' },
            kind: 'image',
            imageSelection: { kind: 'file', label: 'avatar.webp' },
            value: [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80],
        });
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === firstSession
                && args.payload.type === 'vm-image-set',
        )).toBe(true));
        expect(heldImageCommand).toEqual(expect.objectContaining({ sessionId: firstSession, type: 'vm-image-set' }));

        harness.invoke.mockClear();
        const secondLoad = harness.controller.loadCurrentAnimation();
        // The switch must remain asynchronous (the UI event loop is free) but
        // cannot create B before the unresolved A delivery has either been
        // journaled or rejected. This is the real native WebP race.
        let macrotaskRan = false;
        await new Promise((resolve) => setTimeout(() => { macrotaskRan = true; resolve(); }, 0));
        expect(macrotaskRan).toBe(true);
        expect(harness.invoke).not.toHaveBeenCalledWith('create_render_surface', expect.any(Object));

        harness.eventHandlers.get('render-surface:ack')({ payload: {
            applied: true,
            commandId: heldImageCommand.commandId,
            revision: heldImageCommand.revision,
            sessionId: firstSession,
            status: 'applied',
        } });
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const secondSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: secondSession } });
        await secondLoad;
        const types = harness.invoke.mock.calls
            .filter(([name]) => name === 'send_render_surface_message')
            .map(([, args]) => args.payload.type);
        expect(types).toEqual(['presentation', 'activate-callbacks', 'prepare-frame', 'prepare-frame']);

        const thirdLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke.mock.calls.filter(
            ([name]) => name === 'create_render_surface',
        )).toHaveLength(2));
        const thirdSession = harness.invoke.mock.calls.filter(
            ([name]) => name === 'create_render_surface',
        ).at(-1)[1].request.sessionId;
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: thirdSession } });
        await expect(thirdLoad).resolves.toBe(true);

        const replayedImages = harness.invoke.mock.calls.filter(
            ([name, args]) => name === 'send_render_surface_message'
                && args.payload.sessionId === thirdSession
                && args.payload.type === 'vm-image-set',
        );
        expect(replayedImages).toHaveLength(1);
        expect(replayedImages[0][1].payload.payload).toEqual(expect.objectContaining({
            imageSelection: { kind: 'file', label: 'avatar.webp' },
            path: 'avatar',
            value: [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80],
        }));
        expect(harness.invoke.mock.calls.filter(([name]) => name === 'activate_render_surface')).toHaveLength(2);
        expect(harness.invoke.mock.calls.filter(([name]) => name === 'create_render_surface')).toHaveLength(2);
        harness.controller.dispose();
    }));

    it('forwards timeline progress only from the active visible child', async () => {
        const harness = createHarness();
        const updates = [];
        const onProgress = (event) => updates.push(event.detail);
        document.addEventListener('rav:timeline-progress', onProgress);
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:state')({ payload: {
            playback: { currentFrame: 12, currentSeconds: 0.2, fps: 60, totalFrames: 120, totalSeconds: 2, type: 'animation' },
            revision: 1,
            sessionId,
        } });
        expect(updates).toEqual([]);
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId } });
        await loadPromise;
        expect(updates.at(-1)).toEqual(expect.objectContaining({ currentFrame: 12, playbackType: 'animation', totalFrames: 120 }));
        document.removeEventListener('rav:timeline-progress', onProgress);
        harness.controller.dispose();
    });

    it('publishes an acknowledged state-machine transition that clears the active timeline clock', async () => {
        const harness = createHarness();
        const updates = [];
        const onProgress = (event) => updates.push(event.detail);
        document.addEventListener('rav:timeline-progress', onProgress);
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:state')({ payload: {
            controlsHierarchy: { children: [], inputs: [] },
            playback: { currentFrame: 22, currentSeconds: 0.36, fps: 60, totalFrames: 60, totalSeconds: 1, type: 'animation' },
            revision: 1,
            sessionId,
            topologyRevision: 1,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId } });
        await loadPromise;
        expect(updates.at(-1)).toEqual(expect.objectContaining({ currentFrame: 22, playbackType: 'animation' }));

        // Upgrade after activation so the initial barrier remains the simple
        // legacy fixture while the transition itself is ACK-backed.
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId } });

        const pause = harness.controller.sendCommand('pause');
        await vi.waitFor(() => expect(harness.invoke.mock.calls.some(
            ([name, args]) => name === 'send_render_surface_message' && args.payload.type === 'pause',
        )).toBe(true));
        const pausePayload = harness.invoke.mock.calls.find(
            ([name, args]) => name === 'send_render_surface_message' && args.payload.type === 'pause',
        )[1].payload;
        harness.eventHandlers.get('render-surface:ack')({ payload: {
            applied: true,
            canonicalDelta: {
                controlChanges: [],
                playback: { name: 'MainSM', type: 'stateMachine' },
                revision: 2,
                stateType: 'delta',
                topologyRevision: 1,
            },
            commandId: pausePayload.commandId,
            revision: pausePayload.revision,
            sessionId,
            status: 'applied',
        } });
        await expect(pause).resolves.toEqual(expect.objectContaining({ applied: true, status: 'applied' }));
        expect(updates.at(-1)).toEqual({
            currentFrame: undefined,
            currentSeconds: undefined,
            fps: undefined,
            playbackType: 'stateMachine',
            totalFrames: undefined,
            totalSeconds: undefined,
        });
        document.removeEventListener('rav:timeline-progress', onProgress);
        harness.controller.dispose();
    });

    it('retains canonical authority and performs one guarded replacement after an active child fails', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Main',
            revision: 1,
            sessionId: firstSession,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;

        harness.invoke.mockClear();
        const fatalEvent = { payload: { message: 'GPU process lost', sessionId: firstSession } };
        harness.eventHandlers.get('render-surface:error')(fatalEvent);
        harness.eventHandlers.get('render-surface:error')(fatalEvent);
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Late Failed State',
            revision: 99,
            sessionId: firstSession,
        } });
        harness.eventHandlers.get('render-surface:metrics')({ payload: { fps: 1, sessionId: firstSession } });

        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            isLoaded: false,
            recoveryState: 'recovering',
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({ artboard: 'Main' }));
        expect(document.getElementById('fps-chip').textContent).toBe('-- FPS');
        expect(harness.canvas.style.visibility).toBe('hidden');
        await expect(harness.controller.requestCommand('pause')).resolves.toEqual(expect.objectContaining({
            applied: false,
            status: 'unavailable',
        }));
        await vi.waitFor(() => expect(harness.invoke.mock.calls.filter(
            ([name]) => name === 'create_render_surface',
        )).toHaveLength(1));
        const replacementSession = harness.invoke.mock.calls.find(
            ([name]) => name === 'create_render_surface',
        )[1].request.sessionId;
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Recovered',
            revision: 1,
            sessionId: replacementSession,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId: replacementSession,
        } });

        await vi.waitFor(() => expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: replacementSession,
            isLoaded: true,
            recoveryState: 'idle',
        })));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({ artboard: 'Recovered' }));
        expect(harness.canvas.style.visibility).toBe('hidden');
        harness.controller.dispose();
    });

    it('fails closed without revealing the parent or accepting commands when replacement fails', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Last Good Frame',
            revision: 1,
            sessionId: firstSession,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { firstFrame: true, sessionId: firstSession } });
        await firstLoad;

        harness.buildRenderSurfaceContext.mockRejectedValueOnce(new Error('replacement context failed'));
        harness.eventHandlers.get('render-surface:error')({ payload: {
            message: 'active child crashed',
            sessionId: firstSession,
        } });
        await vi.waitFor(() => expect(harness.controller.getState().recoveryState).toBe('failed'));

        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            isLoaded: false,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({ artboard: 'Last Good Frame' }));
        expect(harness.canvas.style.visibility).toBe('hidden');
        await expect(harness.controller.requestCommand('play')).resolves.toEqual(expect.objectContaining({
            applied: false,
            status: 'unavailable',
        }));
        harness.settingsPopover.hidden = false;
        await new Promise((resolve) => queueMicrotask(resolve));
        expect(harness.canvas.style.visibility).toBe('hidden');
        expect(harness.showError).toHaveBeenCalledWith(expect.stringContaining('Playback surface recovery failed'));
        harness.controller.dispose();
    });

    it('recovers a terminal failed surface only after a later deliberate load activates', async () => {
        const harness = createHarness({ autoAcknowledge: true });
        await harness.controller.setup();
        const firstLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const firstSession = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: {
            protocolVersion: 2,
            sessionId: firstSession,
        } });
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Last Good Frame',
            revision: 10,
            sessionId: firstSession,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId: firstSession,
        } });
        await firstLoad;

        harness.buildRenderSurfaceContext.mockRejectedValueOnce(new Error('automatic replacement failed'));
        harness.eventHandlers.get('render-surface:error')({ payload: {
            message: 'active child crashed',
            sessionId: firstSession,
        } });
        await vi.waitFor(() => expect(harness.controller.getState().recoveryState).toBe('failed'));

        const deliberateLoad = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke.mock.calls.filter(
            ([name]) => name === 'create_render_surface',
        )).toHaveLength(2));
        const replacementSession = harness.invoke.mock.calls.filter(
            ([name]) => name === 'create_render_surface',
        ).at(-1)[1].request.sessionId;

        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: firstSession,
            isLoaded: false,
            recoveryState: 'failed',
            sessionId: replacementSession,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'Last Good Frame',
            sessionId: firstSession,
        }));
        expect(harness.canvas.style.visibility).toBe('hidden');
        await expect(harness.controller.requestCommand('play')).resolves.toEqual(expect.objectContaining({
            applied: false,
            status: 'unavailable',
        }));

        harness.eventHandlers.get('render-surface:ready')({ payload: {
            protocolVersion: 2,
            sessionId: replacementSession,
        } });
        harness.eventHandlers.get('render-surface:state')({ payload: {
            artboard: 'Deliberate Recovery',
            revision: 1,
            sessionId: replacementSession,
        } });
        await harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId: replacementSession,
        } });
        await expect(deliberateLoad).resolves.toBe(true);

        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: replacementSession,
            isLoaded: true,
            recoveryState: 'idle',
            sessionId: replacementSession,
        }));
        expect(harness.controller.getCanonicalState()).toEqual(expect.objectContaining({
            artboard: 'Deliberate Recovery',
            sessionId: replacementSession,
        }));
        await expect(harness.controller.requestCommand('play')).resolves.toEqual(expect.objectContaining({
            applied: true,
            status: 'applied',
        }));
        harness.controller.dispose();
    });

    it('cancels a staged load on dispose and cannot activate from a queued late event', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        const queuedLoadedHandler = harness.eventHandlers.get('render-surface:loaded');

        harness.controller.dispose();
        await expect(loadPromise).resolves.toBe(false);
        await queuedLoadedHandler({ payload: { firstFrame: true, sessionId } });
        expect(harness.invoke).not.toHaveBeenCalledWith('activate_render_surface', { reveal: true, sessionId });
        expect(harness.invoke.mock.calls.filter(([name]) => name === 'close_render_surface')).toHaveLength(1);
    });

    it('does not recommit or recover a native activation that resolves after controller disposal', async () => {
        const nativeActivation = deferred();
        const harness = createHarness({
            autoAcknowledge: true,
            invokeCommand: (command) => command === 'activate_render_surface' ? nativeActivation.promise : null,
        });
        await harness.controller.setup();
        const loadPromise = harness.controller.loadCurrentAnimation();
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('create_render_surface', expect.any(Object)));
        const sessionId = harness.invoke.mock.calls.find(([name]) => name === 'create_render_surface')[1].request.sessionId;
        harness.eventHandlers.get('render-surface:ready')({ payload: { protocolVersion: 2, sessionId } });
        const activating = harness.eventHandlers.get('render-surface:loaded')({ payload: {
            firstFrame: true,
            sessionId,
        } });
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('activate_render_surface', {
            reveal: true,
            sessionId,
        }));

        harness.controller.dispose();
        await expect(loadPromise).resolves.toBe(false);
        nativeActivation.resolve(null);
        await activating;

        expect(harness.controller.getState()).toEqual(expect.objectContaining({
            activeSessionId: null,
            canAcceptCommands: false,
            isLoaded: false,
            recoveryState: 'idle',
        }));
        expect(harness.buildRenderSurfaceContext).toHaveBeenCalledTimes(1);
        expect(harness.invoke.mock.calls.filter(([name]) => name === 'close_render_surface')).toHaveLength(1);
    });
});
