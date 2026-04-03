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

        const code = generateWebInstantiationCode(descriptor, {
            packageSource: 'local',
            controlSnapshot: [
                {
                    descriptor: {
                        kind: 'enum',
                        name: 'chart-picker',
                        path: 'card-vm/chart-picker',
                        source: 'view-model',
                    },
                    enumValues: ['bar', 'line', 'area'],
                    kind: 'enum',
                    value: 'bar',
                },
                {
                    descriptor: {
                        kind: 'color',
                        name: 'accent-color',
                        path: 'card-vm/accent-color',
                        source: 'view-model',
                    },
                    kind: 'color',
                    value: 0xff336699,
                },
                {
                    descriptor: {
                        kind: 'trigger',
                        name: 'refresh',
                        path: 'card-vm/refresh',
                        source: 'view-model',
                    },
                    kind: 'trigger',
                    value: null,
                },
                {
                    descriptor: {
                        kind: 'number',
                        name: 'progress',
                        source: 'state-machine',
                        stateMachineName: 'main-sm',
                    },
                    kind: 'number',
                    value: 0.3333333333,
                },
            ],
        });
        expect(code).toContain('import * as rive from "@rive-app/webgl2";');
        expect(code).toContain('const ravRive = createRavWebController(() => riveInst);');
        expect(code).toContain('const userConfig = (');
        expect(code).toContain('...userConfig,');
        expect(code).toContain('ravRive.applySnapshot();');
        expect(code).toContain('stateMachines: "main-sm"');
        expect(code).toContain('canvas.style.background = "#112233";');
        expect(code).toContain('const VM_OVERRIDES = {');
        expect(code).toContain('"card-vm/chart-picker": "bar", // enum: bar | line | area');
        expect(code).toContain('"card-vm/accent-color": "#FF336699", // color (ARGB hex)');
        expect(code).toContain('const VM_STARTUP_TRIGGERS = [');
        expect(code).toContain('"card-vm/refresh", // trigger');
        expect(code).toContain('"main-sm": {');
        expect(code).toContain('"progress": 0.33, // number');
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
        expect(result.code).toContain('window.ravRive = ravRive;');
        expect(result.code).toContain('animations: "idle"');
        expect(result.code).toContain('canvas.style.background = "transparent";');
        expect(result.helperApi.global).toBe('window.ravRive');
        expect(result.helperApi.methods).toContain('window.ravRive.applyVmOverrides()');
        expect(result.helperApi.methods).toContain('window.ravRive.fireStartupTriggers()');
        expect(result.notes[1]).toContain('internal wiring');
    });
});
