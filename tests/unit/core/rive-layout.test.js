import {
    buildRiveAlignmentExpression,
    buildRiveFitExpression,
    normalizeLayoutAlignment,
    normalizeLayoutFit,
    resolveRiveAlignment,
    resolveRiveFit,
} from '../../../src/app/core/rive-layout.js';

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
});
