import { setInspectionMetadata } from '../../../src/app/rive/runtime-compatibility.js';
import { createRiveInstanceController } from '../../../src/app/rive/instance-controller.js';
import { selectionAfterLoad } from '../../../src/app/rive/artboards/selection-state.js';
import { buildStateMachineHierarchy } from '../../../src/app/rive/view-model/hierarchy.js';
import { createVmControlAccessorResolver } from '../../../src/app/rive/view-model/controller/accessor-resolver.js';

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
    const controller = createRiveInstanceController({
        callbacks: { ensureRuntime: async () => runtime, detectDefaultStateMachineName: detect },
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
    return { controller, detect, instance, runtime, emittedConfig: runtime.Rive.mock.calls[0][0] };
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

    it('does not subscribe unused deprecated hooks on the authoritative paused parent', async () => {
        const { controller, emittedConfig, instance } = await loadController({
            authoritative: true,
            config: { stateMachine: 'Main', onLoop: vi.fn(), onStateChange: vi.fn() },
        });
        expect(emittedConfig.autoplay).toBe(false);
        expect(emittedConfig).not.toHaveProperty('onLoop');
        expect(emittedConfig).not.toHaveProperty('onStateChange');
        expect(instance.on).not.toHaveBeenCalled();
        controller.resetRiveInstance({ stateMachine: 'Main', autoplay: true });
        expect(instance.reset).toHaveBeenCalledWith({ stateMachine: 'Main', autoplay: false });
    });

    it('does not leak lowercase legacy callbacks into the hidden parent', async () => {
        const onloop = vi.fn();
        const onstatechange = vi.fn();
        const parent = await loadController({ authoritative: true, config: { stateMachine: 'Main', onloop, onstatechange } });
        for (const key of ['onLoop', 'onStateChange', 'onloop', 'onstatechange']) {
            expect(parent.emittedConfig).not.toHaveProperty(key);
        }
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

describe('known-empty legacy input metadata', () => {
    function fixture(metadata) {
        const trigger = { name: 'fire', fire: vi.fn() };
        const inputs = [{ name: 'active', value: true }, trigger];
        const instance = {
            artboard: { name: 'Main' },
            activeArtboard: 'Main',
            stateMachineNames: ['Machine'],
            stateMachineInputs: vi.fn(() => inputs),
            // Presence of a VM is deliberately not a reason to hide SM inputs.
            viewModelInstance: { name: 'ModernVM' },
            ...(metadata === undefined ? {} : { contents: { artboards: [{
                name: 'Main', stateMachines: [{ name: 'Machine', inputs: metadata }],
            }] } }),
        };
        setInspectionMetadata(instance, instance.contents);
        const resolver = createVmControlAccessorResolver({
            getCurrentRuntime: () => 'webgl2', getLoadedRuntime: () => ({}), getRiveInstance: () => instance,
            isAuthoritativeChildMode: false,
        });
        return { instance, resolver, trigger };
    }

    it('does not probe an explicitly empty SM for hierarchy, accessor, or trigger lookup', () => {
        const { instance, resolver } = fixture([]);
        expect(buildStateMachineHierarchy(instance, {})).toBeNull();
        expect(resolver.resolveStateMachineInputAccessor('Machine', 'active', 'boolean')).toBeNull();
        expect(resolver.fireStateMachineTriggerByName('fire')).toBe(0);
        expect(instance.stateMachineInputs).not.toHaveBeenCalled();
    });

    it.each([undefined, [{ name: 'active', type: 59 }]])('preserves mixed-file input access with nonempty or unknown metadata %j', (metadata) => {
        const { instance, resolver, trigger } = fixture(metadata);
        expect(buildStateMachineHierarchy(instance, {}).totalInputs).toBe(2);
        expect(resolver.resolveStateMachineInputAccessor('Machine', 'active', 'boolean').value).toBe(true);
        expect(resolver.fireStateMachineTriggerByName('fire')).toBe(1);
        expect(trigger.fire).toHaveBeenCalledOnce();
        expect(instance.stateMachineInputs).toHaveBeenCalledTimes(3);
    });
});
