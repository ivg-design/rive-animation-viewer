import {
    createRenderSurfaceController,
    measureRenderSurfaceBounds,
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

function createHarness({ controlSnapshot = [], presentationState = {} } = {}) {
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
    const invoke = vi.fn(async () => null);
    const buildRenderSurfaceContext = vi.fn(async () => ({
        currentFileName: 'trackmap_v2.riv',
        payload: { file_name: 'trackmap_v2.riv' },
    }));
    const controller = createRenderSurfaceController({
        callbacks: {
            getControlSnapshot: () => controlSnapshot,
            getPresentationState: () => presentationState,
            getTauriEventListener: async () => async (eventName, handler) => {
                eventHandlers.set(eventName, handler);
                return () => eventHandlers.delete(eventName);
            },
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
            logEvent: vi.fn(),
            showError: vi.fn(),
            updateInfo: vi.fn(),
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
        settingsPopover: document.getElementById('settings-popover'),
    };
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
        await harness.controller.loadCurrentAnimation();

        const createCall = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface');
        expect(createCall?.[1]?.request).toEqual(expect.objectContaining({
            height: 360,
            payload: { file_name: 'trackmap_v2.riv' },
            width: 640,
            x: 100,
            y: 80,
        }));
        const sessionId = createCall[1].request.sessionId;
        expect(harness.canvas.style.visibility).toBe('');

        await harness.eventHandlers.get('render-surface:loaded')({ payload: { sessionId } });
        expect(harness.invoke).toHaveBeenCalledWith('show_render_surface', {});
        expect(harness.canvas.style.visibility).toBe('hidden');
        expect(harness.canvas.style.pointerEvents).toBe('none');
        expect(document.getElementById('fps-chip').textContent).toBe('ISOLATED');
        expect(document.querySelector('#fps-chip .fps-chip-pending-label')).not.toBeNull();
        const initialRelays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
        expect(initialRelays.map(([, args]) => args.payload.type)).toEqual(['presentation']);

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
            expect(relays).toHaveLength(4);
        });
        const relays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
        expect(relays[1][1].payload).toEqual({
            payload: {
                kind: 'number',
                name: 'speed',
                path: 'speed',
                source: 'view-model',
                value: 42,
            },
            sessionId,
            type: 'vm-set',
        });
        expect(relays[2][1].payload.type).toBe('pause');
        expect(relays[3][1].payload).toEqual(expect.objectContaining({
            payload: expect.objectContaining({
                params: expect.objectContaining({ artboard: 'Main', autoplay: true }),
                snapshot: expect.any(Array),
            }),
            type: 'reset',
        }));

        harness.controller.dispose();
        expect(harness.canvas.style.visibility).toBe('');
        expect(document.getElementById('fps-chip').textContent).toBe('-- FPS');
    });

    it('hides the native child for Settings and restores it after the popover closes', async () => {
        const harness = createHarness();
        await harness.controller.setup();
        await harness.controller.loadCurrentAnimation();
        const createCall = harness.invoke.mock.calls.find(([command]) => command === 'create_render_surface');
        await harness.eventHandlers.get('render-surface:loaded')({ payload: { sessionId: createCall[1].request.sessionId } });
        harness.invoke.mockClear();

        harness.settingsPopover.hidden = false;
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('hide_render_surface', {}));
        expect(harness.canvas.style.visibility).toBe('');

        harness.settingsPopover.hidden = true;
        await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith('show_render_surface', {}));
        expect(harness.canvas.style.visibility).toBe('hidden');
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
        await harness.controller.loadCurrentAnimation();
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
        const loadedRelays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
        expect(loadedRelays.map(([, args]) => args.payload.type)).toEqual([
            'snapshot',
            'presentation',
            'vm-set',
            'pause',
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
});
