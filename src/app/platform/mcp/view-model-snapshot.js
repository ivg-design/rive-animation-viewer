import {
    getVmAccessor,
    getVmListItemAt,
    getVmListLength,
    safeVmMethodCall,
} from '../../rive/view-model/accessors.js';
import { formatVmListItemLabel } from '../../rive/view-model/hierarchy.js';

function readVmProperties(instance) {
    try {
        return Array.isArray(instance?.properties) ? instance.properties : [];
    } catch {
        return [];
    }
}

function readAccessorValue(accessor, kind) {
    if (kind === 'trigger') {
        return null;
    }

    try {
        return accessor.value;
    } catch {
        return null;
    }
}

export function buildViewModelSnapshot(windowRef = globalThis.window) {
    const inst = windowRef?.riveInst;
    const rootVm = inst?.viewModelInstance || null;

    if (!inst) {
        return {
            hasRoot: false,
            tree: null,
            paths: [],
            inputs: [],
            message: 'No animation loaded',
        };
    }

    if (!rootVm) {
        return {
            hasRoot: false,
            tree: null,
            paths: [],
            inputs: [],
            message: 'No ViewModel instance is currently bound',
        };
    }

    const activeInstances = new WeakSet();
    const inputs = [];
    const seenInputPaths = new Set();

    function walkVm(instance, label, basePath, kind = 'vm') {
        const node = {
            label,
            path: basePath,
            kind,
            inputs: [],
            children: [],
        };

        if (!instance || typeof instance !== 'object') {
            return node;
        }
        if (activeInstances.has(instance)) {
            node.circular = true;
            return node;
        }

        activeInstances.add(instance);
        try {
            for (const property of readVmProperties(instance)) {
                const name = property?.name;
                if (typeof name !== 'string' || !name) {
                    continue;
                }

                const fullPath = basePath ? `${basePath}/${name}` : name;
                const accessorInfo = getVmAccessor(instance, name);
                if (accessorInfo && !seenInputPaths.has(fullPath)) {
                    const input = {
                        name,
                        path: fullPath,
                        kind: accessorInfo.kind,
                        value: readAccessorValue(accessorInfo.accessor, accessorInfo.kind),
                    };
                    node.inputs.push(input);
                    inputs.push(input);
                    seenInputPaths.add(fullPath);
                }

                const nestedVm = safeVmMethodCall(instance, 'viewModelInstance', name)
                    || safeVmMethodCall(instance, 'viewModel', name);
                if (nestedVm) {
                    node.children.push(walkVm(nestedVm, name, fullPath, 'vm'));
                }

                const listAccessor = safeVmMethodCall(instance, 'list', name);
                if (listAccessor) {
                    const listLength = getVmListLength(listAccessor);
                    const listNode = {
                        label: `${name} [${listLength}]`,
                        path: fullPath,
                        kind: 'list',
                        inputs: [],
                        children: [],
                    };

                    for (let index = 0; index < listLength; index += 1) {
                        const itemInstance = getVmListItemAt(listAccessor, index);
                        if (!itemInstance) {
                            continue;
                        }
                        listNode.children.push(walkVm(
                            itemInstance,
                            formatVmListItemLabel(name, index, itemInstance),
                            `${fullPath}/${index}`,
                            'instance',
                        ));
                    }

                    node.children.push(listNode);
                }
            }
        } finally {
            activeInstances.delete(instance);
        }

        return node;
    }

    const rootLabel = rootVm.viewModelName || rootVm.name || 'Root VM';
    const tree = walkVm(rootVm, rootLabel, '');
    return {
        hasRoot: true,
        tree,
        paths: inputs.map((input) => input.path),
        inputs,
    };
}
