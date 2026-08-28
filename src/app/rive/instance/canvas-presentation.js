import {
    buildCenteredCanvasScrollOffsets,
    buildResolvedCanvasPixelSize,
    normalizeCanvasSizingState,
} from '../../core/canvas-sizing.js';

export function createInstanceCanvasPresentationController({
    elements,
    getCurrentCanvasSizing = () => normalizeCanvasSizingState(),
    getEditorConfig = () => ({}),
    getRiveInstance = () => null,
    windowRef,
} = {}) {
    function applyPresentation(canvas, sizingState) {
        const container = elements.canvasContainer;
        if (!container || !canvas) return;
        const isFixed = sizingState.mode === 'fixed';
        container.classList.toggle('canvas-container-fixed-size', isFixed);
        canvas.classList.toggle('rive-canvas-fixed-size', isFixed);
        canvas.style.width = isFixed ? `${sizingState.width}px` : '';
        canvas.style.height = isFixed ? `${sizingState.height}px` : '';
    }

    function scheduleViewportAlignment(container, resolvedCanvasSize) {
        if (!container) return;
        const scheduler = typeof windowRef.requestAnimationFrame === 'function'
            ? windowRef.requestAnimationFrame.bind(windowRef)
            : (callback) => callback();
        scheduler(() => {
            if (!resolvedCanvasSize?.fixed) {
                container.scrollLeft = 0;
                container.scrollTop = 0;
                return;
            }
            const offsets = buildCenteredCanvasScrollOffsets({
                containerWidth: container.clientWidth,
                containerHeight: container.clientHeight,
                contentWidth: resolvedCanvasSize.width,
                contentHeight: resolvedCanvasSize.height,
            });
            container.scrollLeft = offsets.left;
            container.scrollTop = offsets.top;
        });
    }

    function resizeCanvas(canvas, editorConfig = {}) {
        const container = elements.canvasContainer;
        if (!container || !canvas) return;
        const sizingState = normalizeCanvasSizingState(
            getCurrentCanvasSizing(),
            editorConfig?.canvasSize || getCurrentCanvasSizing(),
        );
        const resolved = buildResolvedCanvasPixelSize(sizingState, {
            width: container.clientWidth,
            height: container.clientHeight,
        });
        canvas.width = resolved.width;
        canvas.height = resolved.height;
        applyPresentation(canvas, {
            ...sizingState,
            width: resolved.width,
            height: resolved.height,
            mode: resolved.fixed ? 'fixed' : 'auto',
        });
        scheduleViewportAlignment(container, resolved);
    }

    return {
        handleResize() {
            const canvas = windowRef.document?.getElementById('rive-canvas');
            if (!canvas) return;
            resizeCanvas(canvas, getEditorConfig());
            getRiveInstance()?.resizeDrawingSurfaceToCanvas?.();
        },
        resizeCanvas,
    };
}
