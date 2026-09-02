import {
    buildEffectiveInstantiationDescriptor,
    generateWebInstantiationCode,
    resolveLivePlaybackSelection,
} from '../../../src/app/platform/export/web-instantiation.js';

function captureConfig(descriptor, packageSource = 'cdn', generationOptions = {}, instanceMembers = {}) {
    const code = generateWebInstantiationCode(descriptor, { packageSource, ...generationOptions });
    const script = code.match(/<script(?: type="module")?>([\s\S]*?)<\/script>/)[1]
        .replace(/^import \* as rive from [^;]+;/m, 'const rive = window.rive;');
    let config;
    const windowRef = {
        addEventListener() {},
        rive: {
            Rive: class {
                constructor(value) {
                    config = value;
                    Object.assign(this, instanceMembers);
                }
            },
            Layout: class { constructor(value) { Object.assign(this, value); } },
            Fit: { Contain: 'contain' }, Alignment: { Center: 'center' },
        },
    };
    const canvas = { style: {} };
    new Function('window', 'document', script)(windowRef, { getElementById: () => canvas });
    return { code, config, windowRef };
}

describe('generated snippet runtime compatibility', () => {
    it.each([
        ['cdn', '2.41.1', 'stateMachine'], ['local', '2.41.1', 'stateMachine'],
        ['cdn', '2.40.1', 'stateMachines'], ['local', '2.40.1', 'stateMachines'],
    ])('executes a %s snippet for %s with only %s', (packageSource, runtimeVersion, key) => {
        const descriptor = buildEffectiveInstantiationDescriptor({
            runtimeVersion, detectedStateMachines: ['main'],
        });
        const { config } = captureConfig(descriptor, packageSource);
        expect(config[key]).toBe('main');
        expect(config).not.toHaveProperty(key === 'stateMachine' ? 'stateMachines' : 'stateMachine');
        expect(config).not.toHaveProperty('animations');
        expect(config).not.toHaveProperty('onLoop');
        expect(config).not.toHaveProperty('onStateChange');
    });

    it('does not let a raw legacy editor config leak deprecated targets or invent callbacks', () => {
        const descriptor = buildEffectiveInstantiationDescriptor({
            runtimeVersion: '2.41.1', sourceMode: 'editor',
            editorCode: '({ stateMachines: "stale", animations: "idle" })',
            editorConfig: { stateMachines: 'stale', animations: 'idle' },
            artboardState: { currentPlaybackType: 'stateMachine', currentPlaybackName: 'selected' },
        });
        const { config } = captureConfig(descriptor);
        expect(config.stateMachine).toBe('selected');
        expect(config).not.toHaveProperty('stateMachines');
        expect(config).not.toHaveProperty('animations');
        expect(config).not.toHaveProperty('onLoop');
        expect(config).not.toHaveProperty('onStateChange');
    });

    it('continues forwarding explicitly supplied legacy callbacks', () => {
        const descriptor = buildEffectiveInstantiationDescriptor({
            runtimeVersion: '2.41.1', sourceMode: 'editor', detectedStateMachines: ['main'],
            editorCode: '({ onLoop: (event) => { window.loop = event; }, onStateChange: (event) => { window.state = event; } })',
        });
        const { config, windowRef } = captureConfig(descriptor);
        config.onLoop('loop');
        config.onStateChange('open');
        expect(windowRef.loop).toBe('loop');
        expect(windowRef.state).toBe('open');
    });

    it('accepts the modern editor spelling and preserves explicit legacy combinations', () => {
        expect(resolveLivePlaybackSelection({ editorConfig: { stateMachine: 'new', stateMachines: 'old', animations: 'idle' } }))
            .toEqual({ artboard: null, stateMachines: ['new'], animations: [] });
        const descriptor = buildEffectiveInstantiationDescriptor({
            runtimeVersion: '2.41.1', sourceMode: 'editor',
            editorConfig: { stateMachines: ['one', 'two'], animations: ['idle'] },
        });
        const { config } = captureConfig(descriptor);
        expect(config.stateMachines).toEqual(['one', 'two']);
        expect(config.animations).toBe('idle');
        expect(config).not.toHaveProperty('stateMachine');
    });

    it('exposes only selected typed accessors without replaying captured values', () => {
        const score = { value: 7 };
        const headline = { value: 'Live' };
        const progress = { name: 'progress', value: 0.25 };
        const ignored = { value: true };
        const descriptor = buildEffectiveInstantiationDescriptor({
            runtimeVersion: '2.41.1',
            detectedStateMachines: ['main-sm'],
        });
        const controlSnapshot = [
            {
                descriptor: { source: 'view-model', kind: 'number', name: 'score', path: 'score' },
                kind: 'number', value: 999,
            },
            {
                descriptor: {
                    source: 'global-view-model', globalViewModelName: 'Labels',
                    kind: 'string', name: 'headline', path: 'headline',
                },
                kind: 'string', value: 'Captured',
            },
            {
                descriptor: {
                    source: 'state-machine', stateMachineName: 'main-sm',
                    kind: 'number', name: 'progress', path: 'progress',
                },
                kind: 'number', value: 1,
            },
            {
                descriptor: { source: 'view-model', kind: 'boolean', name: 'ignored', path: 'ignored' },
                kind: 'boolean', value: false,
            },
        ];
        const { code, config, windowRef } = captureConfig(descriptor, 'cdn', {
            controlSnapshot,
            selectedControlKeys: [
                'vm:score:number',
                'gvm:Labels:headline:string',
                'sm:main-sm:progress:number',
            ],
        }, {
            resizeDrawingSurfaceToCanvas() {},
            viewModelInstance: {
                boolean: (path) => (path === 'ignored' ? ignored : null),
                number: (path) => (path === 'score' ? score : null),
            },
            globalViewModelInstance: (name) => (name === 'Labels'
                ? { string: (path) => (path === 'headline' ? headline : null) }
                : null),
            stateMachineInputs: (name) => (name === 'main-sm' ? [progress] : []),
        });

        config.onLoad();

        expect(windowRef.riveProperties).toEqual({
            'globalViewModel/Labels/headline': headline,
            'stateMachine/main-sm/progress': progress,
            'viewModel/score': score,
        });
        expect(score.value).toBe(7);
        expect(headline.value).toBe('Live');
        expect(progress.value).toBe(0.25);
        expect(ignored.value).toBe(true);
        expect(code).not.toContain('viewModel/ignored');
        expect(code).not.toContain('createRavWebController');
        expect(code).not.toContain('999');
        expect(new TextEncoder().encode(code).byteLength).toBeLessThan(4000);
    });
});
