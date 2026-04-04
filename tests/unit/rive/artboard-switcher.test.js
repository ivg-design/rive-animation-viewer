import {
    createArtboardSwitcherController,
    parsePlaybackTarget,
} from '../../../src/app/rive/artboard-switcher.js';

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
        loadRiveAnimation: vi.fn().mockResolvedValue(undefined),
        logEvent: vi.fn(),
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

        expect(callbacks.loadRiveAnimation).toHaveBeenCalledWith('blob:demo', 'demo.riv', expect.objectContaining({
            configOverrides: {
                animations: 'Bounce',
                artboard: 'Menu',
                autoBind: true,
                autoplay: true,
            },
            forceAutoplay: true,
        }));
        expect(controller.getStateSnapshot()).toMatchObject({
            currentArtboard: 'Menu',
            currentPlaybackName: 'Bounce',
            currentPlaybackType: 'animation',
        });
    });

    it('can reset and switch view model instances', () => {
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
            'Inspector',
            'Preview',
        ]);

        harness.controller.switchVmInstance('Inspector');
        expect(bindViewModelInstance).toHaveBeenCalledWith({ name: 'Inspector' });
        expect(harness.callbacks.renderVmInputControls).toHaveBeenCalled();

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

    it('hides the switcher when instance data is unavailable and resets with an error when no default exists', () => {
        const elements = createElements();
        const harness = createHarness({ elements, riveInstance: null });

        harness.controller.populateArtboardSwitcher();
        expect(elements.artboardSwitcher.hidden).toBe(true);

        harness.controller.resetToDefaultArtboard();
        expect(harness.callbacks.showError).toHaveBeenCalledWith('No default artboard. Reload the file.');
    });

    it('reverts switch state on load failure and supports numeric VM instance fallback', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const callbacks = {
            loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                options?.onLoadError?.(new Error('switch failed'));
            }),
        };
        const elements = createElements();
        const controller = createArtboardSwitcherController({
            callbacks: {
                ...callbacks,
                initLucideIcons: vi.fn(),
                logEvent: vi.fn(),
                renderVmInputControls: vi.fn(),
                showError: vi.fn(),
                updateInfo: vi.fn(),
            },
            elements,
            getCurrentFileName: () => 'demo.riv',
            getCurrentFileUrl: () => 'blob:demo',
            getRiveInstance: () => ({
                defaultViewModel: () => ({
                    instanceByIndex: vi.fn((index) => ({ index })),
                    instanceCount: 2,
                    instanceNames: null,
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
        expect(Array.from(elements.vmInstanceSelect.options).map((option) => option.value)).toEqual(['0', '1']);
        controller.switchVmInstance('missing');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
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
        expect(harness.callbacks.renderVmInputControls).toHaveBeenCalled();
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
        controller.switchVmInstance('Inspector');
        controller.resetForNewFile();
        controller.resetToDefaultArtboard();

        expect(elements.artboardSwitcher.hidden).toBe(false);
    });
});
