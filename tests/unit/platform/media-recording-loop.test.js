import { readFileSync } from 'node:fs';
const source = readFileSync('src-tauri/src/demo-template/js/media/pipeline/recording-loop.js', 'utf8');

function harness({ clock = 'live', duration = 1, accepting = true, hidden = false } = {}) {
    let now = 0, accept = accepting;
    const frames = [], advances = [], scheduled = [], rafs = [], timers = [];
    const pipeline = {
        canAccept: () => accept,
        whenReady: vi.fn(() => new Promise((resolve) => { timers.push({ at: now + 8, fn: resolve }); })),
    };
    const recording = { id: 'one', ownsClock: true, ready: true, start: 0, lastIndex: -1, stopped: false,
        options: { fps: { numerator: 60, denominator: 1 }, duration_seconds: duration, clock },
        pipeline, schedule: { run: (time, index) => scheduled.push([time, index]), afterFrame: () => {} } };
    const state = { recording }, emit = vi.fn(), document = { hidden };
    const setTimeout = vi.fn((fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; });
    const clearTimeout = vi.fn((id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; });
    const requestAnimationFrame = vi.fn((fn) => { rafs.push(fn); return rafs.length; });
    class MessageChannel { constructor() { const self = this; this.port1 = { close() {} }; this.port2 = { postMessage() { queueMicrotask(() => self.port1.onmessage?.({})); } }; } }
    const api = new Function('getRenderSurfaceMediaState', 'performance', 'riveInstance', 'renderSurfaceAdvanceFrame',
        'recordRenderSurfaceMediaFrame', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame',
        'MessageChannel', 'document', 'window',
        `${source}; return { createRenderSurfaceRecordingLoop, pumpRenderSurfaceRecording, settleRenderSurfaceRecordingDrain };`)(
        () => state, { now: () => now }, { isPlaying: true }, (_player, dt) => advances.push(dt),
        (index) => { frames.push(index); recording.lastIndex = index; }, setTimeout, clearTimeout,
        requestAnimationFrame, vi.fn(), MessageChannel, document, { __ravRenderSurfaceEmit: emit });
    const loop = api.createRenderSurfaceRecordingLoop(recording);
    recording.loop = loop;
    async function settle() { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }
    async function fireRaf() { const pending = rafs.splice(0); pending.forEach((fn) => fn(now)); await settle(); }
    async function advanceTo(time) {
        now = time;
        for (;;) {
            const due = timers.filter((timer) => !timer.cancelled && !timer.fired && timer.at <= now).sort((a, b) => a.at - b.at);
            if (!due.length) break;
            due.forEach((timer) => { timer.fired = true; timer.fn(); });
            await settle();
        }
        await settle();
    }
    return { api, loop, recording, state, frames, advances, scheduled, emit, rafs, settle, fireRaf, advanceTo,
        time: (value) => { now = value; }, accept: (value) => { accept = value; }, timers };
}

describe('self-scheduled recording loop', () => {
    it('renders due frames in live mode, yields to the compositor between batches, and completes at the duration', async () => {
        const h = harness();
        h.loop.run(); await h.settle();
        expect(h.frames).toEqual([0]);
        expect(h.advances[0]).toBe(0);
        expect(h.rafs).toHaveLength(1);
        await h.fireRaf();
        expect(h.frames).toEqual([0]);
        await h.advanceTo(100);
        await h.fireRaf();
        expect(h.frames.at(-1)).toBeGreaterThanOrEqual(5);
        expect(h.advances.slice(1).every((dt) => dt === 1 / 60)).toBe(true);
        expect(h.scheduled).toEqual(h.frames.map((index) => [index / 60, index]));
        for (let step = 0; step < 200 && !h.recording.stopped; step += 1) { await h.advanceTo(1000 + step); await h.fireRaf(); }
        expect(h.frames).toEqual(Array.from({ length: 60 }, (_, i) => i));
        expect(h.recording.stopped).toBe(true);
        expect(h.emit).toHaveBeenCalledWith('render-surface:media-ended', { capture_id: 'one' });
        expect(h.emit).toHaveBeenCalledOnce();
    });
    it('renders every frame immediately in offline mode without consulting wall time', async () => {
        const h = harness({ clock: 'offline', duration: 0.5 });
        h.loop.run(); await h.settle();
        expect(h.frames.length).toBeGreaterThan(0);
        for (let step = 0; step < 100 && !h.recording.stopped; step += 1) await h.fireRaf();
        expect(h.frames).toEqual(Array.from({ length: 30 }, (_, i) => i));
        expect(h.recording.maxLagMs).toBeUndefined();
        expect(h.recording.stopped).toBe(true);
    });
    it('waits for capture capacity without advancing simulation or skipping a frame', async () => {
        const h = harness({ accepting: false });
        h.loop.run(); await h.settle();
        expect(h.frames).toEqual([]);
        expect(h.recording.pipeline.whenReady).toHaveBeenCalled();
        h.accept(true);
        await h.advanceTo(8);
        expect(h.frames).toEqual([0]);
    });
    it('sleeps until the next frame boundary and a kick ends the sleep early', async () => {
        const h = harness();
        h.loop.run(); await h.settle(); await h.fireRaf();
        expect(h.frames).toEqual([0]);
        h.time(17);
        expect(h.api.pumpRenderSurfaceRecording()).toBe(true);
        await h.settle();
        expect(h.frames).toEqual([0, 1]);
    });
    it('seals manual stop, arms the drain on progress, and resolves it after the final interval', async () => {
        const h = harness({ duration: null });
        h.loop.run(); await h.settle(); await h.fireRaf();
        await h.advanceTo(50); await h.fireRaf();
        let resolved = false;
        h.recording.stopAt = 0.108; h.recording.stopped = false;
        h.recording.stopDrain = { arm: vi.fn(), resolve: () => { resolved = true; }, reject: vi.fn() };
        h.recording.stopProgress = vi.fn();
        h.api.pumpRenderSurfaceRecording();
        for (let step = 0; step < 20 && !resolved; step += 1) { await h.advanceTo(108 + step); await h.fireRaf(); }
        expect(h.frames).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(resolved).toBe(true);
        expect(h.recording.stopDrain.arm).toHaveBeenCalled();
        expect(h.emit).not.toHaveBeenCalled();
    });
    it('reports render failures once and ends the capture', async () => {
        const h = harness();
        h.recording.schedule.run = () => { throw new Error('schedule failed'); };
        h.loop.run(); await h.settle();
        expect(h.recording.error.message).toBe('schedule failed');
        expect(h.recording.stopped).toBe(true);
        expect(h.emit).toHaveBeenCalledWith('render-surface:media-ended', { capture_id: 'one' });
    });
    it('uses a macrotask yield instead of RAF while the document is hidden', async () => {
        const h = harness({ hidden: true, clock: 'offline', duration: 0.1 });
        h.loop.run();
        for (let step = 0; step < 20 && !h.recording.stopped; step += 1) await h.settle();
        expect(h.rafs).toHaveLength(0);
        expect(h.frames).toHaveLength(6);
    });
    it('does not claim an old presentation clock or an absent capture', () => {
        const h = harness();
        h.recording.ownsClock = false;
        expect(h.api.pumpRenderSurfaceRecording()).toBe(false);
        h.state.recording = null;
        expect(h.api.pumpRenderSurfaceRecording()).toBe(false);
    });
});
