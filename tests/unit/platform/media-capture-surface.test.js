import { readFileSync } from 'node:fs';

const source = readFileSync('src-tauri/src/demo-template/js/media/capture.js', 'utf8');

function harness({ loadError = false } = {}) {
    const state = { __ravRenderSurfaceTarget: { type: 'animation', name: 'In' } };
    const players = [];
    class Player {
        constructor(options) {
            this.canvas = options.canvas;
            this.resizeToCanvas = vi.fn(); this.stopRendering = vi.fn(); this.cleanup = vi.fn();
            this.play = vi.fn(); players.push(this);
            // Model the runtime observer on a later task, not synchronously in
            // onLoad: detached canvases have no layout even with backing pixels.
            setTimeout(() => {
                this._hasZeroSize = !this.canvas.isConnected
                    || !parseInt(this.canvas.style.width) || !parseInt(this.canvas.style.height);
                if (loadError) options.onLoadError({ message: 'Invalid file' });
                else options.onLoad();
            }, 0);
        }
    }
    const advance = vi.fn((player) => {
        if (player._hasZeroSize) throw new Error('Drawing suppressed');
    });
    const api = new Function('window', 'document', 'CONFIG', 'loadedRiveRuntime',
        'currentLayoutFit', 'currentLayoutAlignment', 'resolveRiveLayoutFit', 'resolveRiveLayoutAlignment',
        'renderSurfaceImageSnapshot', 'renderSurfaceAdvanceFrame', `${source};
        mediaCanvasPng = () => 'rendered';
        return {open:openRenderSurfaceMediaPlayer, frame:captureRenderSurfaceMediaFrame, close:closeRenderSurfaceMediaPlayer};`
    )(state, document, { animationBase64: 'AQ==', artboardName: 'A' },
        { Rive: Player, Layout: class {} }, 'contain', 'center', (_, value) => value, (_, value) => value,
        new Map(), advance);
    return { ...api, players, advance };
}

describe('isolated capture surface', () => {
    afterEach(() => { document.body.innerHTML = ''; });
    const options = { mode: 'timeline', width: 640, height: 360, simulation_fps: 60, snapshot: [] };

    it('enables centered presentation only while live capture overrides the output aspect ratio', () => {
        const container = document.createElement('div'), canvas = document.createElement('canvas');
        Object.defineProperties(container, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
        const state = { recording: { options: { width: 1920, height: 1080 } } };
        const size = new Function('window', 'els', 'riveInstance', `${source}; return applyRenderSurfaceMediaSizing;`)(
            { __ravMediaState: state }, { canvas, canvasContainer: container }, null);
        expect(size()).toBe(true);
        expect(container.classList.contains('canvas-container-media-capture')).toBe(true);
        expect(canvas.style.height).toBe('562.5px');
        state.recording = null;
        expect(size()).toBe(false);
        expect(container.classList.contains('canvas-container-media-capture')).toBe(false);
    });

    it('keeps a low-resolution export crisp in a larger Retina preview', () => {
        const container = document.createElement('div'), canvas = document.createElement('canvas');
        Object.defineProperties(container, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
        const state = { recording: { options: { width: 320, height: 180 } } };
        const player = { devicePixelRatioUsed: 0, resizeToCanvas: vi.fn(), layout: { fit: 'contain' } };
        const size = new Function('window', 'els', 'riveInstance', `${source}; return applyRenderSurfaceMediaSizing;`)(
            { __ravMediaState: state, devicePixelRatio: 2 }, { canvas, canvasContainer: container }, player);

        expect(size()).toBe(true);
        expect(canvas.style.width).toBe('1000px');
        expect(canvas.style.height).toBe('562.5px');
        expect(canvas.width).toBe(2000);
        expect(canvas.height).toBe(1125);
        expect(player.devicePixelRatioUsed).toBe(6.25);
        expect(player.resizeToCanvas).toHaveBeenCalledOnce();
    });

    it('keeps a sized hidden canvas alive across asynchronous frame requests and removes it on close', async () => {
        const api = harness();
        const opening = api.open(options);
        await vi.advanceTimersByTimeAsync(1);
        await opening;
        const player = api.players[0];
        expect(player.canvas.width).toBe(640);
        expect(player.canvas.style.visibility).toBe('hidden');
        expect(player.canvas.getAttribute('aria-hidden')).toBe('true');
        await vi.advanceTimersByTimeAsync(1);
        await expect(api.frame({ frame_index: 1, seconds: 1 / 60 })).resolves.toMatchObject({ png_base64: 'rendered' });
        expect(player._hasZeroSize).toBe(false);
        api.close();
        expect(player.canvas.isConnected).toBe(false);
        expect(player.cleanup).toHaveBeenCalledOnce();
    });

    it('removes the offscreen canvas after loading fails so the next job starts cleanly', async () => {
        const api = harness({ loadError: true });
        let failed = expect(api.open(options)).rejects.toThrow('Invalid file');
        await vi.advanceTimersByTimeAsync(1);
        await failed;
        expect(api.players[0].canvas.isConnected).toBe(false);
        expect(api.players[0].cleanup).toHaveBeenCalledOnce();
        failed = expect(api.open(options)).rejects.toThrow('Invalid file');
        await vi.advanceTimersByTimeAsync(1);
        await failed;
        expect(document.querySelectorAll('canvas')).toHaveLength(0);
    });
});
