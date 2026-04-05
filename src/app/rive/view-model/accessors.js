const VM_ACCESSOR_PROBES = [
    ['number', 'number'],
    ['boolean', 'boolean'],
    ['string', 'string'],
    ['enum', 'enum'],
    ['color', 'color'],
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

        console.warn(`[rive-viewer] VM navigation failed at segment "${segment}" in path "${path}"`);
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
    return `vm:${descriptor.path || ''}:${descriptor.kind || ''}`;
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
