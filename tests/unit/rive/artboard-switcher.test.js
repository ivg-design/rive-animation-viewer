import {
    createArtboardSwitcherController,
    parsePlaybackTarget,
} from '../../../src/app/rive/artboard-switcher.js';
import { AUTO_BOUND_VM_INSTANCE_KEY } from '../../../src/app/rive/view-model/instances.js';
import { RAV_PLAYBACK_COMMAND_EVENT } from '../../../src/app/rive/control-events.js';
import { createDemoExportController } from '../../../src/app/platform/export/demo-export.js';

function createElements() {
    const artboardSwitcher = document.createElement('div');
    const artboardSelect = document.createElement('select');
    const playbackSelect = document.createElement('select');
    const vmInstanceRow = document.createElement('div');
    const vmInstanceSelect = document.createElement('select');
    const artboardResetBtn = document.createElement('button');
    const artboardSwitcherCount = document.createElement('span');

    document.body.append(
        artboardSwitcher,
        artboardSelect,
        playbackSelect,
        vmInstanceRow,
        vmInstanceSelect,
        artboardResetBtn,
        artboardSwitcherCount,
    );

    return {
        artboardResetBtn,
        artboardSelect,
        artboardSwitcher,
        artboardSwitcherCount,
        playbackSelect,
        vmInstanceRow,
        vmInstanceSelect,
    };
}

function createHarness(overrides = {}) {
    let currentFileUrl = overrides.currentFileUrl ?? 'blob:demo';
    let currentFileName = overrides.currentFileName ?? 'demo.riv';
    let riveInstance = overrides.riveInstance ?? null;

    const callbacks = {
        initLucideIcons: vi.fn(),
        loadRiveAnimation: vi.fn(async (_url, _name, options) => {
            options?.beforeUserOnLoad?.();
            options?.onLoaded?.();
        }),
        logEvent: vi.fn(),
        resetRiveInstance: vi.fn(() => false),
        renderVmInputControls: vi.fn(),
        showError: vi.fn(),
        updateInfo: vi.fn(),
        ...overrides.callbacks,
    };

    const controller = createArtboardSwitcherController({
        callbacks,
        elements: overrides.elements ?? createElements(),
        getCurrentFileName: () => currentFileName,
        getCurrentFileUrl: () => currentFileUrl,
        getRiveInstance: () => riveInstance,
        isAuthoritativeChildMode: overrides.isAuthoritativeChildMode ?? (() => false),
        setTimeoutFn: overrides.setTimeoutFn ?? ((callback) => {
            callback();
            return 1;
        }),
    });

    return {
        callbacks,
        controller,
        setCurrentFile(url, name) {
            currentFileUrl = url;
            currentFileName = name;
        },
        setRiveInstance(nextInstance) {
            riveInstance = nextInstance;
        },
    };
}

