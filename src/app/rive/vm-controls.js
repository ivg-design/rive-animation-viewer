import {
    VM_CONTROL_KINDS,
    VM_CONTROL_SYNC_INTERVAL_MS,
} from '../core/constants.js';

const VM_DEPTH_COLORS = [
    '#C4F82A',
    '#38BDF8',
    '#A78BFA',
    '#FB923C',
    '#F472B6',
    '#34D399',
];

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function toHexByte(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

export function argbToColorMeta(value) {
    const rawValue = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
    const alpha = (rawValue >>> 24) & 255;
    const red = (rawValue >>> 16) & 255;
    const green = (rawValue >>> 8) & 255;
    const blue = rawValue & 255;

    return {
        alphaPercent: Math.round((alpha / 255) * 100),
        hex: `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`,
    };
}

export function hexToRgb(hex) {
    const cleanHex = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
        return { r: 0, g: 0, b: 0 };
    }

    return {
        r: parseInt(cleanHex.slice(0, 2), 16),
        g: parseInt(cleanHex.slice(2, 4), 16),
        b: parseInt(cleanHex.slice(4, 6), 16),
    };
}

export function rgbAlphaToArgb(red, green, blue, alpha) {
    return (
        ((clamp(alpha, 0, 255) & 255) << 24)
        | ((clamp(red, 0, 255) & 255) << 16)
        | ((clamp(green, 0, 255) & 255) << 8)
        | (clamp(blue, 0, 255) & 255)
    ) >>> 0;
}

