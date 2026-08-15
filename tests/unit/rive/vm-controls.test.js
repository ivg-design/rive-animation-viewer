import {
    argbToColorMeta,
    buildVmHierarchy,
    controlSelectionKeyForDescriptor,
    createVmControlsController,
    formatVmListItemLabel,
    getVmAccessor,
    getVmListItemAt,
    getVmListItemName,
    getVmListLength,
    getStateMachineInputKind,
    hexToRgb,
    navigateToVmInstance,
    normalizeControlSelectionKey,
    resolveVmRootInstance,
    safeVmMethodCall,
    rgbAlphaToArgb,
    shouldResumePlaybackForTrigger,
} from '../../../src/app/rive/vm-controls.js';
import { appendVmImageControl } from '../../../src/app/rive/view-model/image-control.js';

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

    const createListItem = (numberAccessor, name = null) => ({
        ...(name ? { name } : {}),
        number(name) {
            return name === 'speed' ? numberAccessor : null;
        },
        properties: [{ name: 'speed' }],
    });
    const listItems = [createListItem(listNumber)];
    const listAccessor = {
        instanceAt(index) {
            return listItems[index] || null;
        },
        get length() {
            return listItems.length;
        },
    };

    const rootVm = {
        color(name) {
            return name === 'theme' ? rootColor : null;
        },
        enum(name) {
            return name === 'mode' ? rootEnum : null;
        },
        list(name) {
            return name === 'items' ? listAccessor : null;
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
        isPlaying: false,
        isStopped: true,
        play: vi.fn(() => {
            riveInstance.isPlaying = true;
            riveInstance.isStopped = false;
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
        list: {
            createItem(value) {
                return createListItem({ value });
            },
            items: listItems,
        },
        riveInstance,
        triggers: {
            smTrigger,
            vmTrigger,
        },
    };
}

describe('rive/vm-controls', () => {
    it('normalizes repeated list controls into one family key and one-based label', () => {
        expect(controlSelectionKeyForDescriptor({
            kind: 'number',
            path: 'rows/149/introY',
        })).toBe('vm:rows/*/introY:number');
        expect(normalizeControlSelectionKey('vm:rows/0/introY:number')).toBe('vm:rows/*/introY:number');
        expect(normalizeControlSelectionKey('sm:Main:armed:boolean')).toBe('sm:Main:armed:boolean');
        expect(formatVmListItemLabel('rows', 0)).toBe('Row 1');
        expect(formatVmListItemLabel('playerEntries', 149)).toBe('Player Entry 150');
        expect(formatVmListItemLabel('rows', 0, { name: 'Authored Row' })).toBe('Authored Row');
        expect(getVmListItemName({ viewModelName: 'Named VM' })).toBe('Named VM');
        expect(getVmListItemName({ name: '  ' })).toBeNull();
    });

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

    it('discovers image inputs as writable ViewModel controls', () => {
        const imageAccessor = { value: null };
        const imageVm = {
            image(name) {
                return name === 'avatar' ? imageAccessor : null;
            },
            properties: [{ name: 'avatar' }],
        };
        const hierarchy = buildVmHierarchy(imageVm);
        expect(hierarchy.inputs).toEqual([
            expect.objectContaining({ kind: 'image', name: 'avatar', path: 'avatar' }),
        ]);
    });

    it('renders an image file picker and clear action for an image control', async () => {
        const accessor = { value: null };
        const container = document.createElement('div');
        const bindings = [];
        const decodedImage = { unref: vi.fn() };
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar' },
            documentRef: document,
            getLoadedRuntime: () => ({ decodeImage: vi.fn(async () => decodedImage) }),
            inputContainer: container,
            logEvent: vi.fn(),
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => accessor,
        });

        const fileInput = container.querySelector('input[type="file"]');
        const clearButton = container.querySelector('button');
        expect(fileInput?.accept).toBe('image/*');
        expect(clearButton?.textContent).toBe('Clear');
        expect(bindings[0]?.kind).toBe('image');

        accessor.value = { existing: true };
        clearButton.click();
        expect(accessor.value).toBeNull();
        expect(decodedImage.unref).not.toHaveBeenCalled();
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
        }, 'zero')).toBe(0);

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
        expect(getStateMachineInputKind({ value: false, fire() {} }, {})).toBe('boolean');
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
                enumValues: ['slow', 'fast'],
                value: 'slow',
            }),
            expect.objectContaining({
                kind: 'trigger',
                value: null,
            }),
        ]));

        harness.controller.setVmControlBaselineSnapshot(snapshot);
        harness.accessors.rootNumber.value = 11;
        harness.accessors.rootString.value = 'updated again';
        const changedSnapshot = harness.controller.getChangedVmControlSnapshot();
        expect(changedSnapshot).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'number',
                value: 11,
            }),
            expect.objectContaining({
                kind: 'string',
                value: 'updated again',
            }),
        ]));
        expect(changedSnapshot).not.toEqual(expect.arrayContaining([
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
        const controlHierarchy = harness.controller.serializeControlHierarchy();
        expect(controlHierarchy.children).toHaveLength(2);
        expect(controlHierarchy.children[1].inputs[0]).toMatchObject({
            name: 'armed',
            source: 'state-machine',
            stateMachineName: 'Machine',
        });

        harness.controller.resetVmInputControls('No animation loaded.');
        expect(harness.elements.vmControlsCount.textContent).toBe('0');
        expect(harness.elements.vmControlsEmpty.textContent).toBe('No animation loaded.');
        expect(harness.clearIntervalFn).toHaveBeenCalledWith('timer-1');
    });

    it('rerenders only when mutable list topology changes and keeps scalar sync active', () => {
        const harness = createVmHarness();
        harness.controller.renderVmInputControls();

        const findNumberInput = (path) => Array.from(harness.elements.vmControlsTree.querySelectorAll('.vm-control-row'))
            .find((row) => row.querySelector('.vm-control-label')?.title === path)
            ?.querySelector('input[type="number"]');

        const originalCountInput = findNumberInput('count');
        expect(originalCountInput).toBeTruthy();
        expect(harness.callbacks.initLucideIcons).toHaveBeenCalledTimes(1);

        harness.accessors.rootNumber.value = 42;
        harness.intervals[0].callback();

        expect(findNumberInput('count')).toBe(originalCountInput);
        expect(originalCountInput.value).toBe('42');
        expect(harness.callbacks.initLucideIcons).toHaveBeenCalledTimes(1);
        expect(harness.controller.syncVmControlTopology()).toBe(false);

        harness.list.items.push(harness.list.createItem(24));
        expect(harness.controller.syncVmControlTopology()).toBe(true);

        expect(harness.elements.vmControlsCount.textContent).toBe('10');
        expect(harness.elements.vmControlsTree.textContent).toContain('items [2]');
        expect(harness.elements.vmControlsTree.textContent).toContain('Item 1');
        expect(harness.elements.vmControlsTree.textContent).toContain('Item 2');
        expect(findNumberInput('items/1/speed').value).toBe('24');
        expect(harness.callbacks.initLucideIcons).toHaveBeenCalledTimes(2);
        expect(harness.intervals).toHaveLength(1);

        harness.list.items.splice(0, harness.list.items.length);
        harness.intervals[0].callback();

        expect(harness.elements.vmControlsCount.textContent).toBe('8');
        expect(harness.elements.vmControlsTree.textContent).not.toContain('items [');
        expect(harness.intervals).toHaveLength(1);

        harness.list.items.push(harness.list.createItem(7));
        harness.intervals[0].callback();

        expect(harness.elements.vmControlsCount.textContent).toBe('9');
        expect(harness.elements.vmControlsTree.textContent).toContain('items [1]');
        expect(findNumberInput('items/0/speed').value).toBe('7');
    });

    it('polls an empty list with no scalar bindings and discovers items as they become available', () => {
        const elements = createVmElements();
        const intervals = [];
        const clearIntervalFn = vi.fn();
        const listItems = [];
        let listLength = 0;
        const listAccessor = {
            instanceAt(index) {
                return listItems[index] || null;
            },
            get length() {
                return listLength;
            },
        };
        const rootVm = {
            list(name) {
                return name === 'items' ? listAccessor : null;
            },
            properties: [{ name: 'items' }],
        };
        const callbacks = {
            initLucideIcons: vi.fn(),
            logEvent: vi.fn(),
        };
        const controller = createVmControlsController({
            callbacks,
            clearIntervalFn,
            elements,
            getRiveInstance: () => ({
                stateMachineNames: [],
                viewModelInstance: rootVm,
            }),
            setIntervalFn: vi.fn((callback, delay) => {
                intervals.push({ callback, delay });
                return `empty-list-timer-${intervals.length}`;
            }),
        });

        controller.renderVmInputControls();

        expect(elements.vmControlsCount.textContent).toBe('0');
        expect(elements.vmControlsEmpty.hidden).toBe(false);
        expect(intervals).toHaveLength(1);
        expect(clearIntervalFn).not.toHaveBeenCalled();

        listLength = 1;
        intervals[0].callback();
        expect(elements.vmControlsCount.textContent).toBe('0');
        expect(intervals).toHaveLength(1);

        listItems.push({
            number(name) {
                return name === 'value' ? { value: 15 } : null;
            },
            properties: [{ name: 'value' }],
        });
        intervals[0].callback();

        expect(elements.vmControlsCount.textContent).toBe('1');
        expect(elements.vmControlsEmpty.hidden).toBe(true);
        expect(elements.vmControlsTree.textContent).toContain('items [1]');
        expect(elements.vmControlsTree.textContent).toContain('value (number)');
        expect(callbacks.initLucideIcons).toHaveBeenCalledTimes(1);

        listItems.length = 0;
        listLength = 0;
        intervals[0].callback();

        expect(elements.vmControlsCount.textContent).toBe('0');
        expect(elements.vmControlsEmpty.hidden).toBe(false);
        expect(clearIntervalFn).not.toHaveBeenCalled();

        listItems.push({
            string(name) {
                return name === 'label' ? { value: 'restored' } : null;
            },
            properties: [{ name: 'label' }],
        });
        listLength = 1;
        intervals[0].callback();

        expect(elements.vmControlsCount.textContent).toBe('1');
        expect(elements.vmControlsTree.textContent).toContain('label (string)');
    });

    it('retries unresolved snapshot rows once list instances appear', () => {
        const harness = createVmHarness();
        harness.controller.renderVmInputControls();
        harness.controller.setVmControlBaselineSnapshot();

        const restored = harness.controller.applyVmControlSnapshot([
            {
                descriptor: { kind: 'number', name: 'count', path: 'count' },
                kind: 'number',
                value: 9,
            },
            {
                descriptor: { kind: 'number', name: 'speed', path: 'items/1/speed' },
                kind: 'number',
                value: 88,
            },
        ]);

        expect(restored).toBe(1);
        expect(harness.accessors.rootNumber.value).toBe(9);

        const delayedItem = harness.list.createItem(0);
        harness.list.items.push(delayedItem);
        harness.intervals[0].callback();

        expect(delayedItem.number('speed').value).toBe(88);
        expect(harness.controller.getChangedVmControlSnapshot()).toEqual([
            expect.objectContaining({
                descriptor: expect.objectContaining({ path: 'count' }),
                value: 9,
            }),
        ]);
    });

    it('does not report snapshot writes against an unbound default ViewModel instance', () => {
        const harness = createVmHarness();
        const boundRoot = harness.riveInstance.viewModelInstance;
        harness.riveInstance.defaultViewModel = () => ({ defaultInstance: () => boundRoot });
        harness.riveInstance.viewModelInstance = null;

        const snapshot = [{
            descriptor: { kind: 'number', name: 'count', path: 'count' },
            kind: 'number',
            value: 77,
        }];

        expect(harness.controller.applyVmControlSnapshot(snapshot)).toBe(0);
        expect(harness.accessors.rootNumber.value).not.toBe(77);

        harness.riveInstance.viewModelInstance = boundRoot;
        expect(harness.controller.applyVmControlSnapshot(snapshot)).toBe(1);
        expect(harness.accessors.rootNumber.value).toBe(77);
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
        expect(emptyController.getChangedVmControlSnapshot()).toEqual([]);
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
                isPlaying: true,
                isStopped: false,
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

    it('detects whether playback should resume before firing triggers', () => {
        expect(shouldResumePlaybackForTrigger(null)).toBe(false);
        expect(shouldResumePlaybackForTrigger({ isPlaying: true })).toBe(false);
        expect(shouldResumePlaybackForTrigger({ isPlaying: false })).toBe(true);
        expect(shouldResumePlaybackForTrigger({ isStopped: true })).toBe(true);
        expect(shouldResumePlaybackForTrigger({})).toBe(true);
    });
});
