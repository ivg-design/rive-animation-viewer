const VM_ACCESSOR_PROBES = [
    ['number', 'number'],
    ['boolean', 'boolean'],
    ['string', 'string'],
    ['enum', 'enum'],
    ['color', 'color'],
    ['image', 'image'],
    ['trigger', 'trigger'],
];

export function safeVmMethodCall(target, methodName, ...args) {
    if (!target || typeof target[methodName] !== 'function') {
        return null;
    }

    try {
        const result = target[methodName](...args);
        return result === undefined ? null : result;
    } catch {
        return null;
    }
}

export function getVmListLength(listAccessor) {
    if (!listAccessor) {
        return 0;
    }
    if (typeof listAccessor.length === 'number') {
        return Math.max(0, Math.floor(listAccessor.length));
    }
    if (typeof listAccessor.size === 'number') {
        return Math.max(0, Math.floor(listAccessor.size));
    }
    return 0;
}

export function getVmListItemAt(listAccessor, index) {
    if (!listAccessor || typeof listAccessor.instanceAt !== 'function') {
        return null;
    }

    try {
        return listAccessor.instanceAt(index);
    } catch {
        return null;
    }
}

function readVmStringMember(target, propertyName) {
    if (!target || typeof target !== 'object') {
        return null;
    }

    let value;
    try {
        value = target[propertyName];
        if (typeof value === 'function') {
            value = value.call(target);
        }
    } catch {
        return null;
    }

    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getCanonicalVmInstanceNames(riveInstance, viewModelName) {
    const definition = safeVmMethodCall(riveInstance, 'viewModelByName', viewModelName);
    if (!definition) {
        return new Set();
    }

    let instanceNames;
    try {
        instanceNames = definition.instanceNames;
        if (typeof instanceNames === 'function') {
            instanceNames = instanceNames.call(definition);
        }
    } catch {
        instanceNames = null;
    }

    if (!Array.isArray(instanceNames)) {
        return new Set();
    }

    return new Set(instanceNames
        .filter((name) => typeof name === 'string' && name.trim())
        .map((name) => name.trim()));
}

function findCanonicalVmInstanceName(itemInstance, riveInstance) {
    const viewModelName = readVmStringMember(itemInstance, 'viewModelName');
    if (!viewModelName) {
        return null;
    }

    const canonicalNames = getCanonicalVmInstanceNames(riveInstance, viewModelName);
    if (!canonicalNames.size) {
        return null;
    }

    let properties;
    try {
        properties = Array.isArray(itemInstance.properties) ? itemInstance.properties : [];
    } catch {
        properties = [];
    }

    const matches = new Set();
    properties.forEach((property) => {
        const propertyName = typeof property?.name === 'string' ? property.name : null;
        if (!propertyName) {
            return;
        }

        const accessor = safeVmMethodCall(itemInstance, 'string', propertyName);
        const value = readVmStringMember(accessor, 'value');
        if (value && canonicalNames.has(value)) {
            matches.add(value);
        }
    });

    return matches.size === 1 ? [...matches][0] : null;
}

export function getVmListItemName(itemInstance, riveInstance = null) {
    if (!itemInstance || typeof itemInstance !== 'object') {
        return null;
    }

    for (const propertyName of ['instanceName', 'name']) {
        const value = readVmStringMember(itemInstance, propertyName);
        if (value) {
            return value;
        }
    }

    return findCanonicalVmInstanceName(itemInstance, riveInstance);
}

export function getVmAccessor(vmInstance, propertyName) {
    for (const [kind, methodName] of VM_ACCESSOR_PROBES) {
        const accessor = safeVmMethodCall(vmInstance, methodName, propertyName);
        if (accessor) {
            return { accessor, kind };
        }
    }

    return null;
}

export function navigateToVmInstance(rootVm, path) {
    if (!path) {
        return null;
    }
    if (!path.includes('/')) {
        return { instance: rootVm, propertyName: path };
    }

    const segments = path.split('/');
    const propertyName = segments.pop();
    let current = rootVm;
    let index = 0;

    while (index < segments.length && current) {
        const segment = segments[index];
        const directChild = safeVmMethodCall(current, 'viewModel', segment)
            || safeVmMethodCall(current, 'viewModelInstance', segment);

        if (directChild) {
            current = directChild;
            index += 1;
            continue;
        }

        if (index + 1 < segments.length) {
            const listAccessor = safeVmMethodCall(current, 'list', segment);
            const listIndex = parseInt(segments[index + 1], 10);
            if (listAccessor && !Number.isNaN(listIndex)) {
                const itemInstance = getVmListItemAt(listAccessor, listIndex);
                if (itemInstance) {
                    current = itemInstance;
                    index += 2;
                    continue;
                }
            }
        }

        return null;
    }

    return current ? { instance: current, propertyName } : null;
}

export function resolveVmRootInstance(riveInstance) {
    if (!riveInstance) {
        return null;
    }
    if (riveInstance.viewModelInstance) {
        return riveInstance.viewModelInstance;
    }

    try {
        const defaultViewModel = typeof riveInstance.defaultViewModel === 'function'
            ? riveInstance.defaultViewModel()
            : null;
        if (!defaultViewModel) {
            return null;
        }
        if (typeof defaultViewModel.defaultInstance === 'function') {
            return defaultViewModel.defaultInstance();
        }
        if (typeof defaultViewModel.instance === 'function') {
            return defaultViewModel.instance();
        }
    } catch (error) {
        console.warn('Unable to resolve default ViewModel instance', error);
    }

    return null;
}

export function getGlobalViewModelNames(riveInstance) {
    const names = safeVmMethodCall(riveInstance, 'globalViewModelNames');
    return Array.isArray(names)
        ? names.filter((name) => typeof name === 'string' && name.trim())
        : [];
}

export function resolveGlobalViewModelInstance(riveInstance, globalViewModelName) {
    if (typeof globalViewModelName !== 'string' || !globalViewModelName.trim()) {
        return null;
    }
    return safeVmMethodCall(riveInstance, 'globalViewModelInstance', globalViewModelName.trim());
}

export function getGlobalViewModelInstances(riveInstance) {
    return getGlobalViewModelNames(riveInstance).map((name) => ({
        instance: resolveGlobalViewModelInstance(riveInstance, name),
        name,
    }));
}

export function getStateMachineInputKind(input, runtime) {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const runtimeInputTypes = runtime?.StateMachineInputType;
    const inputType = typeof input.type === 'number' ? input.type : null;
    if (runtimeInputTypes && inputType !== null) {
        if (inputType === runtimeInputTypes.Boolean) {
            return 'boolean';
        }
        if (inputType === runtimeInputTypes.Number) {
            return 'number';
        }
        if (inputType === runtimeInputTypes.Trigger) {
            return 'trigger';
        }
    }

    const rawInputTypes = runtime?.SMIInput;
    if (rawInputTypes && inputType !== null) {
        if (inputType === rawInputTypes.bool) {
            return 'boolean';
        }
        if (inputType === rawInputTypes.number) {
            return 'number';
        }
        if (inputType === rawInputTypes.trigger) {
            return 'trigger';
        }
    }

    const constructorName = typeof input.constructor?.name === 'string'
        ? input.constructor.name.toLowerCase()
        : '';
    if (constructorName.includes('bool')) {
        return 'boolean';
    }
    if (constructorName.includes('number')) {
        return 'number';
    }
    if (constructorName.includes('trigger')) {
        return 'trigger';
    }

    if (typeof input.value === 'boolean') {
        return 'boolean';
    }
    if (typeof input.value === 'number') {
        return 'number';
    }
    if (typeof input.fire === 'function' && !('value' in input)) {
        return 'trigger';
    }
    return null;
}

export function controlSnapshotKeyForDescriptor(descriptor) {
    if (!descriptor) {
        return null;
    }
    if (descriptor.source === 'state-machine') {
        return `sm:${descriptor.stateMachineName || ''}:${descriptor.name || ''}:${descriptor.kind || ''}`;
    }
    if (descriptor.source === 'global-view-model') {
        return `gvm:${encodeURIComponent(descriptor.globalViewModelName || '')}:${descriptor.path || ''}:${descriptor.kind || ''}`;
    }
    return `vm:${descriptor.path || ''}:${descriptor.kind || ''}`;
}

export function controlSelectionKeyForDescriptor(descriptor) {
    if (!descriptor) {
        return null;
    }
    if (descriptor.source === 'state-machine') {
        return controlSnapshotKeyForDescriptor(descriptor);
    }

    return normalizeControlSelectionKey(controlSnapshotKeyForDescriptor(descriptor));
}

export function normalizeControlSelectionKey(key) {
    if (typeof key !== 'string') {
        return null;
    }
    const trimmed = key.trim();
    if (!trimmed.startsWith('vm:') && !trimmed.startsWith('gvm:')) {
        return trimmed || null;
    }
    const kindSeparator = trimmed.lastIndexOf(':');
    const pathStart = trimmed.startsWith('gvm:')
        ? trimmed.indexOf(':', 4) + 1
        : 3;
    if (kindSeparator <= pathStart) {
        return trimmed || null;
    }
    const path = trimmed.slice(pathStart, kindSeparator)
        .split('/')
        .map((segment) => (/^(0|[1-9]\d*)$/.test(segment) ? '*' : segment))
        .join('/');
    return `${trimmed.slice(0, pathStart)}${path}:${trimmed.slice(kindSeparator + 1)}`;
}

export function isControlDescriptorSelected(descriptor, selectedKeys) {
    if (!descriptor || !(selectedKeys instanceof Set)) {
        return false;
    }
    const exactKey = controlSnapshotKeyForDescriptor(descriptor);
    const selectionKey = controlSelectionKeyForDescriptor(descriptor);
    return Boolean(
        (exactKey && selectedKeys.has(exactKey))
        || (selectionKey && selectedKeys.has(selectionKey)),
    );
}

export function shouldResumePlaybackForTrigger(riveInstance) {
    if (!riveInstance) {
        return false;
    }
    if (typeof riveInstance.isPlaying === 'boolean') {
        return !riveInstance.isPlaying;
    }
    if (typeof riveInstance.isStopped === 'boolean') {
        return riveInstance.isStopped;
    }
    return true;
}
