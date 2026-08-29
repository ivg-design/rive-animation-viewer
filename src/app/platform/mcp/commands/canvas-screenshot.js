import { captureRenderedCanvas } from '../canvas-capture.js';
import { captureActiveRenderSurface } from '../../render-surface/capture-router.js';

export function createCanvasScreenshotCommands({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
    return { async rav_capture_canvas() {
        const isolated = await captureActiveRenderSurface();
        if (isolated) return { ...isolated, metadata: { ...isolated.metadata, captureSurface: 'isolated-render-surface' } };
        const inst = windowRef?.riveInst;
        const canvas = documentRef?.getElementById?.('rive-canvas');
        if (!inst || !canvas) throw new Error('No rendered canvas is available');
        const capture = captureRenderedCanvas({ canvas, createCanvas: () => documentRef.createElement('canvas'), drawFrame: () => inst.drawFrame(), riveInstance: inst, windowRef });
        const bounds = canvas.getBoundingClientRect?.();
        return { ...capture, metadata: { ...capture.metadata, source: '#rive-canvas', cssWidth: Number.isFinite(bounds?.width) ? bounds.width : null,
            cssHeight: Number.isFinite(bounds?.height) ? bounds.height : null, devicePixelRatio: windowRef.devicePixelRatio || 1,
            renderer: documentRef.getElementById?.('runtime-select')?.value || 'unknown', artboard: inst.artboard?.name || inst.artboardName || null,
            isPlaying: Boolean(inst.isPlaying), capturedAt: new Date().toISOString(), frameRefreshed: true, captureSurface: 'host-canvas' } };
    } };
}
