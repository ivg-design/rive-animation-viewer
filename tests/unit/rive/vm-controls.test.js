import {
    argbToColorMeta,
    buildVmHierarchy,
    controlSnapshotKeyForDescriptor,
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
import {
    VM_CONTROL_SYNC_INTERVAL_MS,
    VM_TOPOLOGY_SYNC_INTERVAL_MS,
} from '../../../src/app/core/constants.js';
import { appendVmImageControl } from '../../../src/app/rive/view-model/image-control.js';

const VM_TOPOLOGY_SYNC_TICKS = Math.ceil(VM_TOPOLOGY_SYNC_INTERVAL_MS / VM_CONTROL_SYNC_INTERVAL_MS);

function runVmSyncTicks(intervals, count = VM_TOPOLOGY_SYNC_TICKS) {
    for (let index = 0; index < count; index += 1) {
        intervals[0].callback();
    }
}

function createVmElements() {
    document.body.innerHTML = `
        <div id="main-grid"></div>
        <span id="vm-controls-count"></span>
        <p id="vm-controls-empty"></p>
        <div id="vm-controls-tree"></div>
    `;

    return {
        mainGrid: document.getElementById('main-grid'),
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
    it('normalizes repeated list controls and uses authored or generic row labels', () => {
        expect(controlSelectionKeyForDescriptor({
            kind: 'number',
            path: 'rows/149/introY',
        })).toBe('vm:rows/*/introY:number');
        expect(normalizeControlSelectionKey('vm:rows/0/introY:number')).toBe('vm:rows/*/introY:number');
        expect(normalizeControlSelectionKey('sm:Main:armed:boolean')).toBe('sm:Main:armed:boolean');
        expect(formatVmListItemLabel('rows', 0)).toBe('Row 1');
        expect(formatVmListItemLabel('playerEntries', 149)).toBe('Row 150');
        expect(formatVmListItemLabel('rows', 0, { name: 'Authored Row' })).toBe('Authored Row');
        expect(getVmListItemName({ instanceName: 'Instance Name', name: 'Fallback Name' })).toBe('Instance Name');
        expect(getVmListItemName({ viewModelName: 'Named VM' })).toBeNull();
        expect(getVmListItemName({ name: '  ' })).toBeNull();
    });

    it('matches exactly one readable string value to canonical authored instance names', () => {
        const riveInstance = {
            viewModelByName: vi.fn((name) => (name === 'ListItemVM'
                ? { instanceNames: ['Item-01', 'Item-02', 'Item-03'] }
                : null)),
        };
        const createItem = (values) => ({
            properties: Object.keys(values).map((name) => ({ name })),
            string: (name) => (name in values ? { value: values[name] } : null),
            viewModelName: 'ListItemVM',
        });

        const matchedItem = createItem({ item_code: 'Item-01', status: 'Active' });
        expect(getVmListItemName(matchedItem, riveInstance)).toBe('Item-01');
        expect(formatVmListItemLabel('rows', 0, matchedItem, riveInstance)).toBe('Item-01');

        const ambiguousItem = createItem({ item_code: 'Item-01', alternate: 'Item-02' });
        expect(getVmListItemName(ambiguousItem, riveInstance)).toBeNull();
        expect(formatVmListItemLabel('rows', 4, ambiguousItem, riveInstance)).toBe('Row 5');

        const hierarchy = buildVmHierarchy({
            list: (name) => (name === 'rows' ? {
                instanceAt: () => matchedItem,
                length: 1,
            } : null),
            properties: [{ name: 'rows' }],
        }, riveInstance);
        expect(hierarchy.children[0].children[0].label).toBe('Item-01');
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

    it('renders embedded-image choices and file/clear actions in one select', async () => {
        const accessor = { value: null };
        const container = document.createElement('div');
        const bindings = [];
        const decodedImage = { unref: vi.fn() };
        const decodeImage = vi.fn(async () => decodedImage);
        const logEvent = vi.fn();
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar' },
            documentRef: document,
            getEmbeddedImageAssets: () => [
                { key: 'sample-a', name: 'sample-raster-a', bytes: new Uint8Array([1, 2]) },
                { key: 'sample-b', name: 'sample-raster-b', bytes: new Uint8Array([3, 4]) },
            ],
            getLoadedRuntime: () => ({ decodeImage }),
            inputContainer: container,
            logEvent,
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => accessor,
        });

        const fileInput = container.querySelector('input[type="file"]');
        const assetSelect = container.querySelector('.vm-image-asset-select');
        expect(fileInput?.accept).toBe('image/*');
        // WebKit ignores programmatic file-picker activation for inputs that
        // are `hidden`/`display:none`. Keep it visually hidden by CSS while
        // leaving it eligible for the user-initiated select action.
        expect(fileInput?.hidden).toBe(false);
        expect(fileInput?.classList.contains('vm-image-file-input')).toBe(true);
        expect(fileInput?.tabIndex).toBe(-1);
        expect(assetSelect?.getAttribute('aria-label')).toBe('Image source for avatar');
        expect(container.querySelector('button')).toBeNull();
        expect(Array.from(assetSelect.options).map((option) => option.textContent)).toEqual([
            'Select image…',
            'sample-raster-a',
            'sample-raster-b',
            'Open file…',
            'Clear',
        ]);
        expect(bindings[0]?.kind).toBe('image');
        expect(bindings[0]).toEqual(expect.objectContaining({ assetSelect, input: fileInput }));

        const inputClick = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
        assetSelect.value = '__open__';
        assetSelect.dispatchEvent(new Event('change'));
        expect(inputClick).toHaveBeenCalledOnce();

        assetSelect.value = 'embedded:0';
        assetSelect.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(accessor.value).toBe(decodedImage));
        expect(decodeImage).toHaveBeenCalledWith(new Uint8Array([1, 2]));
        expect(decodedImage.unref).toHaveBeenCalledOnce();

        accessor.value = { existing: true };
        assetSelect.value = '__clear__';
        assetSelect.dispatchEvent(new Event('change'));
        expect(accessor.value).toBeNull();
        expect(assetSelect.value).toBe('');

        decodeImage.mockRejectedValueOnce(new Error('decode failed'));
        const invalidImageFile = {
            arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([9]).buffer),
            name: 'invalid.png',
        };
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [invalidImageFile] });
        fileInput.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(logEvent).toHaveBeenCalledWith(
            'ui',
            'vm-image-error',
            'Unable to set avatar image: decode failed',
        ));
        expect(assetSelect.querySelector('option[data-image-file-option]')).toBeNull();

        const unreadableFile = {
            arrayBuffer: vi.fn().mockRejectedValue(new Error('read failed')),
            name: 'unreadable.png',
        };
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [unreadableFile] });
        fileInput.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(logEvent).toHaveBeenCalledWith(
            'ui',
            'vm-image-error',
            'Unable to read unreadable.png: read failed',
        ));
    });

    it('sends image bytes and clear actions to the authoritative child without decoding in the parent', async () => {
        const container = document.createElement('div');
        const mutations = [];
        const listener = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', listener);
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' },
            documentRef: document,
            getEmbeddedImageAssets: () => [{ key: 'asset-a', name: 'A', bytes: new Uint8Array([1, 2, 3]) }],
            getLoadedRuntime: () => null,
            inputContainer: container,
            isAuthoritativeChildMode: true,
            logEvent: vi.fn(),
            registerVmControlBinding: vi.fn(),
            resolveControlAccessor: () => ({ value: null }),
        });

        const select = container.querySelector('.vm-image-asset-select');
        select.value = 'embedded:0';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(mutations).toHaveLength(1));
        expect(mutations[0]).toEqual(expect.objectContaining({
            action: 'set-image',
            imageSelection: { kind: 'embedded', key: 'asset-a', label: 'A' },
            kind: 'image',
            value: [1, 2, 3],
        }));

        select.value = '__clear__';
        select.dispatchEvent(new Event('change'));
        expect(mutations[1]).toEqual(expect.objectContaining({
            action: 'clear-image',
            imageSelection: null,
            value: null,
        }));
        document.removeEventListener('rav:vm-control-mutated', listener);
    });

    it('restores the acknowledged image selection when recovery rejects set or clear before dispatch', async () => {
        const container = document.createElement('div');
        const onRemoteMutationFailure = vi.fn();
        appendVmImageControl({
            canMutateRemoteControls: () => false,
            descriptor: {
                kind: 'image',
                metadata: { kind: 'embedded', key: 'asset-a', label: 'A' },
                name: 'avatar',
                path: 'avatar',
                source: 'view-model',
            },
            documentRef: document,
            getEmbeddedImageAssets: () => [
                { key: 'asset-a', name: 'A', bytes: new Uint8Array([1]) },
                { key: 'asset-b', name: 'B', bytes: new Uint8Array([2]) },
            ],
            getLoadedRuntime: () => null,
            inputContainer: container,
            isAuthoritativeChildMode: true,
            logEvent: vi.fn(),
            onRemoteMutationFailure,
            registerVmControlBinding: vi.fn(),
            resolveControlAccessor: () => ({ value: null }),
        });
        const select = container.querySelector('.vm-image-asset-select');

        select.value = 'embedded:1';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(onRemoteMutationFailure).toHaveBeenCalledTimes(1));
        expect(select.value).toBe('embedded:0');

        select.value = '__clear__';
        select.dispatchEvent(new Event('change'));
        expect(onRemoteMutationFailure).toHaveBeenCalledTimes(2);
        expect(select.value).toBe('embedded:0');
    });

    it('uses the native image picker when supplied and keeps paths out of the image mutation', async () => {
        const container = document.createElement('div');
        const bindings = [];
        const mutations = [];
        const listener = (event) => mutations.push(event.detail);
        const pickImageFile = vi.fn().mockResolvedValue({
            bytes: [7, 8, 9],
            name: 'replacement.avif',
            path: '/private/never-forwarded/replacement.avif',
        });
        document.addEventListener('rav:vm-control-mutated', listener);
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' },
            documentRef: document,
            getLoadedRuntime: () => null,
            inputContainer: container,
            isAuthoritativeChildMode: true,
            logEvent: vi.fn(),
            pickImageFile,
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => ({ value: null }),
        });

        const select = container.querySelector('.vm-image-asset-select');
        const input = container.querySelector('input[type="file"]');
        const inputClick = vi.spyOn(input, 'click');
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));

        await vi.waitFor(() => expect(mutations).toHaveLength(1));
        expect(pickImageFile).toHaveBeenCalledOnce();
        expect(inputClick).not.toHaveBeenCalled();
        expect(mutations[0]).toEqual(expect.objectContaining({
            action: 'set-image',
            imageSelection: { kind: 'file', label: 'replacement.avif' },
            kind: 'image',
            value: [7, 8, 9],
        }));
        expect(JSON.stringify(mutations[0])).not.toContain('/private/');
        // The parent must not publish metadata before the dedicated renderer
        // has acknowledged decode + property assignment.
        expect(select.value).toBe('');
        expect(select.querySelector('option[data-image-file-option]')).toBeNull();
        bindings[0].syncImageSelection({ kind: 'file', label: 'replacement.avif' });
        expect(select.value).toBe('__file__');
        expect(select.selectedOptions[0]?.textContent).toBe('replacement.avif');
        document.removeEventListener('rav:vm-control-mutated', listener);
    });

    it('treats native image-picker cancellation as a no-op', async () => {
        const container = document.createElement('div');
        const pickImageFile = vi.fn().mockResolvedValue(null);
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar' },
            documentRef: document,
            getLoadedRuntime: () => ({ decodeImage: vi.fn() }),
            inputContainer: container,
            logEvent: vi.fn(),
            pickImageFile,
            registerVmControlBinding: vi.fn(),
            resolveControlAccessor: () => ({ value: null }),
        });
        const select = container.querySelector('.vm-image-asset-select');
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(pickImageFile).toHaveBeenCalledOnce());
        expect(select.value).toBe('');
        expect(select.querySelector('option[data-image-file-option]')).toBeNull();
    });

    it('restores the prior embedded or file selection when the native picker cancels or errors', async () => {
        const container = document.createElement('div');
        const onRemoteMutationFailure = vi.fn();
        const pickImageFile = vi.fn()
            .mockResolvedValueOnce(null)
            .mockRejectedValueOnce(new Error('dialog unavailable'));
        appendVmImageControl({
            descriptor: {
                kind: 'image',
                metadata: { kind: 'file', label: 'current.webp' },
                name: 'avatar',
                path: 'avatar',
            },
            documentRef: document,
            getLoadedRuntime: () => ({ decodeImage: vi.fn() }),
            inputContainer: container,
            logEvent: vi.fn(),
            onRemoteMutationFailure,
            pickImageFile,
            registerVmControlBinding: vi.fn(),
            resolveControlAccessor: () => ({ value: null }),
        });

        const select = container.querySelector('.vm-image-asset-select');
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(pickImageFile).toHaveBeenCalledTimes(1));
        expect(select.value).toBe('__file__');
        expect(select.selectedOptions[0]?.textContent).toBe('current.webp');

        select.value = '__open__';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(pickImageFile).toHaveBeenCalledTimes(2));
        expect(select.value).toBe('__file__');
        expect(select.selectedOptions[0]?.textContent).toBe('current.webp');
        expect(onRemoteMutationFailure).toHaveBeenCalledWith('Unable to open image file: dialog unavailable');
    });

    it('keeps each native image picker single-flight until it settles', async () => {
        const container = document.createElement('div');
        let resolvePicker;
        const pickImageFile = vi.fn(() => new Promise((resolve) => {
            resolvePicker = resolve;
        }));
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar' },
            documentRef: document,
            getLoadedRuntime: () => ({ decodeImage: vi.fn() }),
            inputContainer: container,
            logEvent: vi.fn(),
            pickImageFile,
            registerVmControlBinding: vi.fn(),
            resolveControlAccessor: () => ({ value: null }),
        });

        const select = container.querySelector('.vm-image-asset-select');
        const openOption = select.querySelector('option[value="__open__"]');
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));

        expect(pickImageFile).toHaveBeenCalledOnce();
        expect(openOption.disabled).toBe(true);
        expect(select.getAttribute('aria-busy')).toBe('true');

        resolvePicker(null);
        await vi.waitFor(() => expect(select.hasAttribute('aria-busy')).toBe(false));
        expect(openOption.disabled).toBe(false);
    });

    it('accepts the canonical image ACK when focus returns from the native picker', async () => {
        const container = document.createElement('div');
        const bindings = [];
        const mutations = [];
        let resolvePicker;
        const pickImageFile = vi.fn(() => new Promise((resolve) => {
            resolvePicker = resolve;
        }));
        const listener = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', listener);
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' },
            documentRef: document,
            getLoadedRuntime: () => null,
            inputContainer: container,
            isAuthoritativeChildMode: true,
            logEvent: vi.fn(),
            pickImageFile,
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => ({ value: null }),
        });

        const select = container.querySelector('.vm-image-asset-select');
        select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));
        // Native selects may emit a trailing click after change. It must not
        // reopen the guard and trap the authoritative image ACK.
        select.dispatchEvent(new Event('click', { bubbles: true }));
        select.dispatchEvent(new Event('focus'));
        expect(bindings[0].isInteractionActive()).toBe(false);
        bindings[0].syncImageSelection(null);
        resolvePicker({ bytes: [7, 8, 9], name: 'replacement.webp' });
        await vi.waitFor(() => expect(mutations).toHaveLength(1));

        // macOS may deliver blur/focus around the sheet closing before the
        // authoritative child publishes its confirmed image metadata.
        select.dispatchEvent(new Event('blur'));
        select.dispatchEvent(new Event('focus'));
        bindings[0].syncImageSelection({ kind: 'file', label: 'replacement.webp' });

        expect(bindings[0].isInteractionActive()).toBe(false);
        expect(select.value).toBe('__file__');
        expect(select.selectedOptions[0]?.textContent).toBe('replacement.webp');
        document.removeEventListener('rav:vm-control-mutated', listener);
    });

    it('restores acknowledged embedded and file image selections after a control rerender', () => {
        const container = document.createElement('div');
        const bindings = [];
        appendVmImageControl({
            descriptor: {
                kind: 'image',
                metadata: { kind: 'embedded', key: 'funkos_9', label: 'funkos_9' },
                name: 'main_im',
                path: 'main_im',
            },
            documentRef: document,
            getEmbeddedImageAssets: () => [
                { key: 'other', name: 'other', bytes: new Uint8Array([1]) },
                { key: 'funkos_9', name: 'funkos_9', bytes: new Uint8Array([2]) },
            ],
            getLoadedRuntime: () => null,
            inputContainer: container,
            logEvent: vi.fn(),
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => ({ value: null }),
        });

        const select = container.querySelector('.vm-image-asset-select');
        expect(select.value).toBe('embedded:1');
        bindings[0].syncImageSelection({ kind: 'file', label: 'portrait.png' });
        expect(select.value).toBe('__file__');
        expect(select.selectedOptions[0].textContent).toBe('portrait.png');
        bindings[0].syncImageSelection(null);
        expect(select.value).toBe('');
        expect(select.querySelector('option[data-image-file-option]')).toBeNull();
    });

    it('defers canonical image-selector updates while its native popup is active', () => {
        const container = document.createElement('div');
        const bindings = [];
        appendVmImageControl({
            descriptor: {
                kind: 'image',
                metadata: { kind: 'embedded', key: 'asset-a', label: 'A' },
                name: 'avatar',
                path: 'avatar',
            },
            documentRef: document,
            getEmbeddedImageAssets: () => [
                { key: 'asset-a', name: 'A', bytes: new Uint8Array([1]) },
                { key: 'asset-b', name: 'B', bytes: new Uint8Array([2]) },
            ],
            getLoadedRuntime: () => null,
            inputContainer: container,
            logEvent: vi.fn(),
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => ({ value: null }),
        });

        const select = container.querySelector('.vm-image-asset-select');
        expect(select.value).toBe('embedded:0');
        select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(bindings[0].isInteractionActive()).toBe(true);

        bindings[0].syncImageSelection({ kind: 'embedded', key: 'asset-b', label: 'B' });
        expect(select.value).toBe('embedded:0');

        select.dispatchEvent(new Event('blur'));
        expect(bindings[0].isInteractionActive()).toBe(false);
        expect(select.value).toBe('embedded:1');
    });

    it('keeps the user image choice instead of a canonical tick deferred behind the popup', async () => {
        const container = document.createElement('div');
        const bindings = [];
        const mutations = [];
        const listener = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', listener);
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' },
            documentRef: document,
            getEmbeddedImageAssets: () => [
                { key: 'asset-a', name: 'A', bytes: new Uint8Array([1]) },
                { key: 'asset-b', name: 'B', bytes: new Uint8Array([2]) },
            ],
            getLoadedRuntime: () => null,
            inputContainer: container,
            isAuthoritativeChildMode: true,
            logEvent: vi.fn(),
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => ({ value: null }),
        });

        const select = container.querySelector('.vm-image-asset-select');
        select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        bindings[0].syncImageSelection({ kind: 'embedded', key: 'asset-a', label: 'A' });
        select.value = 'embedded:1';
        select.dispatchEvent(new Event('change'));

        await vi.waitFor(() => expect(mutations).toHaveLength(1));
        expect(select.value).toBe('');
        expect(mutations[0]).toEqual(expect.objectContaining({
            imageSelection: { kind: 'embedded', key: 'asset-b', label: 'B' },
            value: [2],
        }));
        bindings[0].syncImageSelection({ kind: 'embedded', key: 'asset-b', label: 'B' });
        expect(select.value).toBe('embedded:1');
        document.removeEventListener('rav:vm-control-mutated', listener);
    });

    it('keeps the last acknowledged image metadata while a remote set or clear awaits its child ACK', async () => {
        const container = document.createElement('div');
        const bindings = [];
        const mutations = [];
        const listener = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', listener);
        appendVmImageControl({
            descriptor: {
                kind: 'image',
                metadata: { kind: 'file', label: 'last-good.webp' },
                name: 'avatar',
                path: 'rows/0/avatar',
                source: 'view-model',
            },
            documentRef: document,
            getEmbeddedImageAssets: () => [
                { key: 'replacement', name: 'Replacement', bytes: new Uint8Array([7, 8, 9]) },
            ],
            getLoadedRuntime: () => null,
            inputContainer: container,
            isAuthoritativeChildMode: true,
            logEvent: vi.fn(),
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => ({ value: null }),
        });
        const select = container.querySelector('.vm-image-asset-select');
        expect(select.selectedOptions[0]?.textContent).toBe('last-good.webp');

        select.value = 'embedded:0';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(mutations).toHaveLength(1));
        expect(select.selectedOptions[0]?.textContent).toBe('last-good.webp');

        select.value = '__clear__';
        select.dispatchEvent(new Event('change'));
        expect(mutations).toHaveLength(2);
        expect(select.selectedOptions[0]?.textContent).toBe('last-good.webp');

        // A rejected command has no canonical delta, so the selector and its
        // nested identity remain exactly on the last applied child state.
        bindings[0].syncImageSelection({ kind: 'file', label: 'last-good.webp' });
        expect(select.selectedOptions[0]?.textContent).toBe('last-good.webp');
        expect(mutations.map((mutation) => mutation.descriptor.path)).toEqual([
            'rows/0/avatar',
            'rows/0/avatar',
        ]);
        document.removeEventListener('rav:vm-control-mutated', listener);
    });

    it('keeps the most recently selected image when decodes resolve out of order', async () => {
        const accessor = { value: null };
        const container = document.createElement('div');
        const pending = [];
        const decodeImage = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar' },
            documentRef: document,
            getEmbeddedImageAssets: () => [
                { name: 'A', bytes: new Uint8Array([1]) },
                { name: 'B', bytes: new Uint8Array([2]) },
            ],
            getLoadedRuntime: () => ({ decodeImage }),
            inputContainer: container,
            logEvent: vi.fn(),
            registerVmControlBinding: vi.fn(),
            resolveControlAccessor: () => accessor,
        });
        const select = container.querySelector('.vm-image-asset-select');
        select.value = 'embedded:0';
        select.dispatchEvent(new Event('change'));
        select.value = 'embedded:1';
        select.dispatchEvent(new Event('change'));

        const imageA = { unref: vi.fn() };
        const imageB = { unref: vi.fn() };
        pending[1](imageB);
        await vi.waitFor(() => expect(accessor.value).toBe(imageB));
        pending[0](imageA);
        await vi.waitFor(() => expect(imageA.unref).toHaveBeenCalledOnce());
        expect(accessor.value).toBe(imageB);
    });

    it('ignores a deferred native picker result from a prior VM-control render', async () => {
        const elements = createVmElements();
        const accessor = { value: null };
        const pickerResolvers = [];
        const imageA = { unref: vi.fn() };
        const imageB = { unref: vi.fn() };
        const decodeImage = vi.fn(async (bytes) => (bytes[0] === 2 ? imageB : imageA));
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn(), logEvent: vi.fn() },
            elements,
            getLoadedRuntime: () => ({ decodeImage }),
            getRiveInstance: () => ({
                stateMachineNames: [],
                viewModelInstance: {
                    image: (name) => (name === 'avatar' ? accessor : null),
                    properties: [{ name: 'avatar' }],
                },
            }),
            pickImageFile: vi.fn(() => new Promise((resolve) => pickerResolvers.push(resolve))),
            setIntervalFn: vi.fn(() => 'image-control-timer'),
        });

        controller.renderVmInputControls();
        let select = elements.vmControlsTree.querySelector('.vm-image-asset-select');
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(pickerResolvers).toHaveLength(1));

        controller.renderVmInputControls();
        select = elements.vmControlsTree.querySelector('.vm-image-asset-select');
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(pickerResolvers).toHaveLength(2));

        pickerResolvers[1]({ bytes: [2], name: 'new.png' });
        await vi.waitFor(() => expect(accessor.value).toBe(imageB));
        pickerResolvers[0]({ bytes: [1], name: 'stale.png' });
        await Promise.resolve();

        expect(accessor.value).toBe(imageB);
        expect(decodeImage).toHaveBeenCalledTimes(1);
        expect(select.value).toBe('__file__');
        expect(select.selectedOptions[0]?.textContent).toBe('new.png');
    });

    it('does not dispatch a stale authoritative picker result after its image control is disposed', async () => {
        const container = document.createElement('div');
        const bindings = [];
        const mutations = [];
        let resolvePicker;
        const onMutation = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', onMutation);
        appendVmImageControl({
            descriptor: { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' },
            documentRef: document,
            getLoadedRuntime: () => null,
            inputContainer: container,
            isAuthoritativeChildMode: true,
            logEvent: vi.fn(),
            pickImageFile: vi.fn(() => new Promise((resolve) => { resolvePicker = resolve; })),
            registerVmControlBinding: (_descriptor, binding) => bindings.push(binding),
            resolveControlAccessor: () => ({ value: null }),
        });
        const select = container.querySelector('.vm-image-asset-select');
        select.value = '__open__';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(resolvePicker).toBeTypeOf('function'));

        bindings[0].dispose();
        resolvePicker({ bytes: [1, 2, 3], name: 'stale.png' });
        await Promise.resolve();
        await Promise.resolve();

        expect(mutations).toEqual([]);
        expect(select.querySelector('option[data-image-file-option]')).toBeNull();
        document.removeEventListener('rav:vm-control-mutated', onMutation);
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

    it('keeps image descriptors in export snapshots without serializing runtime image objects', () => {
        const elements = createVmElements();
        const opaqueImage = { runtimeHandle: 42 };
        const imageAccessor = { value: opaqueImage };
        const rootVm = {
            image: (name) => (name === 'hero' ? imageAccessor : null),
            properties: [{ name: 'hero' }],
        };
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn(), logEvent: vi.fn() },
            clearIntervalFn: vi.fn(),
            elements,
            getCurrentRuntime: () => 'webgl2',
            getEmbeddedImageAssets: () => [],
            getLoadedRuntime: () => ({ decodeImage: vi.fn() }),
            getRiveInstance: () => ({ viewModelInstance: rootVm }),
            setIntervalFn: vi.fn(() => 'timer'),
        });

        controller.renderVmInputControls();

        expect(controller.captureVmControlSnapshot()).toEqual([{
            descriptor: expect.objectContaining({ kind: 'image', path: 'hero' }),
            enumValues: undefined,
            kind: 'image',
            value: null,
        }]);
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
        expect(harness.elements.vmControlsTree.textContent).toContain('Row 1');
        expect(harness.elements.vmControlsTree.textContent).toContain('Row 2');
        expect(findNumberInput('items/1/speed').value).toBe('24');
        expect(harness.callbacks.initLucideIcons).toHaveBeenCalledTimes(2);
        expect(harness.intervals).toHaveLength(1);

        harness.list.items.splice(0, harness.list.items.length);
        runVmSyncTicks(harness.intervals);

        expect(harness.elements.vmControlsCount.textContent).toBe('8');
        expect(harness.elements.vmControlsTree.textContent).not.toContain('items [');
        expect(harness.intervals).toHaveLength(1);

        harness.list.items.push(harness.list.createItem(7));
        runVmSyncTicks(harness.intervals);

        expect(harness.elements.vmControlsCount.textContent).toBe('9');
        expect(harness.elements.vmControlsTree.textContent).toContain('items [1]');
        expect(findNumberInput('items/0/speed').value).toBe('7');
    });

    it('pauses polling with the properties panel hidden and skips collapsed sections', () => {
        const harness = createVmHarness();
        harness.controller.renderVmInputControls();

        const rows = Array.from(harness.elements.vmControlsTree.querySelectorAll('.vm-control-row'));
        const countInput = rows
            .find((row) => row.querySelector('.vm-control-label')?.title === 'count')
            ?.querySelector('input[type="number"]');
        const childInput = rows
            .find((row) => row.querySelector('.vm-control-label')?.title === 'child/enabled')
            ?.querySelector('input[type="checkbox"]');

        harness.elements.mainGrid.classList.add('right-hidden');
        harness.accessors.rootNumber.value = 41;
        harness.intervals[0].callback();
        expect(countInput.value).toBe('3');

        harness.elements.mainGrid.classList.remove('right-hidden');
        harness.intervals[0].callback();
        expect(countInput.value).toBe('41');

        harness.accessors.childBoolean.value = true;
        harness.intervals[0].callback();
        expect(childInput.checked).toBe(false);

        const childSection = childInput.closest('details.vm-section');
        childSection.open = true;
        childSection.dispatchEvent(new Event('toggle'));
        harness.intervals[0].callback();
        expect(childInput.checked).toBe(true);
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
        runVmSyncTicks(intervals);
        expect(elements.vmControlsCount.textContent).toBe('0');
        expect(intervals).toHaveLength(1);

        listItems.push({
            number(name) {
                return name === 'value' ? { value: 15 } : null;
            },
            properties: [{ name: 'value' }],
        });
        runVmSyncTicks(intervals);

        expect(elements.vmControlsCount.textContent).toBe('1');
        expect(elements.vmControlsEmpty.hidden).toBe(true);
        expect(elements.vmControlsTree.textContent).toContain('items [1]');
        expect(elements.vmControlsTree.textContent).toContain('value (number)');
        expect(callbacks.initLucideIcons).toHaveBeenCalledTimes(1);

        listItems.length = 0;
        listLength = 0;
        runVmSyncTicks(intervals);

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
        runVmSyncTicks(intervals);

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
        runVmSyncTicks(harness.intervals);

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

    it('keeps named global ViewModels in independently collapsed, scoped trees', () => {
        const elements = createVmElements();
        const themeShared = { value: 1 };
        const sessionShared = { value: 2 };
        const rootShared = { value: 3 };
        const globals = {
            Session: {
                number: (name) => (name === 'shared' ? sessionShared : null),
                properties: [{ name: 'shared' }],
            },
            Theme: {
                number: (name) => (name === 'shared' ? themeShared : null),
                properties: [{ name: 'shared' }],
            },
        };
        const riveInstance = {
            globalViewModelInstance: vi.fn((name) => globals[name] || null),
            globalViewModelNames: vi.fn(() => ['Theme', 'Session']),
            stateMachineNames: [],
            viewModelInstance: {
                number: (name) => (name === 'shared' ? rootShared : null),
                properties: [{ name: 'shared' }],
            },
        };
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn(), logEvent: vi.fn() },
            elements,
            getRiveInstance: () => riveInstance,
            setIntervalFn: vi.fn(() => 'global-vm-timer'),
        });

        controller.renderVmInputControls();

        expect(elements.vmControlsCount.textContent).toBe('3');
        const globalSection = elements.vmControlsTree.firstElementChild;
        expect(globalSection.classList.contains('vm-global-view-models')).toBe(true);
        expect(globalSection.open).toBe(false);
        const globalChildren = Array.from(globalSection.querySelector(':scope > .vm-section-body').children)
            .filter((child) => child.matches('details.vm-section'));
        expect(globalChildren).toHaveLength(2);
        expect(globalChildren.every((section) => section.open === false)).toBe(true);

        globalSection.open = true;
        globalChildren[0].open = true;
        const globalInput = globalChildren[0].querySelector('input[type="number"]');
        globalInput.value = '10';
        globalInput.dispatchEvent(new Event('change'));
        expect(themeShared.value).toBe(10);
        expect(sessionShared.value).toBe(2);
        expect(rootShared.value).toBe(3);

        const snapshot = controller.captureVmControlSnapshot();
        expect(snapshot).toEqual(expect.arrayContaining([
            expect.objectContaining({
                descriptor: expect.objectContaining({ globalViewModelName: 'Theme', source: 'global-view-model' }),
            }),
            expect.objectContaining({
                descriptor: expect.objectContaining({ globalViewModelName: 'Session', source: 'global-view-model' }),
            }),
        ]));
        expect(new Set(snapshot.map((entry) => controlSnapshotKeyForDescriptor(entry.descriptor))).size)
            .toBe(snapshot.length);
        expect(controller.serializeControlHierarchy().children[0]).toMatchObject({
            kind: 'global-view-models',
            label: 'Global ViewModels',
        });
    });
});
