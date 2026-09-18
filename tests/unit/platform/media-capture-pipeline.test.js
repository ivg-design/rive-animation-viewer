import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(`src-tauri/src/demo-template/js/media/${name}.js`, 'utf8');
const pipeline = read('pipeline/capture-pipeline');

function build({ Worker, createImageBitmap, supported = true }) {
    const urls = { createObjectURL: vi.fn(() => `blob:${urls.createObjectURL.mock.calls.length}`), revokeObjectURL: vi.fn() };
    class MessageChannel { constructor() { this.port1 = { id: 'p1' }; this.port2 = { id: 'p2' }; } }
    const create = new Function('Worker', 'OffscreenCanvas', 'createImageBitmap', 'MessageChannel', 'URL', 'Blob', 'location', 'navigator',
        'mediaCaptureWorkerSource', 'mediaUploadWorkerSource', 'setTimeout', 'clearTimeout',
        `${pipeline}; return createMediaCapturePipeline;`)(
        supported ? Worker : undefined, supported ? class {} : undefined, createImageBitmap, MessageChannel, urls,
        class { constructor(parts) { this.parts = parts; } }, { origin: 'rav-render://localhost' }, { hardwareConcurrency: 5 },
        () => '/* capture */', () => '/* upload */', setTimeout, clearTimeout);
    return { create, urls };
}

function harness({ supported = true } = {}) {
    const workers = [], bitmaps = [];
    class Worker {
        constructor(url, options) { this.url = url; this.name = options?.name; this.posted = []; workers.push(this); }
        postMessage(message, transfer) { this.posted.push({ message, transfer }); }
        terminate() { this.terminated = true; }
        reply(message) { this.onmessage({ data: message }); }
    }
    const createImageBitmap = vi.fn(async (canvas, opts) => { const bitmap = { canvas, opts, close: vi.fn() }; bitmaps.push(bitmap); return bitmap; });
    const { create, urls } = build({ Worker, createImageBitmap, supported });
    const options = { native_job_id: 'job', width: 320, height: 200, fps: { numerator: 60, denominator: 1 }, background: '#000', cursor: false };
    const captureWorkers = () => workers.filter((worker) => worker.name?.startsWith('rav-capture-') && worker.name !== 'rav-capture-upload');
    const uploader = () => workers.filter((worker) => worker.name === 'rav-capture-upload').at(-1);
    const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
    async function configured(pipe) {
        const before = workers.length;
        const ready = pipe.configure();
        await flush();
        uploader()?.reply({ type: 'configured' });
        await flush();
        workers.slice(before).filter((worker) => worker.name !== 'rav-capture-upload').forEach((worker) => worker.reply({ type: 'configured' }));
        await ready;
    }
    return { create, workers, bitmaps, urls, options, captureWorkers, uploader, configured, flush };
}

