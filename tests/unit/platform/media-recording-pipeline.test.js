import { readFileSync } from 'node:fs';
const source = readFileSync('src-tauri/src/demo-template/js/media/recording.js', 'utf8');
const loop = readFileSync('src-tauri/src/demo-template/js/media/pipeline/recording-loop.js', 'utf8');
const capture = readFileSync('src-tauri/src/demo-template/js/media/capture.js', 'utf8');

function fakePipeline(options, hooks) {
    const pipe = { options, hooks, captured: [], accepting: true, finishReceipt: null, disposed: 0,
        configure: vi.fn(async () => {}), warmUp: vi.fn(async () => {}),
        canAccept: () => pipe.accepting, whenReady: vi.fn(async () => {}),
        capture: vi.fn((canvas, index, cursor) => { pipe.captured.push({ index, cursor }); return true; }),
        finish: vi.fn(async (count) => { pipe.finishCount = count; return pipe.finishReceipt; }),
        dispose: vi.fn(() => { pipe.disposed += 1; }), progress: () => '0' };
    return pipe;
}

function harness(prepare) {
    let now = 0;
    const state = {}, pipelines = [], frames = [];
    const emit = vi.fn(async (type, payload) => { if (type === 'render-surface:media-frame') frames.push(payload); });
    const rafs = [];
    const api = new Function('window', 'document', 'isRenderSurfaceMode', 'els', 'performance',
        'handleResize', 'riveInstance', 'renderSurfaceAdvanceFrame', 'createMediaCapturePipeline',
        'requestAnimationFrame', 'cancelAnimationFrame', 'MessageChannel',
        `${capture}\n${loop}\n${source}\n
        getRenderSurfaceMediaState = () => arguments[12];
        prepareRenderSurfaceInteractionSchedule = arguments[13];
        return { start:startRenderSurfaceRecording, frame:recordRenderSurfaceMediaFrame,
            stop:stopRenderSurfaceRecording, pump:pumpRenderSurfaceRecording,
            progress:withRenderSurfaceStopProgress, command:handleRenderSurfaceMediaCommand };`
    )({ __ravRenderSurfaceTarget: { type: 'stateMachine' }, __ravRenderSurfaceEmit: emit }, { hidden: false, createElement: () => ({}) },
        false, { canvas: { id: 'canvas' } }, { now: () => now }, vi.fn(),
        { isPlaying: true, startRendering: vi.fn() }, vi.fn(),
        (options, hooks) => { const pipe = fakePipeline(options, hooks); pipelines.push(pipe); return pipe; },
        (fn) => { rafs.push(fn); return rafs.length; }, vi.fn(),
        class { constructor() { const self = this; this.port1 = { close() {} }; this.port2 = { postMessage() { queueMicrotask(() => self.port1.onmessage?.({})); } }; } },
        state, prepare);
    const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
    return { ...api, state, frames, pipelines, emit, rafs, settle, time(value) { now = value; },
        pipe: () => pipelines.at(-1) };
}

