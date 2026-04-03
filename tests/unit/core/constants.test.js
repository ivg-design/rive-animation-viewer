import {
    buildFallbackRuntimeVersionOptions,
    CLICK_THROUGH_POLL_INTERVAL_MS,
    DEFAULT_CANVAS_COLOR,
    DEFAULT_LAYOUT_FIT,
    FALLBACK_RUNTIME_VERSION_OPTIONS,
    LAYOUT_FITS,
    OPEN_FILE_POLL_INTERVAL_MS,
    RUNTIME_PACKAGE_NAMES,
    VM_CONTROL_KINDS,
} from '../../../src/app/core/constants.js';

describe('core/constants', () => {
    it('exports the expected UI and runtime defaults', () => {
        expect(DEFAULT_CANVAS_COLOR).toBe('#0d1117');
        expect(DEFAULT_LAYOUT_FIT).toBe('contain');
        expect(CLICK_THROUGH_POLL_INTERVAL_MS).toBe(42);
        expect(OPEN_FILE_POLL_INTERVAL_MS).toBe(900);
        expect(FALLBACK_RUNTIME_VERSION_OPTIONS).toEqual(['2.34.3', '2.34.2', '2.34.1', '2.34.0']);
    });

    it('defines the supported runtime and VM control kinds', () => {
        expect(RUNTIME_PACKAGE_NAMES).toEqual({
            canvas: '@rive-app/canvas',
            webgl2: '@rive-app/webgl2',
        });
        expect(LAYOUT_FITS).toContain('layout');
        expect(VM_CONTROL_KINDS.has('number')).toBe(true);
        expect(VM_CONTROL_KINDS.has('trigger')).toBe(true);
    });

    it('derives fallback runtime versions from the configured latest and minimum versions', () => {
        expect(buildFallbackRuntimeVersionOptions({
            latestVersion: '2.50.5',
            minimumVersion: '2.50.2',
            optionCount: 4,
        })).toEqual(['2.50.5', '2.50.4', '2.50.3', '2.50.2']);

        expect(buildFallbackRuntimeVersionOptions({
            latestVersion: '2.50.1',
            minimumVersion: '2.50.0',
            optionCount: 4,
        })).toEqual(['2.50.1', '2.50.0']);

        expect(buildFallbackRuntimeVersionOptions({
            latestVersion: 'invalid',
            minimumVersion: '2.50.0',
            optionCount: 4,
        })).toEqual(['invalid']);
    });
});
