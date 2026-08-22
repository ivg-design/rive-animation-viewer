import {
    createRenderSurfaceController,
    measureRenderSurfaceBounds,
} from '../../../src/app/platform/render-surface/controller.js';
import {
    dispatchPlaybackCommand,
    dispatchVmControlMutation,
} from '../../../src/app/rive/control-events.js';

class FakeResizeObserver {
    constructor(callback) {
        this.callback = callback;
    }

    observe() {}

    disconnect() {}
}

function createHarness() {
    document.body.innerHTML = `
        <div id="fps-chip"><span class="dot"></span>-- FPS</div>
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
        elements: { canvasContainer },
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

    it('swaps to the loaded child and relays only coarse control/playback commands', async () => {
        const harness = createHarness();
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

        harness.eventHandlers.get('render-surface:metrics')({ payload: { fps: 59.6, sessionId } });
        expect(document.getElementById('fps-chip').textContent).toBe('60 FPS');

        dispatchVmControlMutation(document, {
            descriptor: { kind: 'number', name: 'speed', path: 'speed', source: 'view-model' },
            kind: 'number',
            value: 42,
        });
        dispatchPlaybackCommand(document, 'pause');
        await vi.waitFor(() => {
            const relays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
            expect(relays).toHaveLength(2);
        });
        const relays = harness.invoke.mock.calls.filter(([command]) => command === 'send_render_surface_message');
        expect(relays[0][1].payload).toEqual({
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
        expect(relays[1][1].payload.type).toBe('pause');

        harness.controller.dispose();
        expect(harness.canvas.style.visibility).toBe('');
        expect(document.getElementById('fps-chip').textContent).toBe('-- FPS');
    });
});
