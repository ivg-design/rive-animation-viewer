import {
    argbToColorMeta,
    createVmControlsController,
    getVmAccessor,
    getVmListItemAt,
    getVmListLength,
    getStateMachineInputKind,
    hexToRgb,
    navigateToVmInstance,
    resolveVmRootInstance,
    safeVmMethodCall,
    rgbAlphaToArgb,
} from '../../../src/app/rive/vm-controls.js';

function createVmElements() {
    document.body.innerHTML = `
        <span id="vm-controls-count"></span>
        <p id="vm-controls-empty"></p>
        <div id="vm-controls-tree"></div>
    `;

    return {
        vmControlsCount: document.getElementById('vm-controls-count'),
        vmControlsEmpty: document.getElementById('vm-controls-empty'),
        vmControlsTree: document.getElementById('vm-controls-tree'),
    };
}

function createVmHarness() {
    const elements = createVmElements();
    const intervals = [];
    const clearIntervalFn = vi.fn();
    const rootNumber = { value: 3 };
    const rootString = { value: 'hello' };
    const rootEnum = { value: 'fast', values: ['slow', 'fast'] };
    const rootColor = { value: 0xff336699 };
    const childBoolean = { value: false };
    const listNumber = { value: 12 };
    const vmTrigger = { trigger: vi.fn() };
    const smBoolean = { name: 'armed', type: 1, value: true };
    const smTrigger = { name: 'Launch', type: 3, fire: vi.fn() };

    const listItem = {
        number(name) {
            return name === 'speed' ? listNumber : null;
        },
        properties: [{ name: 'speed' }],
    };

    const rootVm = {
        color(name) {
            return name === 'theme' ? rootColor : null;
        },
        enum(name) {
            return name === 'mode' ? rootEnum : null;
        },
        list(name) {
            return name === 'items' ? {
                instanceAt(index) {
                    return index === 0 ? listItem : null;
                },
                length: 1,
            } : null;
        },
        name: 'Root VM',
        number(name) {
            return name === 'count' ? rootNumber : null;
        },
        properties: [
            { name: 'count' },
            { name: 'title' },
            { name: 'mode' },
            { name: 'theme' },
            { name: 'child' },
            { name: 'items' },
            { name: 'launch' },
        ],
        string(name) {
            return name === 'title' ? rootString : null;
        },
        trigger(name) {
            return name === 'launch' ? vmTrigger : null;
        },
        viewModel(name) {
            if (name !== 'child') {
                return null;
            }
            return {
                boolean(propertyName) {
                    return propertyName === 'enabled' ? childBoolean : null;
                },
                properties: [{ name: 'enabled' }],
            };
        },
    };

    const runtime = {
        StateMachineInputType: {
            Boolean: 1,
            Number: 2,
            Trigger: 3,
        },
    };

    const riveInstance = {
        isPaused: true,
        play: vi.fn(() => {
            riveInstance.isPaused = false;
        }),
        stateMachineInputs(name) {
            return name === 'Machine' ? [smBoolean, smTrigger] : [];
        },
        stateMachineNames: ['Machine'],
        viewModelInstance: rootVm,
    };

    const callbacks = {
        initLucideIcons: vi.fn(),
        logEvent: vi.fn(),
    };

    const controller = createVmControlsController({
        callbacks,
        clearIntervalFn,
        elements,
        getCurrentRuntime: () => 'webgl2',
        getLoadedRuntime: () => runtime,
        getRiveInstance: () => riveInstance,
        setIntervalFn: vi.fn((callback, delay) => {
            intervals.push({ callback, delay });
            return `timer-${intervals.length}`;
        }),
    });

    return {
        accessors: {
            childBoolean,
            listNumber,
            rootColor,
            rootEnum,
            rootNumber,
            rootString,
            smBoolean,
        },
        callbacks,
        clearIntervalFn,
        controller,
        elements,
        intervals,
        riveInstance,
        triggers: {
            smTrigger,
            vmTrigger,
        },
    };
}

