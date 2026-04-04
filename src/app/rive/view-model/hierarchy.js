import {
    getStateMachineInputKind,
    getVmAccessor,
    getVmListItemAt,
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

export function buildVmHierarchy(rootVm) {
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