describe('capture pipeline', () => {
    it('wires capture workers to the uploader over ports, snapshots at output size, and bounds in-flight frames', async () => {
        const h = harness(), onError = vi.fn();
        const pipe = h.create({ ...h.options, capture_codec: 'h264', encoder_config: { codec: 'avc1' } }, { onError });
        const ready = pipe.configure(); await h.flush();
        expect(h.captureWorkers()).toHaveLength(1);
        const up = h.uploader();
        expect(up.posted[0].message).toMatchObject({ type: 'configure', jobId: 'job', baseUrl: 'rav-render://localhost' });
        expect(up.posted[0].message.ports).toEqual([{ id: 'p2' }]);
        expect(up.posted[0].transfer).toEqual([{ id: 'p2' }]);
        const capture = h.captureWorkers()[0];
        expect(capture.posted[0].message).toMatchObject({ type: 'configure', uploadPort: { id: 'p1' }, config: { mode: 'video', width: 320, height: 200, fps: 60, output: 'binary' } });
        expect(capture.posted[0].transfer).toEqual([{ id: 'p1' }]);
        up.reply({ type: 'configured' }); await h.flush(); capture.reply({ type: 'configured' }); await ready;
        const canvas = { width: 640, height: 400 };
        expect(pipe.canAccept()).toBe(true);
        for (let index = 0; index < 3; index += 1) pipe.capture(canvas, index, { x: 0.1, y: 0.2, inside: true });
        expect(pipe.canAccept()).toBe(false);
        await h.flush();
        expect(h.bitmaps[0].opts).toEqual({ resizeWidth: 320, resizeHeight: 200, resizeQuality: 'high' });
        const frames = capture.posted.filter((entry) => entry.message.type === 'frame');
        expect(frames.map((entry) => entry.message.index)).toEqual([0, 1, 2]);
        expect(frames[0].transfer).toEqual([h.bitmaps[0]]);
        expect(frames[0].message.cursor).toEqual({ x: 0.1, y: 0.2, inside: true });
        capture.reply({ type: 'accepted', index: 0, queue: 1 });
        expect(pipe.canAccept()).toBe(true);
        capture.reply({ type: 'accepted', index: 1, queue: 5 });
        expect(pipe.canAccept()).toBe(false);
        capture.reply({ type: 'encoded', encoded: 2, queue: 0 });
        expect(pipe.canAccept()).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });
    it('skips the GPU resize when the canvas matches the output and falls back once when resize options are unsupported', async () => {
        const h = harness();
        const pipe = h.create({ ...h.options }, {});
        await h.configured(pipe);
        pipe.capture({ width: 320, height: 200 }, 0, null); await h.flush();
        expect(h.bitmaps[0].opts).toBeUndefined();
        let calls = 0;
        const cib = vi.fn(async (canvas, opts) => { calls += 1; if (opts) throw new TypeError('unsupported'); return { canvas, close: vi.fn() }; });
        class Worker { constructor(u, o) { this.name = o?.name; this.posted = []; } postMessage(m, t) { this.posted.push({ message: m, transfer: t }); } terminate() {} }
        const fallback = build({ Worker, createImageBitmap: cib }).create({ ...h.options }, {});
        fallback.capture({ width: 10, height: 10 }, 0, null); await h.flush();
        fallback.capture({ width: 10, height: 10 }, 1, null); await h.flush();
        expect(calls).toBe(3);
    });
    it('reports uploads, uploader back-pressure and finish counts for PNG captures', async () => {
        const h = harness(), onProgress = vi.fn();
        const pipe = h.create({ ...h.options, alpha: true }, { onProgress });
        await h.configured(pipe);
        expect(h.captureWorkers()).toHaveLength(3);
        expect(h.uploader().posted[0].message.ports).toHaveLength(3);
        for (let index = 0; index < 4; index += 1) pipe.capture({ width: 320, height: 200 }, index, null);
        await h.flush();
        expect(h.captureWorkers().map((worker) => worker.posted.filter((entry) => entry.message.type === 'frame').map((entry) => entry.message.index)))
            .toEqual([[0, 3], [1], [2]]);
        h.captureWorkers()[1].reply({ type: 'compressed', index: 1 });
        h.uploader().reply({ type: 'delivered', index: 0, delivered: 1, pending: 9 * 1024 * 1024 });
        expect(onProgress).toHaveBeenCalledOnce();
        expect(pipe.canAccept()).toBe(false);
        h.uploader().reply({ type: 'delivered', index: 1, delivered: 2, pending: 0 });
        h.captureWorkers().forEach((worker) => worker.reply({ type: 'compressed', index: 0 }));
        expect(pipe.canAccept()).toBe(true);
        const finishing = pipe.finish(4);
        await h.flush();
        h.captureWorkers().forEach((worker) => { expect(worker.posted.at(-1).message).toEqual({ type: 'finish' }); worker.reply({ type: 'finished', encoded: 0 }); });
        await h.flush();
        expect(h.uploader().posted.at(-1).message).toEqual({ type: 'drain' });
        h.uploader().reply({ type: 'delivered', index: 3, delivered: 4, pending: 0 });
        h.uploader().reply({ type: 'drained', delivered: 4 });
        await expect(finishing).resolves.toBeNull();
    });
    it('rejects a delivery shortfall and returns the video receipt when counts match', async () => {
        const h = harness();
        const short = h.create({ ...h.options, alpha: true }, {});
        await h.configured(short);
        const failing = short.finish(3);
        await h.flush();
        h.captureWorkers().forEach((worker) => worker.reply({ type: 'finished', encoded: 0 }));
        await h.flush();
        h.uploader().reply({ type: 'drained', delivered: 2 });
        await expect(failing).rejects.toThrow('every requested frame');
        const video = harness();
        const pipe = video.create({ ...video.options, capture_codec: 'h264', encoder_config: {} }, {});
        await video.configured(pipe);
        const finishing = pipe.finish(2);
        await video.flush();
        video.captureWorkers()[0].reply({ type: 'finished', encoded: 2, max_queue: 3 });
        await video.flush();
        video.uploader().reply({ type: 'drained', delivered: 1 });
        await expect(finishing).resolves.toEqual({ encoded_frames: 2, repeated_frames: 0, max_encode_queue: 3 });
    });
    it('routes base64 frames to the host without an uploader when there is no native job', async () => {
        const h = harness(), emitFrame = vi.fn(async () => {});
        const pipe = h.create({ ...h.options, native_job_id: null }, { emitFrame });
        await h.configured(pipe);
        expect(h.uploader()).toBeUndefined();
        expect(h.captureWorkers()[0].posted[0].message).toMatchObject({ uploadPort: null, config: { output: 'base64' } });
        h.captureWorkers()[0].reply({ type: 'png', index: 3, base64: 'QUJD' });
        await h.flush();
        expect(emitFrame).toHaveBeenCalledWith(3, 'QUJD');
    });
    it('surfaces worker and uploader errors once, keeps disk-space receipts, and disposes everything', async () => {
        const h = harness(), onError = vi.fn();
        const pipe = h.create({ ...h.options }, { onError });
        await h.configured(pipe);
        h.uploader().reply({ type: 'error', message: 'Recording stopped at the available disk-space limit.', code: 'disk_space', receipt: { frame_count: 12 } });
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][0]).toMatchObject({ code: 'disk_space', receipt: { frame_count: 12 } });
        h.captureWorkers()[0].reply({ type: 'error', message: 'later' });
        expect(onError).toHaveBeenCalledOnce();
        expect(() => pipe.capture({}, 0, null)).toThrow('disk-space');
        pipe.dispose(); pipe.dispose();
        expect(h.workers.every((worker) => worker.terminated)).toBe(true);
        expect(h.urls.revokeObjectURL).toHaveBeenCalledTimes(2);
    });
    it('fails closed without worker support', async () => {
        const h = harness({ supported: false });
        const pipe = h.create({ ...h.options }, {});
        await expect(pipe.configure()).rejects.toThrow('unavailable');
    });
});
