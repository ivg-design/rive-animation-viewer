import {
    buildCanvasSizingStateFromViewport,
    buildResolvedCanvasPixelSize,
    formatAspectRatioLabel,
    normalizeCanvasSizingState,
    setCanvasSizingLock,
    setCanvasSizingMode,
    updateCanvasSizingDimension,
} from '../../../src/app/core/canvas-sizing.js';

describe('core/canvas-sizing', () => {
    it('normalizes canvas sizing input and resolves fixed and auto pixel sizes', () => {
        expect(normalizeCanvasSizingState()).toEqual({
            mode: 'auto',
            width: 1280,
            height: 720,
            lockAspectRatio: false,
            aspectRatio: 1280 / 720,
        });

        expect(buildResolvedCanvasPixelSize({
            mode: 'fixed',
            width: 1920,
            height: 1080,
        })).toEqual({
            width: 1920,
            height: 1080,
            fixed: true,
        });

        expect(buildResolvedCanvasPixelSize({ mode: 'auto' }, {
            width: 900,
            height: 600,
        })).toEqual({
            width: 900,
            height: 600,
            fixed: false,
        });
    });

    it('updates dimensions and preserves aspect ratio when locked', () => {
        const locked = setCanvasSizingLock({
            mode: 'fixed',
            width: 1600,
            height: 900,
        }, true);
        const resized = updateCanvasSizingDimension(locked, 'width', 1280);

        expect(resized).toEqual(expect.objectContaining({
            width: 1280,
            height: 720,
            lockAspectRatio: true,
        }));
        expect(formatAspectRatioLabel(resized)).toBe('16:9');
    });

    it('can seed a fixed state from the current viewport size', () => {
        const seeded = buildCanvasSizingStateFromViewport(1024, 768);
        expect(setCanvasSizingMode(seeded, 'fixed')).toEqual(expect.objectContaining({
            mode: 'fixed',
            width: 1024,
            height: 768,
        }));
    });
});
