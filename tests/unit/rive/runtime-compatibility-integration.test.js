import { createRiveInstanceController } from '../../../src/app/rive/instance-controller.js';
import { selectionAfterLoad } from '../../../src/app/rive/artboards/selection-state.js';

async function loadController({ config = {}, runtimeVersion = '2.41.1', authoritative = false } = {}) {
    document.body.innerHTML = '<div id="canvas-container"></div><div id="artboard-switcher"></div>';
    const instance = {
        cleanup: vi.fn(), on: vi.fn(), off: vi.fn(), pause: vi.fn(), reset: vi.fn(),
        resizeDrawingSurfaceToCanvas: vi.fn(), stateMachineNames: [],
    };
    const runtime = {
        EventType: { RiveEvent: 'rive-event' },
        Layout: class { constructor(props) { Object.assign(this, props); } },
        Rive: vi.fn(() => instance),
    };
    const detect = vi.fn(async () => null);
    const activateAuthoritativeSurface = vi.fn().mockResolvedValue(true);
    const controller = createRiveInstanceController({
        callbacks: {
            activateAuthoritativeSurface,
            ensureRuntime: async () => runtime,
            detectDefaultStateMachineName: detect,
        },
        elements: {
            canvasContainer: document.getElementById('canvas-container'),
            artboardSwitcher: document.getElementById('artboard-switcher'),
        },
        getCurrentRuntimeVersion: () => runtimeVersion,
        getEditorConfig: () => config,
        isAuthoritativeChildMode: () => authoritative,
        windowRef: window,
    });
    await controller.loadRiveAnimation('blob:compatibility', 'compatibility.riv');
    return {
        activateAuthoritativeSurface,
        controller,
        detect,
        instance,
        runtime,
        emittedConfig: runtime.Rive.mock.calls[0]?.[0],
    };
}

describe('main runtime compatibility integration', () => {
    it.each([
        ['2.41.1', { stateMachines: 'Main' }, { stateMachine: 'Main' }],
        ['2.41.1', { stateMachine: 'Main' }, { stateMachine: 'Main' }],
        ['2.41.0', { stateMachines: ['Main'] }, { stateMachine: 'Main' }],
        ['2.40.1', { stateMachine: 'Main' }, { stateMachines: 'Main' }],
        [null, { stateMachine: 'Main' }, { stateMachines: 'Main' }],
        ['2.41.1', { stateMachines: ['Main', 'Other'], animations: ['Intro', 'Loop'] },
            { stateMachines: ['Main', 'Other'], animations: ['Intro', 'Loop'] }],
    ])('normalizes constructor and reset playback for runtime %s without mutating caller config', async (runtimeVersion, config, expected) => {
        const original = structuredClone(config);
        const { controller, detect, instance, emittedConfig } = await loadController({ config, runtimeVersion });
        expect(emittedConfig).toMatchObject(expected);
        expect(emittedConfig).not.toHaveProperty(expected.stateMachine ? 'stateMachines' : 'stateMachine');
        expect(detect).not.toHaveBeenCalled();
        expect(controller.resetRiveInstance(config)).toBe(true);
        expect(instance.reset).toHaveBeenCalledWith(expected);
        expect(config).toEqual(original);
    });

    it('allows a playback override to replace either editor SM alias, and preserves explicit multi-target overrides', async () => {
        const { controller, runtime } = await loadController({ config: { stateMachine: 'Old' } });
        await controller.loadRiveAnimation('blob:next', 'next.riv', {
            configOverrides: { stateMachines: ['New', 'Other'], animations: ['Intro'] },
        });
        expect(runtime.Rive.mock.calls[1][0]).toMatchObject({ stateMachines: ['New', 'Other'], animations: ['Intro'] });
        expect(runtime.Rive.mock.calls[1][0]).not.toHaveProperty('stateMachine');
        await controller.loadRiveAnimation('blob:timeline', 'timeline.riv', { configOverrides: { animations: 'Timeline' } });
        expect(runtime.Rive.mock.calls[2][0]).toMatchObject({ animations: 'Timeline' });
        expect(runtime.Rive.mock.calls[2][0]).not.toHaveProperty('stateMachine');
        expect(runtime.Rive.mock.calls[2][0]).not.toHaveProperty('stateMachines');
    });

    it.each([
        [{ stateMachine: 'Main' }, false, true],
        [{ animations: 'Intro' }, true, false],
        [{}, true, true],
        [{ stateMachines: ['Main'], animations: ['Intro'] }, true, true],
    ])('keeps only applicable automatic deprecated diagnostics for %j', async (config, loop, stateChange) => {
        const { emittedConfig, instance } = await loadController({ config });
        expect(typeof emittedConfig.onLoop === 'function').toBe(loop);
        expect(typeof emittedConfig.onStateChange === 'function').toBe(stateChange);
        expect(instance.on).toHaveBeenCalledWith('rive-event', expect.any(Function));
    });

    it('preserves explicit user callbacks even when they do not match the selected playback mode', async () => {
        const onLoop = vi.fn();
        const onStateChange = vi.fn();
        const machine = await loadController({ config: { stateMachine: 'Main', onLoop } });
        machine.emittedConfig.onLoop('loop');
        expect(onLoop).toHaveBeenCalledWith('loop');
        const animation = await loadController({ config: { animations: 'Intro', onStateChange } });
        animation.emittedConfig.onStateChange('state');
        expect(onStateChange).toHaveBeenCalledWith('state');
    });

    it('constructs only the authoritative child and no paused parent runtime', async () => {
        const { activateAuthoritativeSurface, controller, runtime } = await loadController({
            authoritative: true,
            config: { stateMachine: 'Main', onLoop: vi.fn(), onStateChange: vi.fn() },
        });
        expect(runtime.Rive).not.toHaveBeenCalled();
        expect(controller.getRiveInstance()).toBeNull();
        expect(activateAuthoritativeSurface).toHaveBeenCalledWith({ autoplay: true });
        expect(controller.resetRiveInstance({ stateMachine: 'Main', autoplay: true })).toBe(false);
    });

    it('does not construct a parent for lowercase callbacks and still normalizes them in browser mode', async () => {
        const onloop = vi.fn();
        const onstatechange = vi.fn();
        const parent = await loadController({ authoritative: true, config: { stateMachine: 'Main', onloop, onstatechange } });
        expect(parent.runtime.Rive).not.toHaveBeenCalled();
        expect(parent.emittedConfig).toBeUndefined();
        const active = await loadController({ config: { stateMachine: 'Main', onloop, onstatechange } });
        active.emittedConfig.onLoop('loop');
        active.emittedConfig.onStateChange('open');
        expect(onloop).toHaveBeenCalledExactlyOnceWith('loop');
        expect(onstatechange).toHaveBeenCalledExactlyOnceWith('open');
        expect(active.emittedConfig).not.toHaveProperty('onloop');
        expect(active.emittedConfig).not.toHaveProperty('onstatechange');
    });

    it('retains singular editor selections when loaded runtime playback lists are empty', () => {
        expect(selectionAfterLoad({ artboard: { name: 'Main' } }, { stateMachine: 'Primary' })).toMatchObject({
            artboardName: 'Main', playbackName: 'Primary', playbackType: 'stateMachine',
        });
    });
});
