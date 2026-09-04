import { readFileSync } from 'node:fs';
const source = readFileSync('src-tauri/src/demo-template/js/media/png-encoder.js', 'utf8');

function harness({ workerSupported = true } = {}) {
    const workers = [], urls = { createObjectURL: vi.fn(() => 'blob:worker'), revokeObjectURL: vi.fn() };
    class Canvas { transferToImageBitmap() {} }
    class Worker {
        constructor() { workers.push(this); }
        postMessage = vi.fn();
        terminate = vi.fn();
    }
    const create = new Function('Worker', 'OffscreenCanvas', 'URL', 'document', `${source}; return createMediaRecordingSlots;`)(
        workerSupported ? Worker : undefined, Canvas, urls, document);
    return { slots: create(), workers, urls };
}

describe('recording PNG workers', () => {
    it('transfers ownership once and rejects a second capture in the same occupied worker', async () => {
        const h = harness(), bitmap = { close: vi.fn() }, another = { close: vi.fn() };
        expect(h.workers).toHaveLength(3);
        const first = h.slots[0].encode(bitmap);
        expect(h.workers[0].postMessage).toHaveBeenCalledWith(bitmap, [bitmap]);
        await expect(h.slots[0].encode(another)).rejects.toThrow('unavailable');
        expect(another.close).toHaveBeenCalledOnce();
        h.workers[0].onmessage({ data: { png: 'encoded' } });
        await expect(first).resolves.toBe('encoded');
        expect(bitmap.close).not.toHaveBeenCalled(); // Worker owns the transferred bitmap.
        h.slots.forEach((slot) => { slot.dispose(); slot.dispose(); });
        h.workers.forEach((worker) => expect(worker.terminate).toHaveBeenCalledOnce());
        expect(h.urls.revokeObjectURL).toHaveBeenCalledTimes(3);
    });
    it('rejects stalled or failed encodes and allows every worker to be reclaimed', async () => {
        const h = harness();
        const stalled = expect(h.slots[0].encode({ close: vi.fn() })).rejects.toThrow('timed out');
        const failed = expect(h.slots[1].encode({ close: vi.fn() })).rejects.toThrow('encode failed');
        h.workers[1].onerror({ message: 'encode failed' });
        await failed;
        await vi.advanceTimersByTimeAsync(10000);
        await stalled;
        h.slots.forEach((slot) => slot.dispose());
        expect(h.urls.revokeObjectURL).toHaveBeenCalledTimes(3);
    });
    it('retains three bounded HTML canvas slots in WebViews without workers', () => {
        const h = harness({ workerSupported: false });
        expect(h.workers).toHaveLength(0);
        expect(h.slots).toHaveLength(3);
        h.slots.forEach((slot) => {
            expect(slot.canvas.tagName).toBe('CANVAS');
            expect(slot.encode).toBeUndefined();
            slot.dispose();
        });
    });
});
