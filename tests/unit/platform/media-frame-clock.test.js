import { readFileSync } from 'node:fs';
const source = readFileSync('src-tauri/src/demo-template/js/media/frame-clock.js', 'utf8');
const build = () => new Function(`${source}; return {renderSurfaceAdvanceFrame, stepRenderSurfaceFrames};`)();
describe('explicit Rive frame clock', () => {
    it('uses exactly the supplied delta and flushes before acknowledging, without a RAF dependency', () => {
        const order = [], deltas = [];
        const player = { loaded: true, artboard: {}, frameCount: 0, drawOptimization: 'drawOnChanged',
            stopRendering() { order.push('stop'); }, runtime: { resolveAnimationFrame() { order.push('flush'); } },
            draw(time) { order.push('draw'); deltas.push((time - this.lastRenderTime) / 1000); this.frameCount++; } };
        const { renderSurfaceAdvanceFrame } = build();
        for (let i = 0; i < 30; i++) renderSurfaceAdvanceFrame(player, 1 / 60);
        expect(deltas.reduce((a, b) => a + b, 0)).toBeCloseTo(.5, 10);
        expect(order.slice(0, 4)).toEqual(['stop', 'draw', 'flush', 'stop']);
        expect(player.frameCount).toBe(30);
        expect(player.drawOptimization).toBe('drawOnChanged');
        expect(renderSurfaceAdvanceFrame(player, 0).advancedSeconds).toBe(0);
    });
    it('cleans pending RAF work and restores rendering settings when a frame fails', () => {
        const stop = vi.fn();
        const player = { loaded: true, artboard: {}, drawOptimization: 'drawOnChanged', stopRendering: stop,
            draw() { throw new Error('GPU lost'); } };
        expect(() => build().renderSurfaceAdvanceFrame(player, .1)).toThrow('GPU lost');
        expect(stop).toHaveBeenCalledTimes(2);
        expect(player.drawOptimization).toBe('drawOnChanged');
    });
    it('fails closed for unavailable runtime methods or invalid step sizes', () => {
        expect(() => build().renderSurfaceAdvanceFrame({}, 0)).toThrow('cannot render');
        const player = { loaded: true, artboard: {}, draw() {}, stopRendering() {} };
        expect(() => build().renderSurfaceAdvanceFrame(player, -1)).toThrow('duration');
    });
    it('does not report a rendered frame when the runtime would skip a zero-size canvas', () => {
        const draw = vi.fn();
        const player = { loaded: true, artboard: {}, _hasZeroSize: true, draw, stopRendering() {} };
        expect(() => build().renderSurfaceAdvanceFrame(player, .1)).toThrow('zero-size canvas');
        expect(draw).not.toHaveBeenCalled();
    });
    it('never sends a frozen document timeline backwards after native advancement', () => {
        const times = [], window = {};
        const player = { lastRenderTime: 2000, _boundDraw(time) { times.push(time); }, runtime: {} };
        new Function('window', 'isRenderSurfaceMode', 'riveInstance', 'recordRenderSurfaceMediaFrame',
            `${source}; setupRenderSurfaceFrameClock(riveInstance);`)(window, true, player, () => {});
        player._boundDraw(1000);
        player._boundDraw(2010);
        expect(times).toEqual([2000, 2010]);
    });
});

it('rejects explicit frame stepping while recording owns advancement', () => {
    const draw=vi.fn();const api=new Function('getRenderSurfaceMediaState','riveInstance',`${source};return {stepRenderSurfaceFrames};`)(()=>({recording:{}}),{draw});
    expect(()=>api.stepRenderSurfaceFrames({frames:1})).toThrow('Stop recording');
    expect(draw).not.toHaveBeenCalled();
});
