import { readFileSync } from 'node:fs';
const source = readFileSync('src-tauri/src/demo-template/js/media/recording.js', 'utf8');
const capture = readFileSync('src-tauri/src/demo-template/js/media/capture.js', 'utf8');
const encoder = readFileSync('src-tauri/src/demo-template/js/media/png-encoder.js', 'utf8');

function harness(prepare) {
    let now = 0;
    const state = {}, frames = [], encodes = [];
    const emit = vi.fn(async (type, payload) => { if (type === 'render-surface:media-frame') frames.push(payload); });
    const encode = vi.fn((_canvas, _options, _cursor, output) => new Promise((resolve, reject) => encodes.push({ resolve, reject, output })));
    const api = new Function('window', 'document', 'isRenderSurfaceMode', 'els', 'performance',
        'handleResize', 'riveInstance', 'renderSurfaceAdvanceFrame', `${encoder}\n${capture}\n${source}\n
        mediaCanvasPngAsync = arguments[8];
        getRenderSurfaceMediaState = () => arguments[9];
        prepareRenderSurfaceInteractionSchedule = arguments[10];
        return { start:startRenderSurfaceRecording, frame:recordRenderSurfaceMediaFrame,
            stop:stopRenderSurfaceRecording, command:handleRenderSurfaceMediaCommand };`
    )({ __ravRenderSurfaceTarget: { type: 'stateMachine' }, __ravRenderSurfaceEmit: emit }, document,
        false, { canvas: document.createElement('canvas') }, { now: () => now }, vi.fn(),
        { isPlaying: true, startRendering: vi.fn() }, vi.fn(), encode, state, prepare);
    return { ...api, state, frames, encodes, emit, time(value) { now = value; } };
}

describe('bounded live recording pipeline', () => {
    const options = { capture_id: 'one', width: 1920, height: 1080, fps: { numerator: 60, denominator: 1 } };
    it('overlaps three encodes, delivers out-of-order completions in frame order, and reuses only acknowledged slots', async () => {
        const h = harness(); await h.start(options);
        h.time(17); h.frame(); h.time(34); h.frame(); h.time(51); h.frame();
        expect(h.encodes).toHaveLength(3);
        h.encodes[2].resolve('third'); h.encodes[1].resolve('second');
        await vi.advanceTimersByTimeAsync(0);
        expect(h.frames).toHaveLength(0);
        h.encodes[0].resolve('first'); await vi.advanceTimersByTimeAsync(0);
        expect(h.frames.map((f) => f.frame_index)).toEqual([0, 1, 2]);
        h.command('media-record-ack', { capture_id: 'wrong', frame_index: 0 }); h.frame();
        expect(h.encodes).toHaveLength(3);
        h.command('media-record-ack', { capture_id: 'one', frame_index: 1 }); h.frame();
        expect(h.encodes).toHaveLength(4);
        expect(h.encodes[3].output).toBe(h.encodes[1].output);
        h.encodes[3].resolve('fourth'); await vi.advanceTimersByTimeAsync(0);
        expect(h.frames.at(-1).frame_index).toBe(3);
    });
    it('drains encoded frames before stop resolves, without waiting for ACKs behind the stop command', async () => {
        const h = harness(); await h.start(options); h.time(100);
        let settled = false;
        const stopping = h.stop().then((receipt) => { settled = true; return receipt; });
        h.frame(); expect(h.encodes).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
        h.encodes[0].resolve('frame');
        await expect(stopping).resolves.toMatchObject({ frame_count: 6, recording: false });
        expect(h.frames).toHaveLength(1); expect(h.state.recording).toBeNull();
    });
    it('fails capture cleanly if asynchronous PNG compression fails', async () => {
        const h = harness(); await h.start(options);
        h.encodes[0].reject(new Error('PNG failure')); await vi.advanceTimersByTimeAsync(0);
        expect(h.emit).toHaveBeenCalledWith('render-surface:media-ended', { capture_id: 'one' });
        await expect(h.stop()).rejects.toThrow('PNG failure');
        expect(h.state.recording).toBeNull();
    });
});

it('abort is immediate even during preparation and never cancels a different capture', async () => {
    const h=harness();await h.start({capture_id:'one',width:64,height:64,fps:{numerator:60,denominator:1}});
    h.state.recording.ready=false;
    expect(h.command('media-record-abort',{capture_id:'other'})).toMatchObject({aborted:false});
    expect(h.state.recording).not.toBeNull();
    expect(h.command('media-record-abort',{capture_id:'one'})).toMatchObject({aborted:true});
    expect(h.state.recording).toBeNull();
    h.encodes[0].reject(new Error('closed worker'));await vi.advanceTimersByTimeAsync(0);
    expect(h.emit.mock.calls.some(([type])=>type==='render-surface:media-ended')).toBe(false);
});

it('a second start rejection does not abort the existing recording', async () => {
    const h=harness(),options={capture_id:'one',width:64,height:64,fps:{numerator:60,denominator:1}};
    await h.start(options);await expect(h.start({...options,capture_id:'two'})).rejects.toThrow('already active');
    expect(h.state.recording.id).toBe('one');h.command('media-record-abort',{capture_id:'one'});
});

it('cancel interrupts pending image preparation and a late result cannot start the cancelled capture', async () => {
    let release;
    const prepare = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const h = harness(prepare), options = {capture_id:'images',width:64,height:64,fps:{numerator:60,denominator:1},interactions:[{}]};
    const pending = h.start(options), rejected = expect(pending).rejects.toThrow('cancelled');
    expect(h.state.preparing.id).toBe('images');
    h.command('media-record-abort', {capture_id:'other'});
    expect(h.state.preparing.id).toBe('images');
    h.command('media-record-abort', {capture_id:'images'});
    await rejected;
    expect(h.state.preparing).toBeNull();
    expect(h.encodes).toHaveLength(0);
    await h.start({...options,capture_id:'next',interactions:[]});
    release({dispose:vi.fn()});await vi.advanceTimersByTimeAsync(0);
    expect(h.state.recording.id).toBe('next');
    h.command('media-record-abort', {capture_id:'next'});
});
