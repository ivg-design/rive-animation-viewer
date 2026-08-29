import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    captureRenderedCanvas,
    MAX_CAPTURE_PIXELS,
} from '../../../src/app/platform/mcp/canvas-capture.js';
import {
    captureActiveRenderSurface,
    createRenderSurfaceCaptureSession,
} from '../../../src/app/platform/render-surface/capture-router.js';

describe('MCP canvas screenshot', () => {
    let captureSession = null;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        captureSession?.dispose();
        captureSession = null;
    });

    it('refreshes and downscales the rendered canvas while compositing its background', () => {
        const context = {
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            fillRect: vi.fn(),
            fillStyle: '',
        };
        const output = {
            getContext: vi.fn(() => context),
            height: 0,
            toDataURL: vi.fn(() => 'data:image/png;base64,iVBORw0KGgo='),
            width: 0,
        };
        const canvas = { height: 2_000, width: 2_000 };
        const drawFrame = vi.fn();

        const result = captureRenderedCanvas({
            canvas,
            createCanvas: () => output,
            drawFrame,
            windowRef: { getComputedStyle: () => ({ backgroundColor: 'rgb(12, 18, 24)' }) },
        });

        expect(drawFrame).toHaveBeenCalledOnce();
        expect(output.width * output.height).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS);
        expect(context.fillRect).toHaveBeenCalledWith(0, 0, output.width, output.height);
        expect(context.drawImage).toHaveBeenCalledWith(canvas, 0, 0, output.width, output.height);
        expect(result).toMatchObject({
            image: { data: 'iVBORw0KGgo=', mimeType: 'image/png' },
            metadata: {
                background: { color: 'rgb(12, 18, 24)', composited: true },
                downscaled: true,
                originalHeight: 2_000,
                originalWidth: 2_000,
            },
        });
    });

    it('routes capture to the active child and rejects an unavailable command immediately', async () => {
        const sendCommand = vi.fn(async () => ({ applied: false, status: 'unavailable' }));
        captureSession = createRenderSurfaceCaptureSession({
            getSessionId: () => 'capture-session',
            isActive: () => true,
            sendCommand,
            windowRef: window,
        });

        await expect(captureActiveRenderSurface()).rejects.toThrow('(unavailable)');
        expect(sendCommand).toHaveBeenCalledWith('capture-canvas', {
            requestId: 'capture-session-capture-1',
        });
    });

    it('resolves the child image response and clears the capture request', async () => {
        captureSession = createRenderSurfaceCaptureSession({
            getSessionId: () => 'capture-session',
            isActive: () => true,
            sendCommand: vi.fn(async () => ({ applied: true, status: 'applied' })),
            windowRef: window,
        });
        const pending = captureActiveRenderSurface();

        expect(captureSession.handleResponse({
            requestId: 'capture-session-capture-1',
            result: {
                image: { data: 'iVBORw0KGgo=', mimeType: 'image/png' },
                metadata: { width: 640 },
            },
        })).toBe(true);
        await expect(pending).resolves.toMatchObject({
            image: { data: 'iVBORw0KGgo=', mimeType: 'image/png' },
            metadata: { width: 640 },
        });
        expect(captureSession.handleResponse({
            requestId: 'capture-session-capture-1',
            result: {},
        })).toBe(false);
    });

    it('rejects a failed child command without leaving the request pending', async () => {
        captureSession = createRenderSurfaceCaptureSession({
            getSessionId: () => 'capture-session',
            isActive: () => true,
            sendCommand: vi.fn(async () => { throw new Error('bridge stopped'); }),
            windowRef: window,
        });

        await expect(captureActiveRenderSurface()).rejects.toThrow('bridge stopped');
        expect(captureSession.handleResponse({
            requestId: 'capture-session-capture-1',
            result: {},
        })).toBe(false);
    });
});
