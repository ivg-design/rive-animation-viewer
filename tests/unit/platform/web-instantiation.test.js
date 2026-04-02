import {
    buildEffectiveInstantiationDescriptor,
    buildWebInstantiationResult,
    generateWebInstantiationCode,
    normalizeAnimationSelection,
    resolveLivePlaybackSelection,
} from '../../../src/app/platform/web-instantiation.js';

describe('platform/web-instantiation', () => {
    it('normalizes animation/state selections and resolves the live playback target', () => {
        expect(normalizeAnimationSelection('idle')).toEqual(['idle']);
        expect(normalizeAnimationSelection(['idle', '', 12])).toEqual(['idle']);

        expect(resolveLivePlaybackSelection({
            artboardState: {
                currentArtboard: 'Portrait',
                currentPlaybackName: 'main-sm',
                currentPlaybackType: 'stateMachine',
            },
            editorConfig: {
                animations: 'idle',
                stateMachines: 'fallback-sm',
            },
            detectedStateMachines: ['detected-sm'],
        })).toEqual({
            animations: [],
            artboard: 'Portrait',
            stateMachines: ['main-sm'],
        });
    });

    it('builds an effective descriptor and generates local/editor snippets', () => {
        const descriptor = buildEffectiveInstantiationDescriptor({
            artboardState: {
                currentArtboard: 'Portrait',
                currentPlaybackName: 'main-sm',
                currentPlaybackType: 'stateMachine',
            },
            currentFileName: 'demo.riv',
            currentLayoutAlignment: 'topLeft',
            currentLayoutFit: 'cover',
            editorCode: `({
  autoplay: false,
  onPlay: () => console.log("play"),
})`,
            editorConfig: {
                autoplay: false,
                onPlay: () => {},
            },
            runtimeName: 'webgl2',
            runtimeVersion: '2.34.3',
            sourceMode: 'editor',
            transparencyState: {
                canvasColor: '#112233',
                canvasTransparent: false,
            },
        });

        expect(descriptor).toEqual(expect.objectContaining({
            artboard: 'Portrait',
            autoplay: false,
            layoutAlignment: 'topLeft',
            layoutFit: 'cover',
            runtimePackageName: '@rive-app/webgl2',
            sourceMode: 'editor',
            stateMachines: ['main-sm'],
        }));

        const code = generateWebInstantiationCode(descriptor, { packageSource: 'local' });
        expect(code).toContain('import * as rive from "@rive-app/webgl2";');
        expect(code).toContain('const userConfig = (');
        expect(code).toContain('...userConfig,');
        expect(code).toContain('stateMachines: "main-sm"');
        expect(code).toContain('canvas.style.background = "#112233";');
    });

    it('generates CDN/internal snippets and returns metadata', () => {
        const descriptor = buildEffectiveInstantiationDescriptor({
            artboardState: {
                currentArtboard: 'Main',
                currentPlaybackName: 'idle',
                currentPlaybackType: 'animation',
            },
            currentFileName: 'monthly_reports.riv',
            currentLayoutAlignment: 'center',
            currentLayoutFit: 'contain',
            runtimeName: 'canvas',
            runtimeVersion: '2.35.0',
            sourceMode: 'internal',
            transparencyState: {
                canvasColor: '#000000',
                canvasTransparent: true,
            },
        });
        const result = buildWebInstantiationResult(descriptor, { packageSource: 'cdn' });

        expect(result.packageSource).toBe('cdn');
        expect(result.sourceMode).toBe('internal');
        expect(result.code).toContain('<script src="https://unpkg.com/@rive-app/canvas@2.35.0"></script>');
        expect(result.code).toContain('animations: "idle"');
        expect(result.code).toContain('canvas.style.background = "transparent";');
        expect(result.notes[1]).toContain('internal wiring');
    });
});
