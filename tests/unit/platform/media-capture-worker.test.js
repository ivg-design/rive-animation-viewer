import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(`src-tauri/src/demo-template/js/media/${name}.js`, 'utf8');
const elementary = read('stream/elementary');
const worker = read('pipeline/capture-worker');

function harness({ encoderQueue = 0, pngSize = 100 } = {}) {
    const posted = [], encoded = [], blobs = [];
    const self = { postMessage: vi.fn((message, transfer) => posted.push({ message, transfer })), close: vi.fn() };
    class Context {
        clearRect = vi.fn(); fillRect = vi.fn(); drawImage = vi.fn(); save = vi.fn(); restore = vi.fn();
        translate = vi.fn(); beginPath = vi.fn(); moveTo = vi.fn(); lineTo = vi.fn(); closePath = vi.fn(); fill = vi.fn(); stroke = vi.fn();
    }
    class OffscreenCanvas {
        constructor(width, height) { this.width = width; this.height = height; this.context = new Context(); }
        getContext() { return this.context; }
        async convertToBlob() { const blob = { size: pngSize, arrayBuffer: async () => new ArrayBuffer(pngSize) }; blobs.push(blob); return blob; }
    }
    class VideoFrame { constructor(source, options) { this.source = source; this.options = options; this.closed = false; } close() { this.closed = true; } }
    class VideoEncoder {
        constructor(callbacks) { this.callbacks = callbacks; this.state = 'configured'; this.encodeQueueSize = encoderQueue; VideoEncoder.instances.push(this); }
        configure(config) { this.config = config; }
        encode(frame, options) {
            encoded.push({ timestamp: frame.options.timestamp, key: Boolean(options?.keyFrame) });
            const data = new Uint8Array([0, 0, 0, 1, frame.options.timestamp ? 1 : 5]);
            this.callbacks.output({ byteLength: data.length, copyTo: (b) => b.set(data), type: options?.keyFrame ? 'key' : 'delta' }, null);
        }
        async flush() { this.flushed = (this.flushed || 0) + 1; }
        close() { this.state = 'closed'; }
    }
    VideoEncoder.instances = [];
    class FileReaderSync { readAsDataURL() { return 'data:image/png;base64,QUJD'; } }
    const install = new Function('self', 'OffscreenCanvas', 'VideoFrame', 'VideoEncoder', 'FileReaderSync',
        `${elementary}\n${worker}\n mediaCaptureWorker(); return mediaCaptureWorkerSource;`);
    const source = install(self, OffscreenCanvas, VideoFrame, VideoEncoder, FileReaderSync);
    const send = async (message) => { self.onmessage({ data: message }); await flush(); };
    const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
    const bitmap = () => ({ close: vi.fn() });
    return { self, posted, encoded, blobs, send, flush, bitmap, source, VideoEncoder };
}

describe('capture worker', () => {
    const base = { width: 320, height: 200, alpha: false, background: '#112233', cursor: true, fps: 60, output: 'binary' };
    it('embeds the Annex B helpers so the blob is self-contained', () => {
        const h = harness();
        expect(h.source()).toContain('function mediaAnnexBPacket');
        expect(h.source()).toContain('function mediaStreamPacket');
        expect(h.source()).toMatch(/\(function mediaCaptureWorker\(\)[\s\S]*\)\(\);$/);
    });
    it('encodes video frames in order, excludes warm-up output, batches packets and reports counts', async () => {
        const h = harness();
        await h.send({ type: 'configure', config: { ...base, mode: 'video', codec: 'h264', encoder_config: { codec: 'avc1' } } });
        expect(h.posted.at(-1).message).toEqual({ type: 'configured' });
        const warm = h.bitmap();
        await h.send({ type: 'warm', bitmap: warm });
        expect(warm.close).toHaveBeenCalledOnce();
        expect(h.posted.at(-1).message).toEqual({ type: 'warmed' });
        expect(h.posted.some((entry) => entry.message.type === 'encoded')).toBe(false);
        for (let index = 0; index < 3; index += 1) {
            await h.send({ type: 'frame', index, bitmap: h.bitmap(), cursor: { x: 0.5, y: 0.5, inside: true } });
        }
        expect(h.encoded.map((entry) => entry.timestamp)).toEqual([0, 0, 16667, 33333]);
        expect(h.encoded.map((entry) => entry.key)).toEqual([true, true, false, false]);
        const accepted = h.posted.filter((entry) => entry.message.type === 'accepted').map((entry) => entry.message.index);
        expect(accepted).toEqual([0, 1, 2]);
        expect(h.posted.filter((entry) => entry.message.type === 'packet')).toHaveLength(0);
        await h.send({ type: 'finish' });
        const packets = h.posted.filter((entry) => entry.message.type === 'packet');
        expect(packets).toHaveLength(1);
        expect(packets[0].transfer).toEqual([packets[0].message.bytes]);
        expect(new DataView(packets[0].message.bytes).getUint32(0, true)).toBe(3);
        expect(h.posted.at(-1).message).toMatchObject({ type: 'finished', encoded: 3 });
        expect(h.VideoEncoder.instances[0].state).toBe('closed');
    });
    it('composes PNG frames sequentially with alpha preserved and transfers the bytes', async () => {
        const h = harness();
        await h.send({ type: 'configure', config: { ...base, alpha: true, mode: 'png' } });
        const first = h.bitmap(), second = h.bitmap();
        h.self.onmessage({ data: { type: 'frame', index: 0, bitmap: first, cursor: null } });
        h.self.onmessage({ data: { type: 'frame', index: 1, bitmap: second, cursor: null } });
        await h.flush();
        const pngs = h.posted.filter((entry) => entry.message.type === 'png');
        expect(pngs.map((entry) => entry.message.index)).toEqual([0, 1]);
        expect(pngs[0].transfer[0]).toBe(pngs[0].message.bytes);
        expect(first.close).toHaveBeenCalledOnce();
        expect(second.close).toHaveBeenCalledOnce();
        await h.send({ type: 'finish' });
        expect(h.posted.at(-1).message).toMatchObject({ type: 'finished', encoded: 0 });
    });
    it('returns base64 for hosts without the binary transport', async () => {
        const h = harness();
        await h.send({ type: 'configure', config: { ...base, mode: 'png', output: 'base64' } });
        await h.send({ type: 'frame', index: 4, bitmap: h.bitmap(), cursor: null });
        expect(h.posted.at(-1).message).toEqual({ type: 'png', index: 4, base64: 'QUJD' });
    });
    it('reports oversized frames and later frames as errors without leaking bitmaps', async () => {
        const h = harness({ pngSize: 21 * 1024 * 1024 });
        await h.send({ type: 'configure', config: { ...base, mode: 'png' } });
        const bitmap = h.bitmap();
        await h.send({ type: 'frame', index: 0, bitmap, cursor: null });
        expect(h.posted.at(-1).message).toMatchObject({ type: 'error', message: expect.stringContaining('20 MiB') });
        expect(bitmap.close).toHaveBeenCalledOnce();
        const later = h.bitmap();
        await h.send({ type: 'frame', index: 1, bitmap: later, cursor: null });
        expect(later.close).toHaveBeenCalledOnce();
        expect(h.posted.filter((entry) => entry.message.type === 'png')).toHaveLength(0);
    });
    it('rejects configurations above the four megapixel limit', async () => {
        const h = harness();
        await h.send({ type: 'configure', config: { ...base, width: 4096, height: 2048, mode: 'png' } });
        expect(h.posted.at(-1).message).toMatchObject({ type: 'error', message: expect.stringContaining('four megapixel') });
    });
});

