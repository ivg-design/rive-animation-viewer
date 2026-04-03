export function buildViewModelSnapshot(windowRef = globalThis.window) {
    const inst = windowRef?.riveInst;
    const directVm = inst?.viewModelInstance || null;

    if (windowRef?.vmTree) {
        return {
            hasRoot: Boolean(windowRef.vmRootInstance || directVm),
            tree: windowRef.vmTree,
            paths: windowRef.vmPaths || [],
            inputs: windowRef.vmInputs || [],
        };
    }

    if (!inst) {
        return {
            hasRoot: false,
            tree: null,
            paths: [],
            inputs: [],
            message: 'No animation loaded',
        };
    }

    if (!directVm) {
        return {
            hasRoot: false,
            tree: null,
            paths: [],
            inputs: [],
            message: 'No ViewModel bound — ensure autoBind: true',
        };
    }

    const accessorKinds = ['number', 'boolean', 'string', 'enum', 'color', 'trigger'];
    const inputs = [];

    function walkVm(instance, basePath) {
        const node = { label: basePath || 'root', path: basePath || '', inputs: [], children: [] };
        const props = instance.properties || [];

        for (const prop of props) {
            const name = prop?.name;
            if (!name) {
                continue;
            }
            const fullPath = basePath ? `${basePath}/${name}` : name;

            for (const kind of accessorKinds) {
                try {
                    const accessor = instance[kind]?.(name);
                    if (accessor !== undefined && accessor !== null) {
                        let value = null;
                        if (kind !== 'trigger') {
                            try {
                                value = accessor.value;
                            } catch {
                                value = null;
                            }
                        }
                        const entry = { name, path: fullPath, kind, value };
                        node.inputs.push(entry);
                        inputs.push(entry);
                        break;
                    }
                } catch {
                    /* accessor unavailable for kind */
                }
            }

            try {
                const nested = instance.viewModelInstance?.(name) || instance.viewModel?.(name);
                if (nested && nested !== instance && nested.properties) {
                    node.children.push(walkVm(nested, fullPath));
                }
            } catch {
                /* not a nested VM */
            }
        }

        return node;
    }

    const tree = walkVm(directVm, '');
    return {
        hasRoot: true,
        tree,
        paths: inputs.map((input) => input.path),
        inputs,
    };
}
