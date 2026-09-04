import { createMediaExportController } from '../../../src/app/platform/media/controller.js';

function setup({ frameGate, stopGate, abortGate, failFrame, nativeResolved, rejectedCommand, recording = false } = {}) {
    let session = 'one';
    const commands = [], requests = [], listeners = {};
    const info = { width: 64, height: 64, playback: { type: recording ? 'stateMachine' : 'animation', fps: 30, durationSeconds: .1 } };
    let nativeState = 'capturing';
    const native = async (command, { request } = {}) => {
        requests.push({ command, request });
        if (command === 'media_export_capabilities') return { formats: [{ id: 'webm', available: true }], limits: { max_frames: 6000 } };
        if (command === 'media_export_choose_path') return '/tmp/chosen.webm';
        if (command === 'media_export_frame' && failFrame) throw new Error('Disk full');
        if (command === 'media_export_finish') nativeState = 'completed';
        if (command === 'media_export_cancel') nativeState = 'cancelled';
        if (command === 'media_export_abort') { nativeState = 'failed'; return { job_id: 'native', state: nativeState, warnings: ['Accepted capture retained'], resolved_settings: { recovery_spool: '/tmp/recovery', accepted_frame_count: 2 } }; }
        return { job_id: 'native', state: nativeState, warnings: [], actual_bytes: 100, resolved_settings: nativeResolved };
    };
    const controller = createMediaExportController({
        getTauriInvoker: () => native,
        getTauriEventListener: async () => async (name, fn) => { listeners[name] = fn; },
        windowRef: { dispatchEvent() {} },
        renderSurfaceController: {
            getState: () => ({ activeSessionId: session }),
            async requestActiveCommand(type, payload) {
                commands.push({ type, payload });
                if (type === rejectedCommand) return { applied: false, message: 'Capture preparation failed: test cause' };
                if (type === 'media-record-abort') await abortGate;
                if (type === 'media-record-stop') { await stopGate; return { applied:true, result:{frame_count:3} }; }
                if (type === 'media-info') return { applied: true, result: info };
                if (type === 'media-frame') { await frameGate; return { applied: true, result: { ...payload, png_base64: 'frame-data' } }; }
                return { applied: true, result: {} };
            },
        },
    });
    return { controller, commands, requests, setSession: (value) => { session = value; } };
}
describe('desktop media job orchestration', () => {
    it('routes native destination selection without starting a capture', async () => {
        const h = setup();
        await expect(h.controller.chooseOutputPath({ format: 'webm', suggested_name: 'track-map' }))
            .resolves.toBe('/tmp/chosen.webm');
        expect(h.requests).toEqual([{ command: 'media_export_choose_path', request: {
            format: 'webm', suggested_name: 'track-map',
        } }]);
        expect(h.commands).toEqual([]);
    });
    it('sends a strict native request and exactly three ordered frames without leaking image data in receipts', async () => {
        const h = setup();
        const result = await h.controller.exportMedia({ format: 'webm', fps: 30, output_path: '/tmp/export.webm' });
        await vi.waitFor(async () => expect((await h.controller.status(result.job_id)).state).toBe('completed'));
        const frames = h.requests.filter((r) => r.command === 'media_export_frame');
        expect(frames.map((r) => r.request.frame_index)).toEqual([0, 1, 2]);
        expect(Object.keys(frames[0].request).sort()).toEqual(['frame_index', 'job_id', 'png_base64']);
        expect(h.requests.find((r) => r.command === 'media_export_begin').request).not.toHaveProperty('frame_count');
        expect(JSON.stringify(await h.controller.status(result.job_id))).not.toContain('frame-data');
        expect(h.commands.at(-1).type).toBe('media-close');
    });
    it('retains accepted capture on failure and exposes its recovery receipt', async () => {
        const h = setup({ failFrame: true });
        const result = await h.controller.exportMedia({ format: 'webm' });
        await vi.waitFor(async () => expect((await h.controller.status(result.job_id)).state).toBe('failed'));
        expect((await h.controller.status(result.job_id)).error).toBe('Disk full');
        expect(h.requests.some((r) => r.command === 'media_export_cancel')).toBe(false);
        expect(h.requests.some((r) => r.command === 'media_export_abort')).toBe(true);
        expect((await h.controller.status(result.job_id)).resolved_settings).toMatchObject({recovery_spool:'/tmp/recovery',accepted_frame_count:2});
    });
    it('retains the source segment and timeline rate when native verification supplies output settings', async () => {
        const h = setup({ nativeResolved: { width: 64, codec: 'vp9', verification: { decoded_frames: 2 } } });
        const result = await h.controller.exportMedia({ format: 'webm', fps: 30, start_frame: 1, end_frame: 3 });
        await vi.waitFor(async () => expect((await h.controller.status(result.job_id)).state).toBe('completed'));
        expect((await h.controller.status(result.job_id)).resolved_settings).toMatchObject({
            mode: 'timeline', start_seconds: 1 / 30, end_seconds: .1, source_timeline_fps: 30,
            frame_count: 2, codec: 'vp9', verification: { decoded_frames: 2 },
        });
    });
    it('rejects a source replacement during an in-flight frame instead of saving it against the new source', async () => {
        let release;
        const h = setup({ frameGate: new Promise((resolve) => { release = resolve; }) });
        const result = await h.controller.exportMedia({ format: 'webm' });
        await vi.waitFor(() => expect(h.commands.some((c) => c.type === 'media-frame')).toBe(true));
        h.setSession('two'); release();
        await vi.waitFor(async () => expect((await h.controller.status(result.job_id)).state).toBe('failed'));
        expect(h.requests.filter((r) => r.command === 'media_export_frame')).toHaveLength(0);
        expect(h.commands.filter((c) => c.type === 'media-close')).toHaveLength(0);
    });
});