describe('upload worker', () => {
    function uploadHarness() {
        const posted = [], sends = [];
        let release = [];
        const transport = {
            pendingBytes: () => 0, cancel: vi.fn(), drain: vi.fn(async () => {}),
            send: vi.fn((index, bytes) => new Promise((resolve, reject) => { sends.push({ index, bytes }); release.push({ resolve, reject }); })),
        };
        const self = { postMessage: vi.fn((message) => posted.push(message)), close: vi.fn() };
        new Function('self', 'createMediaBinaryTransport', `${worker}\n mediaUploadWorker();`)(self, () => transport);
        const ports = [{}, {}];
        self.onmessage({ data: { type: 'configure', jobId: 'job', baseUrl: 'rav-render://localhost', ports } });
        const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
        return { posted, sends, transport, ports, self, flush, releaseNext: () => release.shift() };
    }
    const bytes = (n) => new Uint8Array([n]).buffer;
    it('restores PNG order across ports, uploads strictly one at a time, and reports pending bytes on arrival', async () => {
        const h = uploadHarness();
        expect(h.posted[0]).toEqual({ type: 'configured' });
        h.ports[1].onmessage({ data: { type: 'png', index: 1, bytes: bytes(1) } });
        h.ports[0].onmessage({ data: { type: 'png', index: 2, bytes: bytes(2) } });
        await h.flush();
        expect(h.sends).toEqual([]);
        expect(h.posted.filter((m) => m.type === 'queued')).toHaveLength(0);
        h.ports[0].onmessage({ data: { type: 'png', index: 0, bytes: bytes(0) } });
        await h.flush();
        expect(h.sends.map((s) => s.index)).toEqual([0]);
        expect(h.posted.filter((m) => m.type === 'queued').map((m) => m.pending)).toEqual([1, 1, 2]); // the in-flight frame is counted by the transport, not the queue
        h.releaseNext().resolve({}); await h.flush();
        expect(h.sends.map((s) => s.index)).toEqual([0, 1]);
        expect(h.posted.at(-1)).toMatchObject({ type: 'delivered', index: 0, delivered: 1 });
        h.releaseNext().resolve({}); await h.flush();
        h.releaseNext().resolve({}); await h.flush();
        expect(h.sends.map((s) => s.index)).toEqual([0, 1, 2]);
        h.self.onmessage({ data: { type: 'drain' } });
        h.ports[0].onmessage({ data: { type: 'end' } });
        await h.flush();
        expect(h.transport.drain).not.toHaveBeenCalled();
        h.ports[1].onmessage({ data: { type: 'end' } });
        await h.flush();
        expect(h.transport.drain).toHaveBeenCalledOnce();
        expect(h.posted.at(-1)).toEqual({ type: 'drained', delivered: 3 });
    });
    it('forwards transport failures once with their disk-space receipt', async () => {
        const h = uploadHarness();
        h.ports[0].onmessage({ data: { type: 'packet', index: 0, bytes: bytes(0) } });
        await h.flush();
        const stop = new Error('Recording stopped at the available disk-space limit.'); stop.code = 'disk_space'; stop.receipt = { frame_count: 1 };
        h.releaseNext().reject(stop); await h.flush();
        expect(h.posted.at(-1)).toEqual({ type: 'error', message: stop.message, code: 'disk_space', receipt: { frame_count: 1 } });
        h.ports[0].onmessage({ data: { type: 'packet', index: 1, bytes: bytes(1) } });
        await h.flush();
        expect(h.sends).toHaveLength(1);
    });
});
