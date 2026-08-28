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
});
