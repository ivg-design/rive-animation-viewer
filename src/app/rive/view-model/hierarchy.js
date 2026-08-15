import {
    getStateMachineInputKind,
    getVmAccessor,
    getVmListItemAt,
    getVmListItemName,
    getVmListLength,
    safeVmMethodCall,
} from './accessors.js';

export function countAllInputs(node) {
    let total = node.inputs ? node.inputs.length : 0;
    if (node.children) {
        node.children.forEach((child) => {
            total += countAllInputs(child);
        });
    }
    return total;
}

export function formatVmListItemLabel(_listName, index, itemInstance = null, riveInstance = null) {
    const authoredName = getVmListItemName(itemInstance, riveInstance);
    if (authoredName) {
        return authoredName;
    }
    return `Row ${index + 1}`;
}

export function buildVmListTopologySignature(rootVm, riveInstance = null) {
    if (!rootVm || typeof rootVm !== 'object') {
        return null;
    }

    const activeInstances = new WeakSet();
    const topology = [];

    const walk = (instance, basePath) => {
        if (!instance || typeof instance !== 'object' || activeInstances.has(instance)) {
            return;
        }
        activeInstances.add(instance);

        const properties = Array.isArray(instance.properties) ? instance.properties : [];
        properties.forEach((property) => {
            const name = property?.name;
            if (typeof name !== 'string' || !name) {
                return;
            }

            const fullPath = basePath ? `${basePath}/${name}` : name;
            const nestedVm = safeVmMethodCall(instance, 'viewModelInstance', name)
                || safeVmMethodCall(instance, 'viewModel', name);
            if (nestedVm && nestedVm !== instance) {
                walk(nestedVm, fullPath);
            }

            const listAccessor = safeVmMethodCall(instance, 'list', name);
            if (!listAccessor) {
                return;
            }

            const listLength = getVmListLength(listAccessor);
            topology.push(['list', fullPath, listLength]);
            for (let index = 0; index < listLength; index += 1) {
                const itemInstance = getVmListItemAt(listAccessor, index);
                const itemPath = `${fullPath}/${index}`;
                topology.push([
                    'item',
                    itemPath,
                    Boolean(itemInstance),
                    itemInstance ? formatVmListItemLabel(name, index, itemInstance, riveInstance) : null,
                ]);
                if (itemInstance) {
                    walk(itemInstance, itemPath);
                }
            }
        });

        activeInstances.delete(instance);
    };

    walk(rootVm, '');
    return topology.length ? JSON.stringify(topology) : null;
}

export function buildVmHierarchy(rootVm, riveInstance = null) {
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
            if (accessorInfo && !seenInputPaths.has(fullPath)) {
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
                    listNode.children.push(walk(
                        itemInstance,
                        formatVmListItemLabel(name, index, itemInstance, riveInstance),
                        itemPath,
                        'instance',
                    ));
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

export function buildStateMachineHierarchy(riveInstance, runtime) {
    if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function') {
        return null;
    }

    const stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
    if (!stateMachineNames.length) {
        return null;
    }

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

export function stripNestedRootVmInputs(hierarchy) {
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
