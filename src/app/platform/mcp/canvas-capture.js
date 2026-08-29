const PNG_PREFIX = 'data:image/png;base64,';
export const MAX_CAPTURE_BASE64_CHARS = 12 * 1024 * 1024;
export const MAX_CAPTURE_ATTEMPTS = 4;
export const MAX_CAPTURE_PIXELS = 2_000_000;

export function getPngByteLength(base64) {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function isTransparent(color) {
    const value = String(color || '').trim().toLowerCase().replace(/\s+/g, '');
    return !value || value === 'transparent' || value === 'rgba(0,0,0,0)' || value === 'hsla(0,0%,0%,0)';
}

export function resolveCanvasBackground(canvas, windowRef = globalThis.window) {
    let color = '';
    try { color = windowRef?.getComputedStyle?.(canvas)?.backgroundColor || ''; } catch { /* noop */ }
    if (!color) color = canvas?.style?.backgroundColor || canvas?.style?.background || '';
    return { color: color || 'transparent', composited: !isTransparent(color) };
}

export function captureRenderedCanvas({ canvas, createCanvas, drawFrame = () => {}, riveInstance = null, windowRef = globalThis.window } = {}) {
    if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
        throw new Error('Rendered canvas has zero pixel dimensions');
    }
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    const background = resolveCanvasBackground(canvas, windowRef);
    let scale = Math.min(1, Math.sqrt(MAX_CAPTURE_PIXELS / (originalWidth * originalHeight)));
    // Rive's public drawFrame() intentionally does nothing while its RAF loop
    // owns a pending frame, and DrawOnChanged can skip a static frame after the
    // loop is stopped. Fence the loop and temporarily request one unconditional
    // draw so readback sees the frame that WebKit is actually compositing.
    const canFenceRenderLoop = typeof riveInstance?.stopRendering === 'function'
        && typeof riveInstance?.startRendering === 'function';
    const canForceDraw = riveInstance && 'drawOptimization' in riveInstance;
    const previousDrawOptimization = canForceDraw ? riveInstance.drawOptimization : null;
    if (canFenceRenderLoop) riveInstance.stopRendering();
    try {
        if (canForceDraw) riveInstance.drawOptimization = 'alwaysDraw';
        drawFrame();
    } finally {
        if (canForceDraw) riveInstance.drawOptimization = previousDrawOptimization;
        if (canFenceRenderLoop) riveInstance.startRendering();
    }
    for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt += 1) {
        const width = Math.max(1, Math.floor(originalWidth * scale));
        const height = Math.max(1, Math.floor(originalHeight * scale));
        const outputCanvas = createCanvas?.();
        const context = outputCanvas?.getContext?.('2d');
        if (!outputCanvas || typeof outputCanvas.toDataURL !== 'function' || !context) throw new Error('A 2D canvas is required to encode the rendered screenshot');
        outputCanvas.width = width; outputCanvas.height = height;
        if (background.composited) { context.fillStyle = background.color; context.fillRect(0, 0, width, height); }
        else context.clearRect(0, 0, width, height);
        context.drawImage(canvas, 0, 0, width, height);
        const dataUrl = outputCanvas.toDataURL('image/png');
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) throw new Error('Rendered canvas did not produce PNG image data');
        const data = dataUrl.slice(PNG_PREFIX.length);
        if (!data) throw new Error('Rendered canvas produced an empty PNG image');
        if (data.length <= MAX_CAPTURE_BASE64_CHARS) return {
            image: { mimeType: 'image/png', encoding: 'base64', data },
            metadata: { originalWidth, originalHeight, width, height, scale: width / originalWidth,
                downscaled: width !== originalWidth || height !== originalHeight, background,
                captureAttempts: attempt, pngByteLength: getPngByteLength(data),
                transportBase64Limit: MAX_CAPTURE_BASE64_CHARS },
        };
        scale *= Math.min(0.75, Math.sqrt(MAX_CAPTURE_BASE64_CHARS / data.length) * 0.9);
    }
    throw new Error(`Rendered canvas PNG exceeds the ${MAX_CAPTURE_BASE64_CHARS}-character transport limit after ${MAX_CAPTURE_ATTEMPTS} attempts`);
}