describe('rive/artboard-switcher', () => {
    it('parses playback targets consistently', () => {
        expect(parsePlaybackTarget(null)).toEqual({ type: null, name: null });
        expect(parsePlaybackTarget('sm:Main')).toEqual({ type: 'stateMachine', name: 'Main' });
        expect(parsePlaybackTarget('anim:Bounce')).toEqual({ type: 'animation', name: 'Bounce' });
        expect(parsePlaybackTarget('LegacyDefault')).toEqual({ type: 'stateMachine', name: 'LegacyDefault' });
    });

    it('populates artboard and playback controls from the current rive instance', () => {
        const elements = createElements();
        const harness = createHarness({ elements });
        harness.controller.syncStateFromConfig({
            artboard: 'Second',
            configuredStateMachines: ['Main'],
        });
        harness.setRiveInstance({
            contents: {
                artboards: [
                    {
                        name: 'First',
                        animations: ['Idle'],
                        stateMachines: ['Boot'],
                    },
                    {
                        name: 'Second',
                        animations: ['Bounce'],
                        stateMachines: ['Main'],
                    },
                ],
            },
            defaultViewModel() {
                return {
                    instanceCount: 1,
                };
            },
            viewModelInstance: null,
        });

        harness.controller.populateArtboardSwitcher();
        const state = harness.controller.getStateSnapshot();

        expect(Array.from(harness.controller.getStateSnapshot().contents.artboards)).toHaveLength(2);
        expect(harness.controller.getStateSnapshot().defaultArtboard).toBe('Second');
        expect(harness.controller.getStateSnapshot().defaultPlaybackKey).toBe('sm:Main');
        expect(harness.controller.getStateSnapshot().currentPlaybackType).toBe('stateMachine');
        expect(harness.controller.getStateSnapshot().currentPlaybackName).toBe('Main');
        expect(Array.from(elements.playbackSelect.options).map((option) => option.textContent)).toEqual([
            'Main',
            'Bounce',
        ]);
        expect(state.contents.artboards[1].name).toBe('Second');
    });

    it('keeps the completed canonical timeline selected instead of blanking the Playback select', () => {
        const elements = createElements();
        const harness = createHarness({
            elements,
            isAuthoritativeChildMode: () => true,
        });
        harness.setRiveInstance({
            contents: {
                artboards: [{
                    animations: ['Focus Fullscreen Mode'],
                    name: 'TrackMap',
                    stateMachines: ['TrackMapSM'],
                }],
            },
            defaultViewModel: () => ({ instanceCount: 0 }),
            viewModelInstance: null,
        });
        harness.controller.syncStateFromConfig({ artboard: 'TrackMap', configuredStateMachines: ['TrackMapSM'] });
        harness.controller.populateArtboardSwitcher();

        harness.controller.syncStateFromCanonical({
            artboard: 'TrackMap',
            playback: {
                currentFrame: 60,
                currentSeconds: 1,
                name: 'Focus Fullscreen Mode',
                totalFrames: 60,
                totalSeconds: 1,
                type: 'animation',
            },
            vmInstance: { key: null },
        });

        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentPlaybackName: 'Focus Fullscreen Mode',
            currentPlaybackType: 'animation',
        });
        expect(elements.playbackSelect.value).toBe('anim:Focus Fullscreen Mode');
    });

    it('resets DEFAULT in place and keeps the render-surface session alive', () => {
        const elements = createElements();
        const resetRiveInstance = vi.fn(() => true);
        const harness = createHarness({
            callbacks: { resetRiveInstance },
            elements,
        });
        harness.setRiveInstance({
            artboard: { name: 'First' },
            contents: {
                artboards: [
                    { animations: ['Idle'], name: 'First', stateMachines: ['Boot'] },
                    { animations: ['Bounce'], name: 'Second', stateMachines: ['Main'] },
                ],
            },
            defaultViewModel: () => ({ instanceCount: 0 }),
            viewModelInstance: null,
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        harness.controller.syncStateFromConfig({ artboard: 'Second', configuredStateMachines: ['Main'] });
        const playbackCommands = [];
        document.addEventListener(
            RAV_PLAYBACK_COMMAND_EVENT,
            (event) => playbackCommands.push(event.detail),
            { once: true },
        );

        harness.controller.resetToDefaultArtboard();

        expect(resetRiveInstance).toHaveBeenCalledWith({
            animations: undefined,
            artboard: 'First',
            autoBind: true,
            autoplay: true,
            stateMachines: 'Boot',
            viewModelInstanceName: null,
        });
        expect(harness.callbacks.loadRiveAnimation).not.toHaveBeenCalled();
        expect(playbackCommands.at(-1)).toEqual({
            command: 'reset',
            payload: {
                params: expect.objectContaining({ artboard: 'First', stateMachines: 'Boot' }),
                snapshot: [],
            },
        });
        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'First',
            currentPlaybackName: 'Boot',
            currentPlaybackType: 'stateMachine',
        });
    });

    it.each([
        ['named', 'Board'],
        ['runtime list index', 0],
    ])('returns to the target artboard auto-bound instance when DEFAULT crosses artboards from a %s instance', async (_label, instanceKey) => {
        const elements = createElements();
        const harness = createHarness({
            elements,
            isAuthoritativeChildMode: () => true,
        });
        harness.setRiveInstance({
            artboard: { name: 'First' },
            contents: {
                artboards: [
                    { animations: ['Idle'], name: 'First', stateMachines: ['Boot'] },
                    { animations: ['Bounce'], name: 'Second', stateMachines: ['Main'] },
                ],
            },
            defaultViewModel: () => ({ instanceCount: 0 }),
            viewModelInstance: null,
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        harness.controller.syncStateFromCanonical({
            artboard: 'Second',
            playback: { name: 'Main', type: 'stateMachine' },
            vmInstance: { key: instanceKey },
        });

        await harness.controller.resetToDefaultArtboard();

        expect(harness.callbacks.loadRiveAnimation).toHaveBeenCalledWith(
            'blob:demo',
            'demo.riv',
            expect.objectContaining({
                configOverrides: {
                    artboard: 'First',
                    autoBind: true,
                    autoplay: true,
                    stateMachines: 'Boot',
                },
            }),
        );
        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'First',
            currentPlaybackName: 'Boot',
            currentPlaybackType: 'stateMachine',
            currentVmInstanceName: null,
        });
    });

    it.each([
        ['named', 'Board'],
        ['runtime list index', 0],
    ])('retains the %s ViewModel instance when DEFAULT stays on the same artboard', async (_label, instanceKey) => {
        const harness = createHarness({ isAuthoritativeChildMode: () => true });
        harness.setRiveInstance({
            artboard: { name: 'First' },
            contents: {
                artboards: [{ animations: ['Idle'], name: 'First', stateMachines: ['Boot'] }],
            },
            defaultViewModel: () => ({ instanceCount: 0 }),
            viewModelInstance: null,
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        harness.controller.syncStateFromCanonical({
            artboard: 'First',
            playback: { name: 'Boot', type: 'stateMachine' },
            vmInstance: { key: instanceKey },
        });

        await harness.controller.resetToDefaultArtboard();

        expect(harness.callbacks.loadRiveAnimation).toHaveBeenCalledWith(
            'blob:demo',
            'demo.riv',
            expect.objectContaining({
                configOverrides: {
                    artboard: 'First',
                    autoBind: false,
                    autoplay: true,
                    stateMachines: 'Boot',
                },
            }),
        );
        expect(harness.controller.getStateSnapshot().currentVmInstanceName).toBe(instanceKey);
    });

    it.each([
        ['named', 'Board'],
        ['runtime list index zero', 0],
    ])('scopes an implicit %s ViewModel instance to its artboard', async (_label, instanceKey) => {
        const loads = [];
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                    loads.push(options);
                    options?.onLoaded?.();
                }),
            },
            isAuthoritativeChildMode: () => true,
        });
        harness.controller.syncStateFromCanonical({
            artboard: 'First',
            playback: { name: 'Boot', type: 'stateMachine' },
            vmInstance: { key: instanceKey },
        });

        await harness.controller.switchArtboard('Second', 'anim:Bounce');
        await harness.controller.switchArtboard('Second', 'sm:Main');

        expect(loads).toHaveLength(2);
        expect(loads[0].configOverrides).toMatchObject({
            artboard: 'Second',
            autoBind: true,
            animations: 'Bounce',
        });
        expect(loads[1].configOverrides).toMatchObject({
            artboard: 'Second',
            autoBind: true,
            stateMachines: 'Main',
        });
        expect(harness.controller.getStateSnapshot().currentVmInstanceName).toBeNull();
    });

    it.each([
        ['named', 'Board'],
        ['runtime list index zero', 0],
    ])('retains an explicit %s ViewModel instance across playback changes on one artboard', async (_label, instanceKey) => {
        const loads = [];
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                    loads.push(options);
                    options?.onLoaded?.();
                }),
            },
            isAuthoritativeChildMode: () => true,
        });
        harness.controller.syncStateFromCanonical({
            artboard: 'Second',
            playback: { name: 'Bounce', type: 'animation' },
            vmInstance: { key: instanceKey },
        });

        await harness.controller.switchArtboard('Second', 'sm:Main');

        expect(loads[0].configOverrides).toMatchObject({
            artboard: 'Second',
            autoBind: false,
            stateMachines: 'Main',
        });
        expect(harness.controller.getStateSnapshot().currentVmInstanceName).toBe(instanceKey);
    });

    it('honors an explicit Auto override on an artboard change', async () => {
        const loads = [];
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                    loads.push(options);
                    options?.onLoaded?.();
                }),
            },
            isAuthoritativeChildMode: () => true,
        });
        harness.controller.syncStateFromCanonical({
            artboard: 'First',
            playback: { name: 'Boot', type: 'stateMachine' },
            vmInstance: { key: 'Board' },
        });

        await harness.controller.switchArtboard('Second', 'sm:Main', { viewModelInstanceKey: null });

        expect(loads[0].configOverrides).toMatchObject({
            artboard: 'Second',
            autoBind: true,
            stateMachines: 'Main',
        });
        expect(loads[0].configOverrides).not.toHaveProperty('viewModelInstanceName');
        expect(harness.controller.getStateSnapshot().currentVmInstanceName).toBeNull();
    });

    it.each([
        ['named target instance', 'Target'],
        ['runtime-list target index zero', 0],
    ])('honors an explicit cross-artboard %s override', async (_label, instanceKey) => {
        const loads = [];
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                    loads.push(options);
                    options?.onLoaded?.();
                }),
            },
            isAuthoritativeChildMode: () => true,
        });
        harness.controller.syncStateFromCanonical({
            artboard: 'First',
            playback: { name: 'Boot', type: 'stateMachine' },
            vmInstance: { key: 'Source' },
        });

        await harness.controller.switchArtboard('Second', 'sm:Main', {
            viewModelInstanceKey: instanceKey,
        });

        expect(loads[0].configOverrides).toMatchObject({
            artboard: 'Second',
            autoBind: false,
            stateMachines: 'Main',
        });
        expect(harness.controller.getStateSnapshot().currentVmInstanceName).toBe(instanceKey);
    });

    it('switches artboards by reloading with runtime overrides', async () => {
        const callbacks = {
            loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                options?.onLoaded?.();
            }),
        };
        const harness = createHarness({ callbacks });
        const elements = createElements();
        const controller = createArtboardSwitcherController({
            callbacks: {
                ...harness.callbacks,
                ...callbacks,
            },
            elements,
            getCurrentFileName: () => 'demo.riv',
            getCurrentFileUrl: () => 'blob:demo',
            getRiveInstance: () => null,
            setTimeoutFn: (callback) => {
                callback();
                return 1;
            },
        });

        await controller.switchArtboard('Menu', 'anim:Bounce');

        expect(callbacks.loadRiveAnimation).toHaveBeenCalledWith(
            'blob:demo',
            'demo.riv',
            expect.objectContaining({
                configOverrides: {
                    animations: 'Bounce',
                    artboard: 'Menu',
                    autoBind: true,
                    autoplay: true,
                },
                forceAutoplay: true,
            }),
        );
        expect(controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'Menu',
            currentPlaybackName: 'Bounce',
            currentPlaybackType: 'animation',
        });
    });

    it('reconciles active playback without replacing the runtime auto-bound ViewModel instance', () => {
        const elements = createElements();
        const harness = createHarness({ elements });
        const board = { name: 'Board' };
        const bindViewModelInstance = vi.fn();
        const instance = {
            artboard: { name: 'Leaderboard' },
            bindViewModelInstance,
            defaultViewModel: () => ({
                instanceByName: (name) => (name === 'Board' ? board : null),
                instanceCount: 1,
                instanceNames: ['Board'],
                name: 'LeaderboardVM',
            }),
            playingAnimationNames: [],
            playingStateMachineNames: ['State Machine 1'],
            viewModelInstance: { name: null },
        };
        harness.setRiveInstance(instance);

        harness.controller.syncStateAfterLoad(instance, { stateMachines: ['Configured but inactive'] });

        expect(bindViewModelInstance).not.toHaveBeenCalled();
        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'Leaderboard',
            currentPlaybackName: 'State Machine 1',
            currentPlaybackType: 'stateMachine',
            currentVmInstanceName: null,
        });

        instance.playingStateMachineNames = [];
        instance.playingAnimationNames = ['Actually playing'];
        harness.controller.syncStateAfterLoad(instance, { stateMachines: ['Configured but inactive'] });
        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentPlaybackName: 'Actually playing',
            currentPlaybackType: 'animation',
        });

        instance.playingAnimationNames = [];
        harness.controller.syncStateAfterLoad(instance, {});
        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentPlaybackName: null,
            currentPlaybackType: null,
        });
    });

    it('reloads with autoBind disabled before switching ViewModel instances', async () => {
        const elements = createElements();
        const harness = createHarness({ elements });
        const bindViewModelInstance = vi.fn();
        const viewModelDefinition = {
            instanceByIndex: vi.fn((index) => ({ index })),
            instanceByName: vi.fn((name) => (name === 'Inspector' ? { name } : null)),
            instanceCount: 2,
            instanceNames: ['Inspector', 'Preview'],
            name: 'Panel VM',
        };
        harness.setRiveInstance({
            bindViewModelInstance,
            defaultViewModel: () => viewModelDefinition,
            viewModelInstance: { name: 'Preview' },
        });

        harness.controller.populateVmInstanceSelect();
        expect(elements.vmInstanceRow.hidden).toBe(false);
        expect(Array.from(elements.vmInstanceSelect.options).map((option) => option.value)).toEqual([
            AUTO_BOUND_VM_INSTANCE_KEY,
            'Inspector',
            'Preview',
        ]);
        expect(elements.vmInstanceSelect.value).toBe(AUTO_BOUND_VM_INSTANCE_KEY);

        await harness.controller.switchVmInstance('Inspector');
        expect(harness.callbacks.loadRiveAnimation).toHaveBeenCalledWith(
            'blob:demo',
            'demo.riv',
            expect.objectContaining({
                beforeUserOnLoad: expect.any(Function),
                configOverrides: expect.objectContaining({
                    autoBind: false,
                    autoplay: true,
                }),
                forceAutoplay: true,
            }),
        );
        expect(bindViewModelInstance).toHaveBeenCalledWith({ name: 'Inspector' });
        expect(harness.controller.getStateSnapshot().currentVmInstanceName).toBe('Inspector');

        harness.controller.resetForNewFile();
        expect(harness.controller.getStateSnapshot()).toMatchObject({
            contents: null,
            currentArtboard: null,
            currentPlaybackName: null,
            currentPlaybackType: null,
            defaultArtboard: null,
            defaultPlaybackKey: null,
        });
    });

    it('keeps a single default view model instance populated and visible', () => {
        const elements = createElements();
        const harness = createHarness({ elements });
        harness.setRiveInstance({
            defaultViewModel: () => ({
                instanceCount: 1,
                instanceNames: ['Board'],
                name: 'LeaderboardVM',
            }),
            viewModelInstance: { name: 'Board' },
        });

        harness.controller.populateVmInstanceSelect();

        expect(elements.vmInstanceRow.hidden).toBe(false);
        expect(Array.from(elements.vmInstanceSelect.options).map((option) => ({
            label: option.textContent,
            value: option.value,
        }))).toEqual([
            { label: 'Board (auto)', value: AUTO_BOUND_VM_INSTANCE_KEY },
            { label: 'Board', value: 'Board' },
        ]);
        expect(elements.vmInstanceSelect.value).toBe(AUTO_BOUND_VM_INSTANCE_KEY);
        expect(harness.controller.getStateSnapshot().currentVmInstanceName).toBeNull();
    });

    it('uses index zero for an explicitly empty authored instance name', () => {
        const elements = createElements();
        const harness = createHarness({ elements });
        harness.setRiveInstance({
            defaultViewModel: () => ({
                instanceCount: 1,
                instanceNames: [''],
                name: 'AnonymousVM',
            }),
            viewModelInstance: { name: null },
        });

        harness.controller.populateVmInstanceSelect();

        expect(elements.vmInstanceRow.hidden).toBe(false);
        expect(Array.from(elements.vmInstanceSelect.options).map((option) => ({
            label: option.textContent,
            value: option.value,
        }))).toEqual([
            { label: 'Instance 1 (auto)', value: AUTO_BOUND_VM_INSTANCE_KEY },
            { label: 'Instance 1', value: '0' },
        ]);
    });

    it('preserves named instances while using index fallback for empty entries', () => {
        const elements = createElements();
        const harness = createHarness({ elements });
        harness.setRiveInstance({
            defaultViewModel: () => ({
                instanceCount: 3,
                instanceNames: ['Primary', '', '  Preview  '],
                name: 'MixedVM',
            }),
            viewModelInstance: { name: 'Primary' },
        });

        harness.controller.populateVmInstanceSelect();

        expect(Array.from(elements.vmInstanceSelect.options).map((option) => ({
            label: option.textContent,
            value: option.value,
        }))).toEqual([
            { label: 'Default instance (auto)', value: AUTO_BOUND_VM_INSTANCE_KEY },
            { label: 'Primary', value: 'Primary' },
            { label: 'Instance 2', value: '1' },
            { label: 'Preview', value: 'Preview' },
        ]);
    });

    it('hides the switcher when instance data is unavailable and resets with an error when no default exists', () => {
        const elements = createElements();
        const harness = createHarness({ elements, riveInstance: null });

        harness.controller.populateArtboardSwitcher();
        expect(elements.artboardSwitcher.hidden).toBe(true);

        harness.controller.resetToDefaultArtboard();
        expect(harness.callbacks.showError).toHaveBeenCalledWith('No default artboard. Reload the file.');
    });

    it('reverts switch state on load failure and supports numeric VM instance fallback', async () => {
        const showError = vi.fn();
        const loadRiveAnimation = vi.fn(async (_url, _name, options) => {
            options?.beforeUserOnLoad?.();
            options?.onLoaded?.();
        });
        loadRiveAnimation.mockImplementationOnce(async (_url, _name, options) => {
            options?.onLoadError?.(new Error('switch failed'));
        });
        const callbacks = {
            loadRiveAnimation,
        };
        const bindViewModelInstance = vi.fn();
        const elements = createElements();
        const controller = createArtboardSwitcherController({
            callbacks: {
                ...callbacks,
                initLucideIcons: vi.fn(),
                logEvent: vi.fn(),
                renderVmInputControls: vi.fn(),
                showError,
                updateInfo: vi.fn(),
            },
            elements,
            getCurrentFileName: () => 'demo.riv',
            getCurrentFileUrl: () => 'blob:demo',
            getRiveInstance: () => ({
                bindViewModelInstance,
                defaultViewModel: () => ({
                    instanceByIndex: vi.fn((index) => ({ index })),
                    instanceCount: 2,
                    instanceNames: ['', ''],
                    name: 'VM',
                }),
                viewModelInstance: null,
            }),
            setTimeoutFn: (callback) => {
                callback();
                return 1;
            },
        });

        controller.syncStateFromConfig({
            artboard: 'Original',
            configuredStateMachines: ['Boot'],
        });
        await controller.switchArtboard('Broken', 'sm:BrokenSM');
        expect(controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'Original',
            currentPlaybackName: 'Boot',
            currentPlaybackType: 'stateMachine',
        });
        expect(callbacks.loadRiveAnimation).toHaveBeenCalledWith(
            'blob:demo',
            'demo.riv',
            expect.objectContaining({
                configOverrides: expect.objectContaining({
                    artboard: 'Broken',
                    autoplay: true,
                    autoBind: true,
                    stateMachines: 'BrokenSM',
                }),
                forceAutoplay: true,
            }),
        );

        controller.populateVmInstanceSelect();
        expect(Array.from(elements.vmInstanceSelect.options).map((option) => option.value)).toEqual([
            AUTO_BOUND_VM_INSTANCE_KEY,
            '0',
            '1',
        ]);
        await controller.switchVmInstance(0);
        expect(controller.getStateSnapshot().currentVmInstanceName).toBe(0);
        expect(loadRiveAnimation).toHaveBeenLastCalledWith(
            'blob:demo',
            'demo.riv',
            expect.objectContaining({
                configOverrides: expect.objectContaining({
                    autoBind: false,
                }),
            }),
        );
        expect(bindViewModelInstance).toHaveBeenCalledWith({ index: 0 });
        await controller.switchVmInstance('missing');
        expect(showError).toHaveBeenCalledWith(
            'Failed to switch ViewModel instance: ViewModel instance "missing" is unavailable.',
        );
    });

    it('reconciles the controls from active child canonical state', () => {
        const elements = createElements();
        const harness = createHarness({
            elements,
            isAuthoritativeChildMode: () => true,
            riveInstance: {
                contents: {
                    artboards: [
                        { animations: ['Idle'], name: 'First', stateMachines: ['Boot'] },
                        { animations: ['Bounce'], name: 'Second', stateMachines: ['Main'] },
                    ],
                },
                defaultViewModel: () => ({
                    instanceCount: 2,
                    instanceNames: ['Inspector', 'Preview'],
                }),
            },
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        harness.controller.setupArtboardSwitcher();

        document.dispatchEvent(new CustomEvent('rav:render-surface-state', {
            detail: {
                artboard: 'Second',
                playback: { name: 'Bounce', type: 'animation' },
                vmInstance: { key: 'Inspector' },
            },
        }));

        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'Second',
            currentPlaybackName: 'Bounce',
            currentPlaybackType: 'animation',
            currentVmInstanceName: 'Inspector',
        });
        expect(elements.artboardSelect.value).toBe('Second');
        expect(elements.playbackSelect.value).toBe('anim:Bounce');
        expect(elements.vmInstanceSelect.value).toBe('Inspector');
    });

    it('does not replace dropdown options for unchanged canonical child ticks', () => {
        const elements = createElements();
        const harness = createHarness({
            elements,
            isAuthoritativeChildMode: () => true,
            riveInstance: {
                contents: {
                    artboards: [
                        { animations: ['Idle'], name: 'First', stateMachines: ['Boot'] },
                        { animations: ['Bounce'], name: 'Second', stateMachines: ['Main'] },
                    ],
                },
                defaultViewModel: () => ({
                    instanceCount: 2,
                    instanceNames: ['Inspector', 'Preview'],
                }),
            },
        });
        const canonicalState = {
            artboard: 'First',
            playback: { name: 'Boot', type: 'stateMachine' },
            vmInstance: { key: null },
        };
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        harness.controller.setupArtboardSwitcher();

        const artboardOption = elements.artboardSelect.options[0];
        const playbackOption = elements.playbackSelect.options[0];
        const instanceOption = elements.vmInstanceSelect.options[0];
        elements.playbackSelect.focus();
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: canonicalState }));

        expect(document.activeElement).toBe(elements.playbackSelect);
        expect(elements.artboardSelect.options[0]).toBe(artboardOption);
        expect(elements.playbackSelect.options[0]).toBe(playbackOption);
        expect(elements.vmInstanceSelect.options[0]).toBe(instanceOption);
    });

    it('reuses selector option nodes when plumbing refreshes the same topology', () => {
        const elements = createElements();
        const riveInstance = {
            contents: {
                artboards: [
                    { animations: ['Idle'], name: 'First', stateMachines: ['Boot'] },
                    { animations: ['Bounce'], name: 'Second', stateMachines: ['Main'] },
                ],
            },
            defaultViewModel: () => ({ instanceCount: 2, instanceNames: ['Inspector', 'Preview'] }),
        };
        const harness = createHarness({ elements, riveInstance });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();

        const nodes = {
            artboard: [...elements.artboardSelect.options],
            playback: [...elements.playbackSelect.options],
            instance: [...elements.vmInstanceSelect.options],
        };
        harness.controller.populateArtboardSwitcher();

        expect([...elements.artboardSelect.options]).toEqual(nodes.artboard);
        expect([...elements.playbackSelect.options]).toEqual(nodes.playback);
        expect([...elements.vmInstanceSelect.options]).toEqual(nodes.instance);
        expect(elements.vmInstanceRow.hidden).toBe(false);
    });

    it('defers changed canonical selector reconciliation until the focused popup closes', () => {
        const elements = createElements();
        const harness = createHarness({
            elements,
            isAuthoritativeChildMode: () => true,
            riveInstance: {
                contents: {
                    artboards: [
                        { animations: ['Idle'], name: 'First', stateMachines: ['Boot'] },
                        { animations: ['Bounce'], name: 'Second', stateMachines: ['Main'] },
                    ],
                },
                defaultViewModel: () => ({
                    instanceCount: 2,
                    instanceNames: ['Inspector', 'Preview'],
                }),
            },
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        harness.controller.setupArtboardSwitcher();

        const artboardOption = elements.artboardSelect.options[0];
        const playbackOption = elements.playbackSelect.options[0];
        const instanceOption = elements.vmInstanceSelect.options[0];
        elements.playbackSelect.focus();
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', {
            detail: {
                artboard: 'Second',
                playback: { name: 'Bounce', type: 'animation' },
                vmInstance: { key: 'Inspector' },
            },
        }));

        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'Second',
            currentPlaybackName: 'Bounce',
            currentPlaybackType: 'animation',
            currentVmInstanceName: 'Inspector',
        });
        expect(document.activeElement).toBe(elements.playbackSelect);
        expect(elements.artboardSelect.options[0]).toBe(artboardOption);
        expect(elements.playbackSelect.options[0]).toBe(playbackOption);
        expect(elements.vmInstanceSelect.options[0]).toBe(instanceOption);
        expect(elements.artboardSelect.value).toBe('First');
        expect(elements.playbackSelect.value).toBe('sm:Boot');

        elements.playbackSelect.blur();
        expect(elements.artboardSelect.value).toBe('Second');
        expect(elements.playbackSelect.value).toBe('anim:Bounce');
        expect(elements.vmInstanceSelect.value).toBe('Inspector');
    });

    it('preserves selection fields omitted by a sparse canonical delta', () => {
        const elements = createElements();
        const harness = createHarness({
            elements,
            isAuthoritativeChildMode: () => true,
            riveInstance: {
                contents: {
                    artboards: [{ animations: ['Idle'], name: 'First', stateMachines: ['Boot'] }],
                },
                defaultViewModel: () => ({ instanceCount: 1, instanceNames: ['Inspector'] }),
            },
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        harness.controller.syncStateFromCanonical({
            artboard: 'First',
            playback: { name: 'Boot', type: 'stateMachine' },
            vmInstance: { key: 'Inspector' },
        });

        const playbackOption = elements.playbackSelect.options[0];
        const instanceOption = elements.vmInstanceSelect.options[0];
        harness.controller.syncStateFromCanonical({
            controlChanges: [{ key: 'vm:enabled:boolean', kind: 'boolean', value: true }],
            stateType: 'delta',
        });

        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'First',
            currentPlaybackName: 'Boot',
            currentPlaybackType: 'stateMachine',
            currentVmInstanceName: 'Inspector',
        });
        expect(elements.playbackSelect.options[0]).toBe(playbackOption);
        expect(elements.vmInstanceSelect.options[0]).toBe(instanceOption);
    });

    it.each([
        ['a named instance', 'Board'],
        ['runtime-list index zero', 0],
        ['the auto-bound instance', null],
    ])('keeps target B on Auto after leaving %s while active child A publishes during staging', async (_label, instanceKey) => {
        const loads = [];
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn((_url, _name, options) => {
                    loads.push(options);
                    return Promise.resolve();
                }),
            },
            isAuthoritativeChildMode: () => true,
        });
        harness.controller.syncStateFromCanonical({
            artboard: 'A',
            playback: { name: 'Idle', type: 'animation' },
            vmInstance: { key: instanceKey },
        });
        harness.controller.setupArtboardSwitcher();

        const switchToB = harness.controller.switchArtboard('B', 'sm:Main');
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', {
            detail: {
                artboard: 'A',
                playback: { name: 'Idle', type: 'animation' },
                vmInstance: { key: 'OldChild' },
            },
        }));

        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'B',
            currentPlaybackName: 'Main',
            currentPlaybackType: 'stateMachine',
            currentVmInstanceName: null,
        });
        expect(loads[0].configOverrides).toMatchObject({
            artboard: 'B',
            autoBind: true,
            stateMachines: 'Main',
        });

        loads[0].onLoaded();
        await switchToB;
    });

    it('holds target B in the render context while active child A still ticks', async () => {
        let loadOptions;
        let releaseRuntime;
        let renderContextPromise;
        let exportController;
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn((_url, _name, options) => {
                    loadOptions = options;
                    renderContextPromise = exportController.buildRenderSurfaceContext();
                    return Promise.resolve();
                }),
            },
            isAuthoritativeChildMode: () => true,
        });
        exportController = createDemoExportController({
            callbacks: {
                ensureRuntime: () => new Promise((resolve) => { releaseRuntime = resolve; }),
            },
            getArtboardStateSnapshot: () => harness.controller.getStateSnapshot(),
            getCurrentFileBuffer: () => Uint8Array.from([1]).buffer,
            getCurrentFileName: () => 'demo.riv',
            getRuntimeAsset: () => ({ text: 'runtime();', version: '2.40.1' }),
        });
        harness.controller.syncStateFromCanonical({
            artboard: 'A',
            playback: { name: 'Idle', type: 'animation' },
            vmInstance: { key: 'Board' },
        });
        harness.controller.setupArtboardSwitcher();

        const switchToB = harness.controller.switchArtboard('B', 'sm:Main');
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', {
            detail: {
                artboard: 'A',
                playback: { name: 'Idle', type: 'animation' },
                vmInstance: { key: 'OldChild' },
            },
        }));
        releaseRuntime();

        await expect(renderContextPromise).resolves.toMatchObject({
            payload: expect.objectContaining({
                artboard_name: 'B',
                state_machines: ['Main'],
                view_model_instance_name: null,
            }),
        });
        loadOptions.onLoaded();
        await switchToB;
    });

    it('settles artboard, timeline, and ViewModel switches only after onLoaded', async () => {
        const loads = [];
        const loadRiveAnimation = vi.fn((_url, _name, options) => {
            loads.push(options);
            return Promise.resolve();
        });
        const elements = createElements();
        const harness = createHarness({
            callbacks: { loadRiveAnimation },
            elements,
            riveInstance: {
                bindViewModelInstance: vi.fn(),
                defaultViewModel: () => ({
                    instanceByName: (name) => ({ name }),
                    instanceCount: 1,
                    instanceNames: ['Inspector'],
                    name: 'Panel VM',
                }),
            },
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });

        let settled = false;
        const artboardSwitch = harness.controller.switchArtboard('Second', 'anim:Bounce').then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        loads[0].onLoaded();
        await artboardSwitch;

        settled = false;
        const timelineSwitch = harness.controller.switchArtboard('Second', 'sm:Main').then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        loads[1].onLoaded();
        await timelineSwitch;

        settled = false;
        const vmSwitch = harness.controller.switchVmInstance('Inspector').then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        loads[2].beforeUserOnLoad();
        loads[2].onLoaded();
        await vmSwitch;
        expect(harness.controller.getStateSnapshot().currentVmInstanceName).toBe('Inspector');
    });

    it('restores controls and confirmed state when a switch load fails', async () => {
        let pendingLoad;
        const elements = createElements();
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn((_url, _name, options) => {
                    pendingLoad = options;
                    return Promise.resolve();
                }),
            },
            elements,
            riveInstance: {
                contents: {
                    artboards: [
                        { animations: ['Idle'], name: 'First', stateMachines: ['Boot'] },
                        { animations: ['Bounce'], name: 'Second', stateMachines: ['Main'] },
                    ],
                },
                defaultViewModel: () => ({ instanceCount: 0 }),
            },
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        elements.artboardSelect.value = 'Second';
        elements.playbackSelect.value = 'anim:Bounce';

        const switchPromise = harness.controller.switchArtboard('Second', 'anim:Bounce');
        // The hidden plumbing candidate reaches onLoad before the visible
        // child confirms activation. That staged state must not replace the
        // last visible selection used for rollback.
        harness.controller.syncStateAfterLoad({
            artboard: { name: 'Second' },
            playingAnimationNames: ['Bounce'],
            playingStateMachineNames: [],
        }, { animations: 'Bounce', artboard: 'Second' });
        pendingLoad.onLoadError(new Error('surface rejected load'));
        await switchPromise;

        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'First',
            currentPlaybackName: 'Boot',
            currentPlaybackType: 'stateMachine',
        });
        expect(elements.artboardSelect.value).toBe('First');
        expect(elements.playbackSelect.value).toBe('sm:Boot');
        expect(harness.callbacks.showError).toHaveBeenCalledWith('Failed to switch artboard: surface rejected load');
    });

    it('keeps the latest Auto-scoped selection when an earlier artboard load settles later', async () => {
        const loads = [];
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn((_url, _name, options) => {
                    loads.push(options);
                    return Promise.resolve();
                }),
            },
        });
        harness.controller.syncStateFromCanonical({
            artboard: 'First',
            playback: { name: 'Boot', type: 'stateMachine' },
            vmInstance: { key: 'Main' },
        });

        const first = harness.controller.switchArtboard('Second', 'anim:Bounce');
        const second = harness.controller.switchArtboard('Third', 'sm:Main');
        harness.controller.syncStateAfterLoad({
            artboard: { name: 'Third' },
            playingAnimationNames: [],
            playingStateMachineNames: ['Main'],
        }, { artboard: 'Third', stateMachines: 'Main' });
        loads[1].onLoaded();
        await second;
        loads[0].onLoadError(new Error('stale load failed'));
        await first;

        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'Third',
            currentPlaybackName: 'Main',
            currentPlaybackType: 'stateMachine',
            currentVmInstanceName: null,
        });
        expect(loads[0].configOverrides.autoBind).toBe(true);
        expect(loads[1].configOverrides.autoBind).toBe(true);
        expect(harness.callbacks.showError).not.toHaveBeenCalled();
    });

    it('restores the confirmed instance when a rapid artboard change returns before the candidate commits', async () => {
        const loads = [];
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn((_url, _name, options) => {
                    loads.push(options);
                    return Promise.resolve();
                }),
            },
            isAuthoritativeChildMode: () => true,
        });
        harness.controller.syncStateFromCanonical({
            artboard: 'A',
            playback: { name: 'Idle', type: 'animation' },
            vmInstance: { key: 'Main' },
        });

        const switchToB = harness.controller.switchArtboard('B', 'sm:Next');
        const switchBackToA = harness.controller.switchArtboard('A', 'anim:Idle');

        expect(loads[0].configOverrides.autoBind).toBe(true);
        expect(loads[1].configOverrides.autoBind).toBe(false);
        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'A',
            currentPlaybackName: 'Idle',
            currentPlaybackType: 'animation',
            currentVmInstanceName: 'Main',
        });

        loads[1].onLoaded();
        await switchBackToA;
        loads[0].onLoadError(new Error('stale B rejected'));
        await switchToB;

        expect(harness.controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'A',
            currentVmInstanceName: 'Main',
        });
        expect(harness.callbacks.showError).not.toHaveBeenCalled();
    });

    it('stages DEFAULT through the authoritative child instead of resetting the hidden parent', async () => {
        let pendingLoad;
        const resetRiveInstance = vi.fn(() => true);
        const elements = createElements();
        const harness = createHarness({
            callbacks: {
                loadRiveAnimation: vi.fn((_url, _name, options) => {
                    pendingLoad = options;
                    return Promise.resolve();
                }),
                resetRiveInstance,
            },
            elements,
            isAuthoritativeChildMode: () => true,
            riveInstance: {
                contents: {
                    artboards: [
                        { animations: ['Idle'], name: 'First', stateMachines: ['Boot'] },
                        { animations: ['Bounce'], name: 'Second', stateMachines: ['Main'] },
                    ],
                },
                defaultViewModel: () => ({ instanceCount: 0 }),
            },
        });
        harness.controller.syncStateFromConfig({ artboard: 'First', configuredStateMachines: ['Boot'] });
        harness.controller.populateArtboardSwitcher();
        harness.controller.syncStateFromConfig({ artboard: 'Second', configuredStateMachines: ['Main'] });

        const reset = harness.controller.resetToDefaultArtboard();
        expect(resetRiveInstance).not.toHaveBeenCalled();
        expect(pendingLoad.configOverrides).toMatchObject({ artboard: 'First', stateMachines: 'Boot' });
        pendingLoad.onLoaded();
        await reset;
        expect(harness.controller.getStateSnapshot().currentArtboard).toBe('First');
    });

    it('wires DOM events through setup and updates playback options on artboard changes', async () => {
        const elements = createElements();
        const harness = createHarness({ elements });
        const bindViewModelInstance = vi.fn();
        harness.setRiveInstance({
            bindViewModelInstance,
            contents: {
                artboards: [
                    {
                        name: 'First',
                        animations: ['Idle'],
                        stateMachines: ['Boot'],
                    },
                    {
                        name: 'Second',
                        animations: ['Bounce'],
                        stateMachines: ['Main'],
                    },
                ],
            },
            defaultViewModel: () => ({
                instanceByName: vi.fn((name) => ({ name })),
                instanceCount: 2,
                instanceNames: ['Inspector', 'Preview'],
                name: 'Panel VM',
            }),
            viewModelInstance: { name: 'Preview' },
        });
        harness.controller.syncStateFromConfig({
            artboard: 'First',
            configuredStateMachines: ['Boot'],
        });
        harness.controller.populateArtboardSwitcher();
        harness.controller.setupArtboardSwitcher();

        elements.artboardSelect.value = 'Second';
        elements.artboardSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();

        elements.playbackSelect.value = 'anim:Bounce';
        elements.playbackSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();

        elements.vmInstanceSelect.value = 'Inspector';
        elements.vmInstanceSelect.dispatchEvent(new Event('change'));
        elements.artboardResetBtn.click();

        expect(harness.callbacks.loadRiveAnimation).toHaveBeenCalled();
        expect(bindViewModelInstance).toHaveBeenCalledWith({ name: 'Inspector' });
        expect(harness.callbacks.logEvent).toHaveBeenCalledWith(
            'ui',
            'artboard-reset',
            'Reset to default artboard "First".',
        );
    });

    it('defers popup-menu driven switches until after the change handler returns', () => {
        const elements = createElements();
        const scheduled = [];
        const harness = createHarness({
            elements,
            setTimeoutFn: (callback) => {
                scheduled.push(callback);
                return scheduled.length;
            },
        });
        harness.setRiveInstance({
            contents: {
                artboards: [
                    {
                        name: 'First',
                        animations: ['Idle'],
                        stateMachines: ['Boot'],
                    },
                    {
                        name: 'Second',
                        animations: ['Bounce'],
                        stateMachines: ['Main'],
                    },
                ],
            },
            defaultViewModel: () => ({ instanceCount: 1 }),
            viewModelInstance: null,
        });
        harness.controller.syncStateFromConfig({
            artboard: 'First',
            configuredStateMachines: ['Boot'],
        });
        harness.controller.populateArtboardSwitcher();
        harness.controller.setupArtboardSwitcher();

        elements.artboardSelect.value = 'Second';
        elements.artboardSelect.dispatchEvent(new Event('change'));

        expect(harness.callbacks.loadRiveAnimation).not.toHaveBeenCalled();
        expect(scheduled).toHaveLength(1);

        scheduled[0]();
        expect(harness.callbacks.loadRiveAnimation).toHaveBeenCalled();
    });


    it('executes default callback paths safely', async () => {
        const elements = createElements();
        const controller = createArtboardSwitcherController({
            callbacks: {
                loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                    options?.onLoaded?.();
                }),
            },
            elements,
            getCurrentFileName: () => 'demo.riv',
            getCurrentFileUrl: () => 'blob:demo',
            getRiveInstance: () => ({
                bindViewModelInstance: vi.fn(),
                contents: {
                    artboards: [{
                        animations: ['Idle'],
                        name: 'Only',
                        stateMachines: ['Main'],
                    }],
                },
                defaultViewModel: () => ({
                    instanceByName: () => ({ name: 'Preview' }),
                    instanceCount: 2,
                    instanceNames: ['Preview', 'Inspector'],
                    name: 'VM',
                }),
                viewModelInstance: { name: 'Preview' },
            }),
            setTimeoutFn: (callback) => {
                callback();
                return 1;
            },
        });

        controller.populateArtboardSwitcher();
        controller.setupArtboardSwitcher();
        await expect(controller.switchArtboard('Only', 'sm:Main')).resolves.toBeUndefined();
        await controller.switchVmInstance('Inspector');
        controller.resetForNewFile();
        controller.resetToDefaultArtboard();

        expect(elements.artboardSwitcher.hidden).toBe(false);
    });
});