describe('rive/vm-controls', () => {
    it('resolves the VM root from the live instance or default view model', () => {
        const directInstance = { id: 'direct' };
        expect(resolveVmRootInstance({ viewModelInstance: directInstance })).toBe(directInstance);

        const fallbackInstance = { id: 'fallback' };
        expect(resolveVmRootInstance({
            defaultViewModel() {
                return {
                    defaultInstance() {
                        return fallbackInstance;
                    },
                };
            },
        })).toBe(fallbackInstance);
    });

    it('navigates nested VM and list paths', () => {
        const leaf = { label: 'leaf' };
        const rootVm = {
            list(name) {
                return name === 'items' ? {
                    instanceAt(index) {
                        return index === 2 ? leaf : null;
                    },
                } : null;
            },
            viewModel(name) {
                return name === 'child'
                    ? { marker: 'child-vm' }
                    : null;
            },
        };

        expect(navigateToVmInstance(rootVm, 'child/enabled')).toEqual({
            instance: { marker: 'child-vm' },
            propertyName: 'enabled',
        });
        expect(navigateToVmInstance(rootVm, 'items/2/value')).toEqual({
            instance: leaf,
            propertyName: 'value',
        });
        expect(navigateToVmInstance(rootVm, 'items/9/value')).toBeNull();
    });

    it('detects state machine input kinds and converts ARGB colors', () => {
        const runtime = {
            StateMachineInputType: {
                Boolean: 11,
                Number: 12,
                Trigger: 13,
            },
        };

        expect(getStateMachineInputKind({ type: 11 }, runtime)).toBe('boolean');
        expect(getStateMachineInputKind({ type: 12 }, runtime)).toBe('number');
        expect(getStateMachineInputKind({ fire() {} }, runtime)).toBe('trigger');

        expect(hexToRgb('#336699')).toEqual({ r: 51, g: 102, b: 153 });
        expect(rgbAlphaToArgb(51, 102, 153, 255)).toBe(0xff336699);
        expect(argbToColorMeta(0x80336699)).toEqual({
            alphaPercent: 50,
            hex: '#336699',
        });
    });

    it('covers helper edge cases for safe calls, list accessors, and input kind detection', () => {
        expect(safeVmMethodCall(null, 'number', 'count')).toBeNull();
        expect(safeVmMethodCall({
            broken() {
                throw new Error('nope');
            },
        }, 'broken')).toBeNull();
        expect(safeVmMethodCall({
            zero() {
                return 0;
            },
        }, 'zero')).toBeNull();

        expect(getVmListLength({ size: 3 })).toBe(3);
        expect(getVmListLength({ length: -9 })).toBe(0);
        expect(getVmListItemAt({
            instanceAt() {
                throw new Error('bad item');
            },
        }, 0)).toBeNull();

        const booleanAccessor = { value: true };
        const colorAccessor = { value: 0xff000000 };
        const accessorHost = {
            boolean(name) {
                return name === 'flag' ? booleanAccessor : null;
            },
            color(name) {
                return name === 'theme' ? colorAccessor : null;
            },
        };
        expect(getVmAccessor(accessorHost, 'flag')).toEqual({
            accessor: booleanAccessor,
            kind: 'boolean',
        });
        expect(getVmAccessor(accessorHost, 'theme')).toEqual({
            accessor: colorAccessor,
            kind: 'color',
        });

        expect(getStateMachineInputKind({ type: 1 }, {
            SMIInput: {
                bool: 1,
                number: 2,
                trigger: 3,
            },
        })).toBe('boolean');
        expect(getStateMachineInputKind({ constructor: { name: 'NumberInput' } }, {})).toBe('number');
        expect(getStateMachineInputKind({ constructor: { name: 'TriggerInput' } }, {})).toBe('trigger');
        expect(getStateMachineInputKind({ value: false }, {})).toBe('boolean');
        expect(getStateMachineInputKind({ value: 4 }, {})).toBe('number');
        expect(hexToRgb('bad')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('renders VM and state machine controls, syncs values, and captures snapshots', () => {
        const harness = createVmHarness();

        harness.controller.renderVmInputControls();

        expect(harness.elements.vmControlsCount.textContent).toBe('9');
        expect(harness.elements.vmControlsEmpty.hidden).toBe(true);
        expect(harness.elements.vmControlsTree.textContent).toContain('Root VM');
        expect(harness.elements.vmControlsTree.textContent).toContain('Machine');
        expect(harness.intervals).toHaveLength(1);
        expect(harness.callbacks.initLucideIcons).toHaveBeenCalled();

        const textarea = harness.elements.vmControlsTree.querySelector('textarea');
        const checkbox = harness.elements.vmControlsTree.querySelector('input[type="checkbox"]');
        const select = harness.elements.vmControlsTree.querySelector('select');
        const numberInput = Array.from(harness.elements.vmControlsTree.querySelectorAll('input[type="number"]'))
            .find((input) => input.step === 'any');
        const colorInput = harness.elements.vmControlsTree.querySelector('input[type="color"]');
        const triggerButtons = harness.elements.vmControlsTree.querySelectorAll('button');

        expect(textarea).toBeTruthy();
        expect(checkbox).toBeTruthy();
        expect(select).toBeTruthy();
        expect(numberInput).toBeTruthy();
        expect(colorInput).toBeTruthy();
        expect(triggerButtons).toHaveLength(2);

        textarea.value = 'updated';
        textarea.dispatchEvent(new Event('change'));
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
        select.value = 'slow';
        select.dispatchEvent(new Event('change'));
        numberInput.value = '7';
        numberInput.dispatchEvent(new Event('change'));
        colorInput.value = '#112233';
        colorInput.dispatchEvent(new Event('input'));
        triggerButtons[0].click();
        triggerButtons[1].click();

        expect(harness.accessors.rootString.value).toBe('updated');
        expect(harness.accessors.childBoolean.value).toBe(true);
        expect(harness.accessors.rootEnum.value).toBe('slow');
        expect(harness.accessors.rootNumber.value).toBe(7);
        expect(harness.accessors.rootColor.value >>> 0).toBe(0xff112233);
        expect(harness.riveInstance.play).toHaveBeenCalledTimes(1);
        expect(harness.triggers.vmTrigger.trigger).toHaveBeenCalledTimes(1);
        expect(harness.triggers.smTrigger.fire).toHaveBeenCalledTimes(1);

        const snapshot = harness.controller.captureVmControlSnapshot();
        expect(snapshot).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'number',
                value: 7,
            }),
            expect.objectContaining({
                kind: 'string',
                value: 'updated',
            }),
            expect.objectContaining({
                kind: 'enum',
                value: 'slow',
            }),
        ]));

        harness.accessors.rootNumber.value = 99;
        harness.accessors.rootString.value = 'server value';
        harness.controller.syncVmControlBindings(true);

        expect(numberInput.value).toBe('99');
        expect(textarea.value).toBe('server value');

        harness.accessors.rootNumber.value = 0;
        harness.accessors.rootString.value = '';
        harness.accessors.rootEnum.value = 'fast';
        const restored = harness.controller.applyVmControlSnapshot(snapshot);

        expect(restored).toBeGreaterThan(0);
        expect(harness.accessors.rootNumber.value).toBe(7);
        expect(harness.accessors.rootString.value).toBe('updated');
        expect(harness.accessors.rootEnum.value).toBe('slow');

        const serialized = harness.controller.serializeVmHierarchy();
        expect(serialized.inputs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'count',
                value: 7,
            }),
            expect.objectContaining({
                enumValues: ['slow', 'fast'],
                name: 'mode',
                value: 'slow',
            }),
        ]));

        harness.controller.resetVmInputControls('No animation loaded.');
        expect(harness.elements.vmControlsCount.textContent).toBe('0');
        expect(harness.elements.vmControlsEmpty.textContent).toBe('No animation loaded.');
        expect(harness.clearIntervalFn).toHaveBeenCalledWith('timer-1');
    });

    it('shows the empty state when no writable controls are available', () => {
        const elements = createVmElements();
        const controller = createVmControlsController({
            callbacks: {
                initLucideIcons: vi.fn(),
                logEvent: vi.fn(),
            },
            elements,
            getLoadedRuntime: () => null,
            getRiveInstance: () => ({
                stateMachineInputs() {
                    return [];
                },
                stateMachineNames: [],
                viewModelInstance: {
                    properties: [],
                },
            }),
            setIntervalFn: vi.fn(),
        });

        controller.renderVmInputControls();

        expect(elements.vmControlsCount.textContent).toBe('0');
        expect(elements.vmControlsEmpty.hidden).toBe(false);
        expect(elements.vmControlsEmpty.textContent).toBe('No writable ViewModel or state machine inputs were found.');
    });

    it('handles fallback default instances plus trigger, enum, and color control edge cases', () => {
        const emptyElements = createVmElements();
        const emptyController = createVmControlsController({
            elements: emptyElements,
            getLoadedRuntime: () => null,
            getRiveInstance: () => ({
                defaultViewModel() {
                    return {
                        instance() {
                            return null;
                        },
                    };
                },
                stateMachineInputs() {
                    throw new Error('unavailable');
                },
                stateMachineNames: ['Broken'],
            }),
        });

        emptyController.renderVmInputControls();
        expect(emptyController.captureVmControlSnapshot()).toEqual([]);
        expect(emptyController.applyVmControlSnapshot(null)).toBe(0);
        expect(emptyController.serializeVmHierarchy()).toBeNull();

        const elements = createVmElements();
        const colorAccessor = {
            argb: vi.fn(),
            get value() {
                return 0x80112233;
            },
        };
        const callbacks = {
            initLucideIcons: vi.fn(),
            logEvent: vi.fn(),
        };
        const controller = createVmControlsController({
            callbacks,
            elements,
            getCurrentRuntime: () => 'webgl2',
            getLoadedRuntime: () => ({
                StateMachineInputType: {
                    Boolean: 1,
                    Number: 2,
                    Trigger: 3,
                },
            }),
            getRiveInstance: () => ({
                isPaused: false,
                play: vi.fn(),
                stateMachineInputs() {
                    return [{ name: 'BrokenTrigger', type: 3 }];
                },
                stateMachineNames: ['Machine'],
                viewModelInstance: {
                    color(name) {
                        return name === 'tint' ? colorAccessor : null;
                    },
                    enum(name) {
                        return name === 'mode' ? { value: '', values: [] } : null;
                    },
                    properties: [{ name: 'tint' }, { name: 'mode' }],
                    trigger() {
                        return null;
                    },
                },
            }),
        });

        controller.renderVmInputControls();

        const enumSelect = elements.vmControlsTree.querySelector('select');
        const colorInput = elements.vmControlsTree.querySelector('input[type="color"]');
        const alphaInput = Array.from(elements.vmControlsTree.querySelectorAll('input[type="number"]'))
            .find((input) => input.step === '1');
        const triggerButton = Array.from(elements.vmControlsTree.querySelectorAll('button'))
            .find((button) => button.textContent === 'Fire');

        expect(enumSelect.textContent).toContain('(no enum values)');
        colorInput.value = '#445566';
        colorInput.dispatchEvent(new Event('input'));
        alphaInput.value = '25';
        alphaInput.dispatchEvent(new Event('change'));
        expect(colorAccessor.argb).toHaveBeenCalled();

        triggerButton.click();
        expect(callbacks.logEvent).toHaveBeenCalledWith(
            'ui',
            'sm-trigger-miss',
            'No trigger accessor or state machine trigger matched stateMachine/Machine/BrokenTrigger',
        );

        const serializeController = createVmControlsController({
            elements: createVmElements(),
            getRiveInstance: () => ({
                viewModelInstance: {
                    number(name) {
                        if (name !== 'broken') {
                            return null;
                        }
                        return {
                            get value() {
                                throw new Error('read failure');
                            },
                        };
                    },
                    properties: [{ name: 'broken' }],
                },
            }),
        });
        const serialized = controller.serializeVmHierarchy();
        expect(serialized.inputs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'color',
                name: 'tint',
                value: 0x80112233,
            }),
        ]));
        expect(serializeController.serializeVmHierarchy().inputs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'number',
                name: 'broken',
                value: null,
            }),
        ]));
    });
});
