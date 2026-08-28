import {
    buildRiveAlignmentExpression,
    buildRiveFitExpression,
    normalizeLayoutAlignment,
    normalizeLayoutFit,
    resolveRiveAlignment,
    resolveRiveFit,
} from '../../../src/app/core/rive-layout.js';

function containedPlacement({
    alignment,
    artboardHeight,
    artboardWidth,
    canvasHeight,
    canvasWidth,
}) {
    const scale = Math.min(canvasWidth / artboardWidth, canvasHeight / artboardHeight);
    const contentWidth = artboardWidth * scale;
    const contentHeight = artboardHeight * scale;
    const horizontal = alignment.endsWith('Left') || alignment === 'topLeft' || alignment === 'bottomLeft'
        ? 0
        : (alignment.endsWith('Right') || alignment === 'topRight' || alignment === 'bottomRight' ? 1 : 0.5);
    const vertical = alignment.startsWith('top') ? 0 : (alignment.startsWith('bottom') ? 1 : 0.5);
    return {
        contentHeight,
        contentWidth,
        x: (canvasWidth - contentWidth) * horizontal,
        y: (canvasHeight - contentHeight) * vertical,
    };
}

describe('core/rive-layout', () => {
    it('normalizes invalid layout tokens to the documented defaults', () => {
        expect(normalizeLayoutFit('contain')).toBe('contain');
        expect(normalizeLayoutFit('bogus')).toBe('contain');
        expect(normalizeLayoutAlignment('topLeft')).toBe('topLeft');
        expect(normalizeLayoutAlignment('bogus')).toBe('center');
    });

    it('resolves runtime fit/alignment values through the runtime enums when available', () => {
        const runtime = {
            Alignment: {
                CenterRight: 7,
            },
            Fit: {
                Cover: 0,
            },
        };

        expect(resolveRiveFit(runtime, 'cover')).toBe(runtime.Fit.Cover);
        expect(resolveRiveAlignment(runtime, 'centerRight')).toBe(runtime.Alignment.CenterRight);
    });

    it('falls back to normalized strings when runtime enums are unavailable', () => {
        expect(resolveRiveFit({}, 'fitWidth')).toBe('fitWidth');
        expect(resolveRiveAlignment({}, 'bottomLeft')).toBe('bottomLeft');
    });

    it('builds compile-time layout expressions for exported snippets', () => {
        expect(buildRiveFitExpression('rive', 'fitWidth')).toBe('rive.Fit.FitWidth');
        expect(buildRiveAlignmentExpression('rive', 'bottomCenter')).toBe('rive.Alignment.BottomCenter');
    });

    it('keeps the full horizontal alignment contract distinct when contain has horizontal slack', () => {
        const runtime = {
            Alignment: {
                Center: Symbol('Center'),
                CenterLeft: Symbol('CenterLeft'),
                CenterRight: Symbol('CenterRight'),
            },
        };
        const geometry = {
            artboardHeight: 640,
            artboardWidth: 320,
            canvasHeight: 500,
            canvasWidth: 1000,
        };
        const left = containedPlacement({ ...geometry, alignment: 'centerLeft' });
        const center = containedPlacement({ ...geometry, alignment: 'center' });
        const right = containedPlacement({ ...geometry, alignment: 'centerRight' });

        // This is the dual-surface transport contract: RAV must hand the
        // exact runtime enum through, and Rive has 750px of horizontal slack
        // to make each horizontal placement visibly distinct.
        expect(resolveRiveAlignment(runtime, 'centerLeft')).toBe(runtime.Alignment.CenterLeft);
        expect(resolveRiveAlignment(runtime, 'center')).toBe(runtime.Alignment.Center);
        expect(resolveRiveAlignment(runtime, 'centerRight')).toBe(runtime.Alignment.CenterRight);
        expect([left.x, center.x, right.x]).toEqual([0, 375, 750]);
        expect(new Set([left.x, center.x, right.x])).toHaveLength(3);
    });

    it('does not report a horizontal alignment defect when contain is width-limited', () => {
        const geometry = {
            artboardHeight: 496,
            artboardWidth: 1378,
            canvasHeight: 409,
            canvasWidth: 500,
        };
        const left = containedPlacement({ ...geometry, alignment: 'topLeft' });
        const right = containedPlacement({ ...geometry, alignment: 'topRight' });

        // data_binding_images_test.riv's main artboard is 1378 x 496. At
        // 500 x 409 with contain it consumes the entire canvas width, so
        // only vertical alignment has visible space to move.
        expect(left.contentWidth).toBeCloseTo(500, 6);
        expect(left.contentHeight).toBeCloseTo((496 * 500) / 1378, 6);
        expect(left.x).toBe(0);
        expect(right.x).toBe(0);
        expect(right.y).toBe(0);
    });
});