it('explicit cancellation aborts capture without requesting graceful encoder drain', async () => {
    const h=setup({recording:true});const job=await h.controller.startRecording({format:'webm'});
    await h.controller.cancel(job.job_id);
    expect(h.commands).toContainEqual({type:'media-record-abort',payload:{capture_id:job.job_id}});
    expect(h.commands.some(c=>c.type==='media-record-stop')).toBe(false);
    expect(h.requests.some(r=>r.command==='media_export_cancel')).toBe(true);
    expect(h.requests.some(r=>r.command==='media_export_abort')).toBe(false);
});

it('preserves renderer failure details through the host boundary and clears the failed capture', async () => {
    const h = setup({ recording: true, rejectedCommand: 'media-record-start' });
    await expect(h.controller.startRecording({ format: 'webm' })).rejects.toThrow('Capture preparation failed: test cause');
    expect((await h.controller.status()).state).toBe('failed');
    await expect(h.controller.startRecording({ format: 'webm' })).rejects.toThrow('Capture preparation failed: test cause');
});

it('fails a recording promptly when polling detects a replaced source session', async () => {
    const h = setup({ recording: true });
    const job = await h.controller.startRecording({ format: 'webm' });
    h.setSession('two');
    await expect(h.controller.status(job.job_id)).resolves.toMatchObject({
        state: 'failed', error: expect.stringContaining('source or playback selection changed'),
    });
    expect(h.requests.some((request) => request.command === 'media_export_abort')).toBe(true);
    expect(h.requests.some((request) => request.command === 'media_export_cancel')).toBe(false);
    expect(h.commands.some((command) => command.type === 'media-record-abort')).toBe(false);
});

it('acknowledges stop promptly, keeps status responsive, and permits draining beyond 60 seconds', async () => {
    let release;const h=setup({recording:true,stopGate:new Promise(done=>{release=done;})});
    const job=await h.controller.startRecording({format:'webm'});
    await expect(h.controller.stopRecording()).resolves.toMatchObject({state:'encoding',stage:'draining'});
    await vi.advanceTimersByTimeAsync(61000);
    expect(await h.controller.status(job.job_id)).toMatchObject({state:'encoding',stage:'draining'});
    expect(h.commands.some(c=>c.type==='media-record-status')).toBe(false);
    await h.controller.stopRecording();
    expect(h.commands.filter(c=>c.type==='media-record-stop')).toHaveLength(1);
    release();await vi.waitFor(async()=>expect((await h.controller.status(job.job_id)).state).toBe('completed'));
});

it('never starts native finalization when cancellation races the pending stop acknowledgement', async () => {
    let stopDone,abortDone;const h=setup({recording:true,stopGate:new Promise(r=>{stopDone=r;}),abortGate:new Promise(r=>{abortDone=r;})});
    const job=await h.controller.startRecording({format:'webm'});await h.controller.stopRecording();
    const cancel=h.controller.cancel(job.job_id);stopDone();await vi.advanceTimersByTimeAsync(0);
    expect(h.requests.some(r=>r.command==='media_export_finish')).toBe(false);
    abortDone();await expect(cancel).resolves.toMatchObject({state:'cancelled'});
});
