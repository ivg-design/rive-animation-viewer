// requestAnimationFrame stops while the RAV window is hidden or occluded. The
// timer only completes the wait for a hidden document; a visible one must paint.
const FRAME_FALLBACK_MS = 250;

function nextFrame(windowRef, documentRef) {
    return new Promise((resolve) => {
        const requestFrame = windowRef?.requestAnimationFrame;
        if (typeof requestFrame !== 'function') {
            windowRef?.setTimeout?.(resolve, 0) ?? resolve();
            return;
        }
        let timer = null;
        const finish = () => {
            if (timer !== null) windowRef.clearTimeout?.(timer);
            timer = null;
            resolve();
        };
        const checkHidden = () => {
            if (documentRef?.visibilityState === 'hidden') finish();
            else timer = windowRef.setTimeout?.(checkHidden, FRAME_FALLBACK_MS) ?? null;
        };
        timer = windowRef.setTimeout?.(checkHidden, FRAME_FALLBACK_MS) ?? null;
        requestFrame.call(windowRef, finish);
    });
}

function isVisibleImage(image) {
    return !image.hidden && !image.closest?.('[hidden]');
}

async function waitForImage(image) {
    if (image.complete && image.naturalWidth > 0) return;
    if (typeof image.decode === 'function') {
        await image.decode();
        return;
    }
    await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', () => reject(new Error('UI overlay image failed to load')), {
            once: true,
        });
    });
}

export async function waitForOverlayVisualReadiness({
    documentRef = globalThis.document,
    windowRef = globalThis.window,
} = {}) {
    if (documentRef?.fonts?.ready) await documentRef.fonts.ready;
    const visibleImages = Array.from(documentRef?.querySelectorAll?.('img') || [])
        .filter(isVisibleImage);
    await Promise.all(visibleImages.map(waitForImage));
    await nextFrame(windowRef, documentRef);
    await nextFrame(windowRef, documentRef);
}