describe('recording pipeline lifecycle', () => {
    const options = { capture_id: 'one', width: 1920, height: 1080, fps: { numerator: 60, denominator: 1 } };
    it('configures and warms the pipeline before recording time starts, then captures presentation frames in order', async () => {
        const h = harness(); await h.start(options);
        const pipe = h.pipe();
        expect(pipe.configure).toHaveBeenCalledOnce();
        expect(pipe.warmUp).toHaveBeenCalledWith({ id: 'canvas' });
        expect(pipe.captured.map((entry) => entry.index)).toEqual([0]);
        h.time(17); h.frame(); h.time(34); h.frame(); h.time(51); h.frame();
        expect(pipe.captured.map((entry) => entry.index)).toEqual([0, 1, 2, 3]);
        pipe.accepting = false; h.time(68); h.frame();
        expect(pipe.captured).toHaveLength(4);
        pipe.accepting = true; h.time(85); h.frame();
        expect(pipe.captured.at(-1).index).toBe(5);
        expect(h.state.recording.dropped).toBe(1);
        expect(h.command('media-record-ack', { capture_id: 'one', frame_index: 0 })).toEqual({ acknowledged: true });
    });
    it('drains the pipeline on stop and returns the receipt without waiting for ACKs behind the stop command', async () => {
        const h = harness(); await h.start(options); h.time(100);
        const pipe = h.pipe(); pipe.finishReceipt = { encoded_frames: 6, repeated_frames: 0, max_encode_queue: 1 };
        let release; pipe.finish = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        let settled = false;
        const stopping = h.stop().then((receipt) => { settled = true; return receipt; });
        await h.settle(); expect(settled).toBe(false);
        release({ encoded_frames: 6, repeated_frames: 0, max_encode_queue: 1 });
        await expect(stopping).resolves.toMatchObject({ frame_count: 6, recording: false, video: { encoded_frames: 6 }, clock: { mode: 'presentation' } });
        expect(pipe.finish).toHaveBeenCalledWith(6);
        expect(pipe.disposed).toBe(1);
        expect(h.state.recording).toBeNull();
    });
    it('fails capture cleanly when the pipeline reports an error', async () => {
        const h = harness(); await h.start(options);
        h.pipe().hooks.onError(new Error('PNG failure')); await h.settle();
        expect(h.emit).toHaveBeenCalledWith('render-surface:media-ended', { capture_id: 'one' });
        await expect(h.stop()).rejects.toThrow('PNG failure');
        expect(h.state.recording).toBeNull();
        expect(h.pipe().disposed).toBe(1);
    });
    it('runs the loop for native-owned recordings and drains a manual stop through the loop', async () => {
        const h = harness(); await h.start({ ...options, native_job_id: 'native' });
        const recording = h.state.recording, pipe = h.pipe();
        expect(recording.loop).toBeTruthy();
        await h.settle();
        expect(pipe.captured.map((entry) => entry.index)).toEqual([0]);
        h.time(100);
        const stopping = h.stop();
        for (let step = 0; step < 30 && h.state.recording; step += 1) { h.time(100 + step); h.rafs.splice(0).forEach((fn) => fn()); await h.settle(); }
        await expect(stopping).resolves.toMatchObject({ frame_count: 6, recording: false, clock: { mode: 'fixed-step' } });
        expect(pipe.captured.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(pipe.finish).toHaveBeenCalledWith(6);
    });
    it('reports the offline clock from rendered frames rather than wall time', async () => {
        const h = harness(); await h.start({ ...options, native_job_id: 'native', clock: 'offline', duration_seconds: 0.1 });
        const pipe = h.pipe();
        for (let step = 0; step < 30 && !h.state.recording.stopped; step += 1) { h.rafs.splice(0).forEach((fn) => fn()); await h.settle(); }
        expect(pipe.captured).toHaveLength(6);
        expect(h.emit).toHaveBeenCalledWith('render-surface:media-ended', { capture_id: 'one' });
        h.time(5000);
        await expect(h.stop()).resolves.toMatchObject({ frame_count: 6, elapsed_seconds: 0.1, clock: { mode: 'offline', max_lag_ms: 0 } });
    });
    it('rejects offline recordings without a duration', async () => {
        const h = harness();
        await expect(h.start({ ...options, native_job_id: 'native', clock: 'offline' })).rejects.toThrow('duration_seconds');
        expect(h.state.recording ?? null).toBeNull();
    });
});

it('abort is immediate even during preparation and never cancels a different capture', async () => {
    const h = harness(); await h.start({ capture_id: 'one', width: 64, height: 64, fps: { numerator: 60, denominator: 1 } });
    h.state.recording.ready = false;
    expect(h.command('media-record-abort', { capture_id: 'other' })).toMatchObject({ aborted: false });
    expect(h.state.recording).not.toBeNull();
    expect(h.command('media-record-abort', { capture_id: 'one' })).toMatchObject({ aborted: true });
    expect(h.state.recording).toBeNull();
    expect(h.pipe().disposed).toBe(1);
    h.pipe().hooks.onError(new Error('closed worker')); await h.settle();
    expect(h.emit.mock.calls.some(([type]) => type === 'render-surface:media-ended')).toBe(false);
});

it('a second start rejection does not abort the existing recording', async () => {
    const h = harness(), options = { capture_id: 'one', width: 64, height: 64, fps: { numerator: 60, denominator: 1 } };
    await h.start(options); await expect(h.start({ ...options, capture_id: 'two' })).rejects.toThrow('already active');
    expect(h.state.recording.id).toBe('one'); h.command('media-record-abort', { capture_id: 'one' });
});

it('cancel interrupts pending image preparation and a late result cannot start the cancelled capture', async () => {
    let release;
    const prepare = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const h = harness(prepare), options = { capture_id: 'images', width: 64, height: 64, fps: { numerator: 60, denominator: 1 }, interactions: [{}] };
    const pending = h.start(options), rejected = expect(pending).rejects.toThrow('cancelled');
    expect(h.state.preparing.id).toBe('images');
    h.command('media-record-abort', { capture_id: 'other' });
    expect(h.state.preparing.id).toBe('images');
    h.command('media-record-abort', { capture_id: 'images' });
    await rejected;
    expect(h.state.preparing).toBeNull();
    expect(h.pipelines).toHaveLength(0);
    await h.start({ ...options, capture_id: 'next', interactions: [] });
    release({ dispose: vi.fn() }); await h.settle();
    expect(h.state.recording.id).toBe('next');
    h.command('media-record-abort', { capture_id: 'next' });
});
