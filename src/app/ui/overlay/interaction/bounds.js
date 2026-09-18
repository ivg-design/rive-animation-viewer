export function createOverlayBoundsController({
    enqueueOperation, getActiveEpoch, getTauriInvoker, isDisposed,
    windowRef = globalThis.window,
} = {}) {
    let currentBounds = null;
    async function apply(epoch, bounds) {
        await getTauriInvoker?.()?.('set_ui_overlay_bounds', { epoch, bounds });
        currentBounds = bounds;
    }
    async function resizeNow(bounds, transitionMs = 0) {
        const epoch = getActiveEpoch?.();
        if (!epoch || !bounds || isDisposed?.()) return false;
        const from = currentBounds || bounds;
        const reduceMotion = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        const duration = reduceMotion ? 0 : Math.max(0, Number(transitionMs) || 0);
        if (!duration || Math.abs(Number(from.height) - Number(bounds.height)) < 1) {
            await apply(epoch, bounds);
            return getActiveEpoch?.() === epoch;
        }
        const started = windowRef.performance?.now?.() ?? Date.now();
        let progress = 0;
        while (progress < 1 && getActiveEpoch?.() === epoch && !isDisposed?.()) {
            const now = await new Promise((resolve) => {
                if (typeof windowRef.requestAnimationFrame === 'function') windowRef.requestAnimationFrame(resolve);
                else windowRef.setTimeout(() => resolve(Date.now()), 16);
            });
            progress = Math.min(1, (Number(now) - started) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            await apply(epoch, {
                x: from.x + (bounds.x - from.x) * eased,
                y: from.y + (bounds.y - from.y) * eased,
                width: from.width + (bounds.width - from.width) * eased,
                height: from.height + (bounds.height - from.height) * eased,
            });
        }
        return getActiveEpoch?.() === epoch;
    }
    return {
        clear: () => { currentBounds = null; },
        resize: (bounds) => enqueueOperation(() => resizeNow(bounds)),
        resizeNow,
        setCurrent: (bounds) => { currentBounds = bounds; },
    };
}
