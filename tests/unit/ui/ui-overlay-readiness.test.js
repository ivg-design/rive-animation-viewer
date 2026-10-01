import { waitForOverlayVisualReadiness } from '../../../src/app/ui/overlay/readiness.js';

describe('native UI overlay visual readiness', () => {
    it('waits for fonts, visible images, and two painted frames in order', async () => {
        const order = [];
        let resolveFonts;
        const fontsReady = new Promise((resolve) => { resolveFonts = resolve; });
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: fontsReady },
        });
        document.body.innerHTML = `
            <section><img id="visible" alt=""></section>
            <section hidden><img id="hidden" alt=""></section>
        `;
        const visible = document.getElementById('visible');
        const hidden = document.getElementById('hidden');
        visible.decode = vi.fn(async () => { order.push('image'); });
        hidden.decode = vi.fn(async () => { order.push('hidden-image'); });
        const requestAnimationFrame = vi.fn((callback) => {
            order.push(`frame-${requestAnimationFrame.mock.calls.length}`);
            callback();
        });

        const ready = waitForOverlayVisualReadiness({
            documentRef: document,
            windowRef: { requestAnimationFrame },
        });
        await Promise.resolve();
        expect(order).toEqual([]);
        order.push('fonts');
        resolveFonts();
        await ready;

        expect(order).toEqual(['fonts', 'image', 'frame-1', 'frame-2']);
        expect(hidden.decode).not.toHaveBeenCalled();
    });

    it('rejects a broken visible image instead of presenting an incomplete panel', async () => {
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: Promise.resolve() },
        });
        document.body.innerHTML = '<img id="broken" alt="">';
        document.getElementById('broken').decode = vi.fn().mockRejectedValue(new Error('decode failed'));

        await expect(waitForOverlayVisualReadiness({
            documentRef: document,
            windowRef: { requestAnimationFrame: (callback) => callback() },
        })).rejects.toThrow('decode failed');
    });

    function stubDocument(visibilityState) {
        return { fonts: { ready: Promise.resolve() }, querySelectorAll: () => [], visibilityState };
    }

    it('falls back to a bounded timer when the hidden window starves animation frames', async () => {
        const requestAnimationFrame = vi.fn();
        let settled = false;

        const ready = waitForOverlayVisualReadiness({
            documentRef: stubDocument('hidden'),
            windowRef: { requestAnimationFrame, setTimeout, clearTimeout },
        }).then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(249);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(251);
        await ready;

        expect(settled).toBe(true);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    it('keeps waiting for a real paint while the window is visible', async () => {
        const callbacks = [];
        const documentRef = stubDocument('visible');
        let settled = false;

        const ready = waitForOverlayVisualReadiness({
            documentRef,
            windowRef: { requestAnimationFrame: (callback) => callbacks.push(callback), setTimeout, clearTimeout },
        }).then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(2000);
        expect(settled).toBe(false);
        callbacks.shift()();
        await vi.advanceTimersByTimeAsync(0);
        callbacks.shift()();
        await ready;

        expect(settled).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops waiting once a visible window becomes hidden mid-wait', async () => {
        const documentRef = stubDocument('visible');
        let settled = false;

        const ready = waitForOverlayVisualReadiness({
            documentRef,
            windowRef: { requestAnimationFrame: vi.fn(), setTimeout, clearTimeout },
        }).then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(1000);
        expect(settled).toBe(false);
        documentRef.visibilityState = 'hidden';
        await vi.advanceTimersByTimeAsync(500);
        await ready;

        expect(settled).toBe(true);
    });

    it('clears the fallback timer once a frame paints', async () => {
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: Promise.resolve() },
        });
        document.body.innerHTML = '';
        const clear = vi.fn(clearTimeout);

        await waitForOverlayVisualReadiness({
            documentRef: document,
            windowRef: { requestAnimationFrame: (callback) => callback(), setTimeout, clearTimeout: clear },
        });

        expect(clear).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
});