export function safeVmMethodCall(target, methodName, ...args) {
    if (!target || typeof target[methodName] !== 'function') {
        return null;
    }

    try {
        return target[methodName](...args) || null;
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
    const probes = [
        ['number', 'number'],
        ['boolean', 'boolean'],
        ['string', 'string'],
        ['enum', 'enum'],
        ['color', 'color'],
        ['trigger', 'trigger'],
    ];

    for (const [kind, methodName] of probes) {
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
    if (typeof input.fire === 'function') {
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

export function createVmControlsController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
    getCurrentRuntime = () => 'webgl2',
    getLoadedRuntime = () => null,
    getRiveInstance = () => null,
    clearIntervalFn = globalThis.clearInterval,
    setIntervalFn = globalThis.setInterval,
} = {}) {
    const {
        initLucideIcons = () => {},
        logEvent = () => {},
    } = callbacks;

    let vmControlBindings = [];
    let vmControlSyncTimer = null;
    let baselineVmControlSnapshot = [];

    function getDepthColor(depth) {
        return VM_DEPTH_COLORS[depth % VM_DEPTH_COLORS.length];
    }

    function countAllInputs(node) {
        let total = node.inputs ? node.inputs.length : 0;
        if (node.children) {
            node.children.forEach((child) => {
                total += countAllInputs(child);
            });
        }
        return total;
    }

    function clearVmControlBindings() {
        vmControlBindings = [];
    }

    function cloneSnapshotEntry(entry) {
        if (!entry?.descriptor) {
            return null;
        }
        return {
            descriptor: { ...entry.descriptor },
            kind: entry.kind,
            value: entry.value,
        };
    }

    function registerVmControlBinding(descriptor, binding) {
        if (!descriptor || !binding) {
            return;
        }
        vmControlBindings.push({
            descriptor: { ...descriptor },
            ...binding,
        });
    }

    function resolveVmAccessor(path, expectedKind) {
        const rootVm = resolveVmRootInstance(getRiveInstance());
        if (!rootVm) {
            return null;
        }

        const navigation = navigateToVmInstance(rootVm, path);
        if (!navigation) {
            return null;
        }

        const accessorInfo = getVmAccessor(navigation.instance, navigation.propertyName);
        if (!accessorInfo) {
            return null;
        }
        if (expectedKind && accessorInfo.kind !== expectedKind) {
            return null;
        }
        return accessorInfo.accessor;
    }

    function resolveStateMachineInputAccessor(stateMachineName, inputName, expectedKind) {
        const riveInstance = getRiveInstance();
        if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !stateMachineName || !inputName) {
            return null;
        }

        try {
            const inputs = riveInstance.stateMachineInputs(stateMachineName);
            if (!Array.isArray(inputs)) {
                return null;
            }

            const input = inputs.find((candidate) => candidate?.name === inputName);
            if (!input) {
                return null;
            }

            const runtime = getLoadedRuntime(getCurrentRuntime());
            const detectedKind = getStateMachineInputKind(input, runtime);
            if (expectedKind && detectedKind !== expectedKind) {
                return null;
            }

            return input;
        } catch {
            return null;
        }
    }

    function resolveControlAccessor(descriptor) {
        if (descriptor?.source === 'state-machine') {
            return resolveStateMachineInputAccessor(descriptor.stateMachineName, descriptor.name, descriptor.kind);
        }
        return resolveVmAccessor(descriptor.path, descriptor.kind);
    }

    function fireStateMachineTriggerByName(triggerName) {
        const riveInstance = getRiveInstance();
        if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !triggerName) {
            return 0;
        }

        const stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
        let firedCount = 0;

        stateMachineNames.forEach((stateMachineName) => {
            let inputs = [];
            try {
                const resolvedInputs = riveInstance.stateMachineInputs(stateMachineName);
                if (Array.isArray(resolvedInputs)) {
                    inputs = resolvedInputs;
                }
            } catch {
                inputs = [];
            }

            inputs.forEach((input) => {
                const runtime = getLoadedRuntime(getCurrentRuntime());
                if (!input || input.name !== triggerName || getStateMachineInputKind(input, runtime) !== 'trigger' || typeof input.fire !== 'function') {
                    return;
                }

                try {
                    input.fire();
                    firedCount += 1;
                } catch {
                    /* noop */
                }
            });
        });

        return firedCount;
    }

    function buildVmHierarchy(rootVm) {
        const seenInputPaths = new Set();
        const activeInstances = new WeakSet();
        let totalInputs = 0;

        const walk = (instance, label, basePath, kind = 'vm') => {
            const node = {
                children: [],
                inputs: [],
                kind,
                label,
                path: basePath || '<root>',
            };

            if (!instance || typeof instance !== 'object') {
                return node;
            }
            if (activeInstances.has(instance)) {
                return node;
            }
            activeInstances.add(instance);

            const properties = Array.isArray(instance.properties) ? instance.properties : [];
            properties.forEach((property) => {
                const name = property?.name;
                if (typeof name !== 'string' || !name) {
                    return;
                }

                const fullPath = basePath ? `${basePath}/${name}` : name;
                const accessorInfo = getVmAccessor(instance, name);
                if (accessorInfo && VM_CONTROL_KINDS.has(accessorInfo.kind) && !seenInputPaths.has(fullPath)) {
                    node.inputs.push({
                        kind: accessorInfo.kind,
                        name,
                        path: fullPath,
                    });
                    seenInputPaths.add(fullPath);
                    totalInputs += 1;
                }

                const nestedVm = safeVmMethodCall(instance, 'viewModelInstance', name)
                    || safeVmMethodCall(instance, 'viewModel', name);
                if (nestedVm && nestedVm !== instance) {
                    node.children.push(walk(nestedVm, name, fullPath, 'vm'));
                }

                const listAccessor = safeVmMethodCall(instance, 'list', name);
                const listLength = getVmListLength(listAccessor);
                if (listLength > 0) {
                    const listNode = {
                        children: [],
                        inputs: [],
                        kind: 'list',
                        label: `${name} [${listLength}]`,
                        path: fullPath,
                    };
                    for (let index = 0; index < listLength; index += 1) {
                        const itemInstance = getVmListItemAt(listAccessor, index);
                        if (!itemInstance) {
                            continue;
                        }
                        const itemPath = `${fullPath}/${index}`;
                        listNode.children.push(walk(itemInstance, `Instance ${index}`, itemPath, 'instance'));
                    }
                    node.children.push(listNode);
                }
            });

            activeInstances.delete(instance);
            return node;
        };

        const vmName = rootVm.viewModelName || rootVm.name || 'Root VM';
        const rootNode = walk(rootVm, vmName, '', 'vm');
        rootNode.totalInputs = totalInputs;
        return rootNode;
    }

    function buildStateMachineHierarchy() {
        const riveInstance = getRiveInstance();
        if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function') {
            return null;
        }

        const stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
        if (!stateMachineNames.length) {
            return null;
        }

        const runtime = getLoadedRuntime(getCurrentRuntime());
        const rootNode = {
            children: [],
            inputs: [],
            kind: 'state-machines',
            label: 'State Machines',
            path: '__state_machines__',
            totalInputs: 0,
        };

        stateMachineNames.forEach((stateMachineName) => {
            let inputs = [];
            try {
                const resolved = riveInstance.stateMachineInputs(stateMachineName);
                if (Array.isArray(resolved)) {
                    inputs = resolved;
                }
            } catch {
                inputs = [];
            }

            const childNode = {
                children: [],
                inputs: [],
                kind: 'state-machine',
                label: stateMachineName,
                path: `stateMachine/${stateMachineName}`,
            };

            inputs.forEach((input) => {
                const inputKind = getStateMachineInputKind(input, runtime);
                const inputName = typeof input?.name === 'string' && input.name ? input.name : null;
                if (!inputKind || !inputName) {
                    return;
                }

                childNode.inputs.push({
                    kind: inputKind,
                    name: inputName,
                    path: `stateMachine/${stateMachineName}/${inputName}`,
                    source: 'state-machine',
                    stateMachineName,
                });
                rootNode.totalInputs += 1;
            });

            if (childNode.inputs.length) {
                rootNode.children.push(childNode);
            }
        });

        return rootNode.totalInputs > 0 ? rootNode : null;
    }

    function updateStringInputRows(input, value) {
        if (!input || typeof input.rows !== 'number') {
            return;
        }
        const text = typeof value === 'string' ? value : '';
        input.rows = /\r\n|\r|\n/.test(text) ? 2 : 1;
    }

    function isEditingControl(element) {
        return documentRef.activeElement === element;
    }

    function syncVmControlBindings(force = false) {
        if (!vmControlBindings.length) {
            return;
        }

        vmControlBindings.forEach((binding) => {
            const accessor = resolveControlAccessor(binding.descriptor);
            const canEdit = Boolean(accessor);

            if (binding.input) {
                binding.input.disabled = !canEdit;
            }
            if (binding.colorInput) {
                binding.colorInput.disabled = !canEdit;
            }
            if (binding.alphaInput) {
                binding.alphaInput.disabled = !canEdit;
            }
            if (!canEdit) {
                return;
            }

            if (binding.kind === 'number') {
                const value = Number(accessor.value);
                if (!Number.isFinite(value)) {
                    return;
                }
                if (!force && isEditingControl(binding.input)) {
                    return;
                }
                const nextValue = String(value);
                if (binding.input.value !== nextValue) {
                    binding.input.value = nextValue;
                }
                return;
            }

            if (binding.kind === 'boolean') {
                const nextValue = Boolean(accessor.value);
                if (binding.input.checked !== nextValue) {
                    binding.input.checked = nextValue;
                }
                return;
            }

            if (binding.kind === 'string') {
                const nextValue = typeof accessor.value === 'string' ? accessor.value : '';
                if (!force && isEditingControl(binding.input)) {
                    updateStringInputRows(binding.input, binding.input.value);
                    return;
                }
                if (binding.input.value !== nextValue) {
                    binding.input.value = nextValue;
                }
                updateStringInputRows(binding.input, nextValue);
                return;
            }

            if (binding.kind === 'enum') {
                const nextValue = typeof accessor.value === 'string' ? accessor.value : '';
                if (binding.input.value !== nextValue) {
                    binding.input.value = nextValue;
                }
                return;
            }

            if (binding.kind === 'color') {
                const meta = argbToColorMeta(accessor.value);
                if (!force && (isEditingControl(binding.colorInput) || isEditingControl(binding.alphaInput))) {
                    return;
                }
                if (binding.colorInput.value !== meta.hex) {
                    binding.colorInput.value = meta.hex;
                }
                const nextAlpha = String(meta.alphaPercent);
                if (binding.alphaInput.value !== nextAlpha) {
                    binding.alphaInput.value = nextAlpha;
                }
            }
        });
    }

    function stopVmControlSync() {
        if (vmControlSyncTimer) {
            clearIntervalFn(vmControlSyncTimer);
            vmControlSyncTimer = null;
        }
    }

    function startVmControlSync() {
        if (vmControlSyncTimer || !vmControlBindings.length) {
            return;
        }
        vmControlSyncTimer = setIntervalFn(() => {
            syncVmControlBindings(false);
        }, VM_CONTROL_SYNC_INTERVAL_MS);
    }

    function createVmControlRow(descriptor) {
        const row = documentRef.createElement('div');
        row.className = 'vm-control-row';

        const label = documentRef.createElement('div');
        label.className = 'vm-control-label';
        label.textContent = `${descriptor.name} (${descriptor.kind})`;
        label.title = descriptor.path;

        const inputContainer = documentRef.createElement('div');
        inputContainer.className = 'vm-control-input';

        const accessor = resolveControlAccessor(descriptor);
        const isDisabled = !accessor;

        if (descriptor.kind === 'number') {
            const numberInput = documentRef.createElement('input');
            numberInput.type = 'number';
            numberInput.step = 'any';
            numberInput.value = Number.isFinite(accessor?.value) ? String(accessor.value) : '0';
            numberInput.disabled = isDisabled;
            numberInput.addEventListener('change', () => {
                const nextValue = Number(numberInput.value);
                if (!Number.isFinite(nextValue)) {
                    return;
                }
                const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'number' });
                if (liveAccessor) {
                    liveAccessor.value = nextValue;
                    const source = descriptor.source === 'state-machine' ? 'sm-number' : 'vm-number';
                    logEvent('ui', source, `Set ${descriptor.path} = ${nextValue}`);
                }
            });
            registerVmControlBinding(descriptor, {
                input: numberInput,
                kind: 'number',
            });
            inputContainer.appendChild(numberInput);
        } else if (descriptor.kind === 'boolean') {
            const checkbox = documentRef.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = Boolean(accessor?.value);
            checkbox.disabled = isDisabled;
            checkbox.addEventListener('change', () => {
                const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'boolean' });
                if (liveAccessor) {
                    liveAccessor.value = checkbox.checked;
                    const source = descriptor.source === 'state-machine' ? 'sm-boolean' : 'vm-boolean';
                    logEvent('ui', source, `Set ${descriptor.path} = ${checkbox.checked}`);
                }
            });
            registerVmControlBinding(descriptor, {
                input: checkbox,
                kind: 'boolean',
            });
            inputContainer.appendChild(checkbox);
        } else if (descriptor.kind === 'string') {
            const textInput = documentRef.createElement('textarea');
            textInput.value = typeof accessor?.value === 'string' ? accessor.value : '';
            updateStringInputRows(textInput, textInput.value);
            textInput.disabled = isDisabled;
            textInput.addEventListener('input', () => {
                updateStringInputRows(textInput, textInput.value);
            });
            textInput.addEventListener('change', () => {
                const liveAccessor = resolveVmAccessor(descriptor.path, 'string');
                if (liveAccessor) {
                    liveAccessor.value = textInput.value;
                    logEvent('ui', 'vm-string', `Set ${descriptor.path} = ${textInput.value}`);
                }
            });
            registerVmControlBinding(descriptor, {
                input: textInput,
                kind: 'string',
            });
            inputContainer.appendChild(textInput);
        } else if (descriptor.kind === 'enum') {
            const select = documentRef.createElement('select');
            const values = Array.isArray(accessor?.values) ? accessor.values : [];
            values.forEach((value) => {
                const option = documentRef.createElement('option');
                option.value = value;
                option.textContent = value;
                select.appendChild(option);
            });
            if (!values.length) {
                const fallback = documentRef.createElement('option');
                fallback.value = '';
                fallback.textContent = '(no enum values)';
                select.appendChild(fallback);
            }
            if (typeof accessor?.value === 'string') {
                select.value = accessor.value;
            }
            select.disabled = isDisabled || values.length === 0;
            select.addEventListener('change', () => {
                const liveAccessor = resolveVmAccessor(descriptor.path, 'enum');
                if (liveAccessor) {
                    liveAccessor.value = select.value;
                    logEvent('ui', 'vm-enum', `Set ${descriptor.path} = ${select.value}`);
                }
            });
            registerVmControlBinding(descriptor, {
                input: select,
                kind: 'enum',
            });
            inputContainer.appendChild(select);
        } else if (descriptor.kind === 'color') {
            const colorWrap = documentRef.createElement('div');
            colorWrap.className = 'vm-color-control';

            const colorInput = documentRef.createElement('input');
            colorInput.type = 'color';
            const alphaInput = documentRef.createElement('input');
            alphaInput.type = 'number';
            alphaInput.min = '0';
            alphaInput.max = '100';
            alphaInput.step = '1';

            const colorMeta = argbToColorMeta(accessor?.value);
            colorInput.value = colorMeta.hex;
            alphaInput.value = String(colorMeta.alphaPercent);
            colorInput.disabled = isDisabled;
            alphaInput.disabled = isDisabled;

            const applyColor = () => {
                const liveAccessor = resolveVmAccessor(descriptor.path, 'color');
                if (!liveAccessor) {
                    return;
                }
                const rgb = hexToRgb(colorInput.value);
                const alphaPercent = clamp(Number(alphaInput.value), 0, 100);
                alphaInput.value = String(Math.round(alphaPercent));
                const alpha = Math.round((alphaPercent / 100) * 255);
                if (typeof liveAccessor.argb === 'function') {
                    liveAccessor.argb(alpha, rgb.r, rgb.g, rgb.b);
                    logEvent('ui', 'vm-color', `Set ${descriptor.path} color to ${colorInput.value} (${alphaPercent}%).`);
                    return;
                }
                liveAccessor.value = rgbAlphaToArgb(rgb.r, rgb.g, rgb.b, alpha);
                logEvent('ui', 'vm-color', `Set ${descriptor.path} color to ${colorInput.value} (${alphaPercent}%).`);
            };

            colorInput.addEventListener('input', applyColor);
            alphaInput.addEventListener('change', applyColor);
            registerVmControlBinding(descriptor, {
                alphaInput,
                colorInput,
                kind: 'color',
            });

            colorWrap.appendChild(colorInput);
            colorWrap.appendChild(alphaInput);
            inputContainer.appendChild(colorWrap);
        } else if (descriptor.kind === 'trigger') {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.textContent = 'Fire';
            button.disabled = isDisabled;
            button.addEventListener('click', () => {
                const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'trigger' });
                const riveInstance = getRiveInstance();
                if (riveInstance?.isPaused) {
                    riveInstance.play();
                }

                let firedVmTrigger = false;
                let firedStateMachineCount = 0;
                if (liveAccessor && typeof liveAccessor.trigger === 'function') {
                    liveAccessor.trigger();
                    firedVmTrigger = true;
                } else if (liveAccessor && typeof liveAccessor.fire === 'function') {
                    liveAccessor.fire();
                    firedVmTrigger = true;
                }

                if (descriptor.source !== 'state-machine') {
                    firedStateMachineCount = fireStateMachineTriggerByName(descriptor.name);
                }
                if (firedVmTrigger || firedStateMachineCount > 0) {
                    const suffix = firedStateMachineCount > 0 ? ` (+${firedStateMachineCount} state machine trigger matches)` : '';
                    const source = descriptor.source === 'state-machine' ? 'sm-trigger' : 'vm-trigger';
                    logEvent('ui', source, `Fired trigger ${descriptor.path}${suffix}`);
                } else {
                    const source = descriptor.source === 'state-machine' ? 'sm-trigger-miss' : 'vm-trigger-miss';
                    logEvent('ui', source, `No trigger accessor or state machine trigger matched ${descriptor.path}`);
                }
            });
            registerVmControlBinding(descriptor, {
                button,
                kind: 'trigger',
            });
            inputContainer.appendChild(button);
        }

        row.appendChild(label);
        row.appendChild(inputContainer);
        return row;
    }

    function createVmSectionElement(node, isTopLevel = false, depth = 0) {
        const section = documentRef.createElement('details');
        section.className = 'vm-section';
        section.open = Boolean(isTopLevel);

        const depthColor = getDepthColor(depth);
        const summary = documentRef.createElement('summary');
        summary.className = 'vm-section-header';

        const sectionBar = documentRef.createElement('span');
        sectionBar.className = 'vm-section-bar';
        sectionBar.style.background = depthColor;

        const titleText = documentRef.createElement('span');
        titleText.textContent = node.label;

        const inputCountBadge = documentRef.createElement('span');
        inputCountBadge.className = 'vm-section-count';
        inputCountBadge.textContent = String(countAllInputs(node));

        const chevron = documentRef.createElement('i');
        chevron.setAttribute('data-lucide', 'chevron-down');
        chevron.className = 'lucide-12 vm-section-chevron';

        summary.appendChild(chevron);
        summary.appendChild(sectionBar);
        summary.appendChild(titleText);
        summary.appendChild(inputCountBadge);
        section.appendChild(summary);

        const body = documentRef.createElement('div');
        body.className = 'vm-section-body';
        body.dataset.depth = String(depth);
        body.style.setProperty('--depth-color', depthColor);

        if (node.inputs.length) {
            node.inputs.forEach((input) => {
                body.appendChild(createVmControlRow(input));
            });
        }

        if (node.children.length) {
            node.children.forEach((child) => {
                if (child.inputs.length || child.children.length) {
                    body.appendChild(createVmSectionElement(child, false, depth + 1));
                }
            });
        }

        if (!node.inputs.length && !node.children.length) {
            const emptyMessage = documentRef.createElement('p');
            emptyMessage.className = 'empty-state';
            emptyMessage.textContent = 'No controls.';
            body.appendChild(emptyMessage);
        }

        section.appendChild(body);
        return section;
    }

    function resetVmInputControls(message = 'No bound ViewModel inputs detected.') {
        const count = elements.vmControlsCount;
        const empty = elements.vmControlsEmpty;
        const tree = elements.vmControlsTree;
        if (!count || !empty || !tree) {
            return;
        }

        tree.innerHTML = '';
        count.textContent = '0';
        empty.hidden = false;
        empty.textContent = message;
        baselineVmControlSnapshot = [];
        clearVmControlBindings();
        stopVmControlSync();
    }

    function renderVmInputControls() {
        const count = elements.vmControlsCount;
        const empty = elements.vmControlsEmpty;
        const tree = elements.vmControlsTree;
        if (!count || !empty || !tree) {
            return;
        }

        tree.innerHTML = '';
        clearVmControlBindings();

        const rootVm = resolveVmRootInstance(getRiveInstance());
        const vmHierarchy = rootVm ? buildVmHierarchy(rootVm) : null;
        const stateMachineHierarchy = buildStateMachineHierarchy();

        const vmTotal = vmHierarchy?.totalInputs || 0;
        const stateMachineTotal = stateMachineHierarchy?.totalInputs || 0;
        const totalControls = vmTotal + stateMachineTotal;
        count.textContent = String(totalControls);

        if (!totalControls) {
            empty.hidden = false;
            empty.textContent = 'No writable ViewModel or state machine inputs were found.';
            stopVmControlSync();
            return;
        }

        empty.hidden = true;

        if (vmHierarchy) {
            if (vmHierarchy.children.length) {
                const childPaths = new Set();
                const collectChildPaths = (node) => {
                    if (node.inputs) {
                        node.inputs.forEach((input) => childPaths.add(input.path));
                    }
                    if (node.children) {
                        node.children.forEach(collectChildPaths);
                    }
                };
                vmHierarchy.children.forEach(collectChildPaths);
                vmHierarchy.inputs = vmHierarchy.inputs.filter((input) => !childPaths.has(input.path));
            }
            tree.appendChild(createVmSectionElement(vmHierarchy, true));
        }

        if (stateMachineHierarchy?.totalInputs) {
            stateMachineHierarchy.children.forEach((stateMachineNode) => {
                tree.appendChild(createVmSectionElement(stateMachineNode, false));
            });
        }

        startVmControlSync();
        syncVmControlBindings(true);
        initLucideIcons();
    }

    function captureVmControlSnapshot() {
        if (!vmControlBindings.length) {
            return [];
        }

        const snapshot = [];
        const seen = new Set();
        vmControlBindings.forEach((binding) => {
            if (!binding) {
                return;
            }

            const descriptor = binding.descriptor;
            const key = controlSnapshotKeyForDescriptor(descriptor);
            if (!key || seen.has(key)) {
                return;
            }

            const accessor = resolveControlAccessor(descriptor);
            if (!accessor || (binding.kind !== 'trigger' && !('value' in accessor))) {
                return;
            }

            let value = binding.kind === 'trigger' ? null : accessor.value;
            let enumValues = null;
            if (binding.kind === 'number') {
                const numericValue = Number(value);
                if (!Number.isFinite(numericValue)) {
                    return;
                }
                value = numericValue;
            } else if (binding.kind === 'boolean') {
                value = Boolean(value);
            } else if (binding.kind === 'string' || binding.kind === 'enum') {
                value = typeof value === 'string' ? value : String(value ?? '');
            } else if (binding.kind === 'color') {
                const numericColor = Number(value);
                if (!Number.isFinite(numericColor)) {
                    return;
                }
                value = numericColor >>> 0;
            } else if (binding.kind === 'trigger') {
                value = null;
            }

            if (binding.kind === 'enum' && Array.isArray(accessor.values)) {
                enumValues = accessor.values
                    .map((entry) => (entry == null ? '' : String(entry).trim()))
                    .filter((entry) => entry.length > 0);
            }

            seen.add(key);
            const snapshotEntry = {
                descriptor: { ...descriptor },
                kind: binding.kind,
                value,
            };
            if (enumValues?.length) {
                snapshotEntry.enumValues = enumValues;
            }
            snapshot.push(snapshotEntry);
        });

        return snapshot;
    }

    function setVmControlBaselineSnapshot(snapshot = captureVmControlSnapshot()) {
        baselineVmControlSnapshot = Array.isArray(snapshot)
            ? snapshot.map(cloneSnapshotEntry).filter(Boolean)
            : [];
        return baselineVmControlSnapshot.length;
    }

    function getChangedVmControlSnapshot(snapshot = captureVmControlSnapshot()) {
        const currentSnapshot = Array.isArray(snapshot)
            ? snapshot.map(cloneSnapshotEntry).filter(Boolean)
            : [];
        if (!baselineVmControlSnapshot.length) {
            return currentSnapshot;
        }

        const baselineByKey = new Map();
        baselineVmControlSnapshot.forEach((entry) => {
            const key = controlSnapshotKeyForDescriptor(entry?.descriptor);
            if (key) {
                baselineByKey.set(key, entry);
            }
        });

        return currentSnapshot.filter((entry) => {
            const key = controlSnapshotKeyForDescriptor(entry?.descriptor);
            if (!key) {
                return false;
            }
            const baselineEntry = baselineByKey.get(key);
            if (!baselineEntry) {
                return true;
            }
            return baselineEntry.kind !== entry.kind || baselineEntry.value !== entry.value;
        });
    }

    function applyVmControlSnapshot(snapshot) {
        if (!Array.isArray(snapshot) || !snapshot.length) {
            return 0;
        }

        let applied = 0;
        snapshot.forEach((entry) => {
            const descriptor = entry?.descriptor;
            const kind = entry?.kind || descriptor?.kind;
            if (!descriptor || kind === 'trigger') {
                return;
            }

            const accessor = resolveControlAccessor(descriptor);
            if (!accessor || !('value' in accessor)) {
                return;
            }

            try {
                if (kind === 'number') {
                    const nextValue = Number(entry.value);
                    if (Number.isFinite(nextValue)) {
                        accessor.value = nextValue;
                        applied += 1;
                    }
                    return;
                }
                if (kind === 'boolean') {
                    accessor.value = Boolean(entry.value);
                    applied += 1;
                    return;
                }
                if (kind === 'string' || kind === 'enum') {
                    accessor.value = typeof entry.value === 'string' ? entry.value : String(entry.value ?? '');
                    applied += 1;
                    return;
                }
                if (kind === 'color') {
                    const numericColor = Number(entry.value);
                    if (Number.isFinite(numericColor)) {
                        accessor.value = numericColor >>> 0;
                        applied += 1;
                    }
                }
            } catch {
                /* noop */
            }
        });

        syncVmControlBindings(true);
        return applied;
    }

    function stripNestedRootVmInputs(hierarchy) {
        if (!hierarchy?.children?.length) {
            return hierarchy;
        }

        const childPaths = new Set();
        const collectChildPaths = (node) => {
            if (node.inputs) {
                node.inputs.forEach((input) => childPaths.add(input.path));
            }
            if (node.children) {
                node.children.forEach(collectChildPaths);
            }
        };
        hierarchy.children.forEach(collectChildPaths);
        hierarchy.inputs = hierarchy.inputs.filter((input) => !childPaths.has(input.path));
        return hierarchy;
    }

    function serializeHierarchyNode(node) {
        const serializeNode = (node) => ({
            children: (node.children || []).map(serializeNode),
            inputs: (node.inputs || []).map((input) => {
                const descriptor = {
                    kind: input.kind,
                    name: input.name,
                    path: input.path,
                    source: input.source,
                    stateMachineName: input.stateMachineName,
                };
                let value = null;
                try {
                    const accessor = resolveControlAccessor(descriptor);
                    if (accessor && input.kind !== 'trigger') {
                        value = accessor.value;
                    }
                    if (accessor && input.kind === 'enum' && Array.isArray(accessor.values)) {
                        return {
                            descriptor,
                            enumValues: accessor.values,
                            kind: input.kind,
                            name: input.name,
                            path: input.path,
                            source: input.source,
                            stateMachineName: input.stateMachineName,
                            value,
                        };
                    }
                } catch {
                    /* noop */
                }

                return {
                    descriptor,
                    kind: input.kind,
                    name: input.name,
                    path: input.path,
                    source: input.source,
                    stateMachineName: input.stateMachineName,
                    value,
                };
            }),
            kind: node.kind,
            label: node.label,
            path: node.path,
        });

        return serializeNode(node);
    }

    function serializeVmHierarchy() {
        const rootVm = resolveVmRootInstance(getRiveInstance());
        if (!rootVm) {
            return null;
        }

        const hierarchy = buildVmHierarchy(rootVm);
        if (!hierarchy) {
            return null;
        }

        return serializeHierarchyNode(stripNestedRootVmInputs(hierarchy));
    }

    function serializeControlHierarchy() {
        const rootVm = resolveVmRootInstance(getRiveInstance());
        const vmHierarchy = rootVm ? stripNestedRootVmInputs(buildVmHierarchy(rootVm)) : null;
        const stateMachineHierarchy = buildStateMachineHierarchy();
        const children = [];

        if (vmHierarchy && (vmHierarchy.inputs.length || vmHierarchy.children.length)) {
            children.push(serializeHierarchyNode(vmHierarchy));
        }

        if (stateMachineHierarchy?.children?.length) {
            stateMachineHierarchy.children.forEach((node) => {
                children.push(serializeHierarchyNode(node));
            });
        }

        if (!children.length) {
            return null;
        }

        return {
            children,
            inputs: [],
            kind: 'controls',
            label: 'Controls',
            path: '__controls__',
        };
    }

    return {
        applyVmControlSnapshot,
        captureVmControlSnapshot,
        controlSnapshotKeyForDescriptor,
        getChangedVmControlSnapshot,
        renderVmInputControls,
        resetVmInputControls,
        serializeControlHierarchy,
        serializeVmHierarchy,
        setVmControlBaselineSnapshot,
        stopVmControlSync,
        syncVmControlBindings,
    };
}
