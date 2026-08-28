/**
 * Keeps the properties viewport pinned to its logical left edge.
 *
 * Native <select> controls are allowed to ask their nearest scroll container
 * to reveal them. In WKWebView that can update scrollLeft even though the
 * properties viewport only exposes a vertical scrollbar, leaving the cards
 * visibly shifted and clipped. The panel has no horizontal interaction, so
 * horizontal movement is always invalid and can be reset synchronously.
 */
export function setupPropertiesPanelViewport({
    cancelAnimationFrameFn = globalThis.cancelAnimationFrame,
    elements,
    requestAnimationFrameFn = globalThis.requestAnimationFrame,
} = {}) {
    const viewport = elements?.vmControlsPanel;
    if (!viewport) return () => {};

    let animationFrameId = null;
    const resetHorizontalPosition = () => {
        if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
    };
    const scheduleReset = () => {
        resetHorizontalPosition();
        if (typeof requestAnimationFrameFn !== 'function' || animationFrameId !== null) return;
        animationFrameId = requestAnimationFrameFn(() => {
            animationFrameId = null;
            resetHorizontalPosition();
        });
    };

    // `scroll` catches native focus scrolling after it happens; the deferred
    // reset covers the WebKit path where that scroll is committed after focus.
    viewport.addEventListener('scroll', resetHorizontalPosition);
    viewport.addEventListener('focusin', scheduleReset);
    viewport.addEventListener('change', scheduleReset);
    resetHorizontalPosition();

    return () => {
        if (animationFrameId !== null && typeof cancelAnimationFrameFn === 'function') {
            cancelAnimationFrameFn(animationFrameId);
        }
        animationFrameId = null;
        viewport.removeEventListener('scroll', resetHorizontalPosition);
        viewport.removeEventListener('focusin', scheduleReset);
        viewport.removeEventListener('change', scheduleReset);
    };
}
