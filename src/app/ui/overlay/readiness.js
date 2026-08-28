function nextFrame(windowRef) {
    return new Promise((resolve) => {
        const requestFrame = windowRef?.requestAnimationFrame;
        if (typeof requestFrame === 'function') {
            requestFrame.call(windowRef, () => resolve());
            return;
        }
        windowRef?.setTimeout?.(resolve, 0) ?? resolve();
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
    await nextFrame(windowRef);
    await nextFrame(windowRef);
}
