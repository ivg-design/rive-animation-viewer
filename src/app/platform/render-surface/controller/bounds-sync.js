import { measureRenderSurfaceBounds, renderSurfaceBoundsKey } from '../bounds.js';

export function createRenderSurfaceBoundsSync({
    canFocusSync = () => false,
    elements,
    hasSurface,
    invokeQuietly,
    isDisposed,
    onResult = () => {},
    prepareFocusSync = async () => true,
    windowRef,
}) {
    let frameId = null;
    let lastBoundsKey = null;
    const requestFrame = typeof windowRef?.requestAnimationFrame === 'function'
        ? windowRef.requestAnimationFrame.bind(windowRef)
        : (callback) => windowRef.setTimeout(callback, 0);
    const cancelFrame = typeof windowRef?.cancelAnimationFrame === 'function'
        ? windowRef.cancelAnimationFrame.bind(windowRef)
        : windowRef.clearTimeout.bind(windowRef);

    function remember(bounds) {
        lastBoundsKey = renderSurfaceBoundsKey(bounds);
    }

    async function sync({ force = false } = {}) {
        const bounds = measureRenderSurfaceBounds(elements.canvasContainer);
        if (!bounds) return false;
        const nextKey = renderSurfaceBoundsKey(bounds);
        if (!force && nextKey === lastBoundsKey) return true;
        lastBoundsKey = nextKey;
        if (!hasSurface()) return true;
        const applied = await invokeQuietly('set_render_surface_bounds', bounds);
        onResult({ applied, bounds });
        return applied;
    }

    function schedule() {
        if (frameId !== null || isDisposed()) return;
        frameId = requestFrame(() => {
            frameId = null;
            void sync();
        });
    }

    async function handleFocus() {
        if (!canFocusSync()) return;
        if (await prepareFocusSync()) await sync({ force: true });
    }

    function setupFocusSync() {
        windowRef?.addEventListener?.('focus', handleFocus);
    }

    function dispose() {
        windowRef?.removeEventListener?.('focus', handleFocus);
        if (frameId !== null) {
            cancelFrame(frameId);
            frameId = null;
        }
    }

    return { dispose, remember, schedule, setupFocusSync, sync };
}
