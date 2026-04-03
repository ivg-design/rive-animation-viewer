export function createViewModelCommands({
    buildViewModelSnapshot,
    windowRef = globalThis.window,
} = {}) {
    function resolveVmPath(path, accessorKinds) {
        const inst = windowRef.riveInst;
        const vm = inst?.viewModelInstance;
        if (!vm) {
            throw new Error('No ViewModel available');
        }

        const parts = path.split('/');
        const propName = parts.pop();
        let current = vm;
        for (const segment of parts) {
            current = current.viewModelInstance?.(segment) || current.viewModel?.(segment);
            if (!current) {
                throw new Error(`Cannot navigate to "${segment}" in path "${path}"`);
            }
        }

        for (const kind of accessorKinds) {
            try {
                const accessor = current[kind]?.(propName);
                if (accessor !== undefined && accessor !== null) {
                    return { accessor, kind, propName };
                }
            } catch {
                /* wrong kind */
            }
        }

        return null;
    }

    return {
        async rav_get_vm_tree() {
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const snapshot = buildViewModelSnapshot(windowRef);
            return {
                tree: snapshot.tree,
                paths: snapshot.paths,
                inputs: snapshot.inputs,
                ...(snapshot.message ? { message: snapshot.message } : {}),
            };
        },

        async rav_vm_get({ path }) {
            if (!path) throw new Error('path is required');
            if (typeof windowRef.vmGet === 'function') {
                return { path, value: windowRef.vmGet(path) };
            }
            const resolved = resolveVmPath(path, ['number', 'boolean', 'string', 'enum', 'color']);
            if (!resolved) {
                throw new Error(`Property "${path.split('/').pop()}" not found or not readable`);
            }
            return { path, kind: resolved.kind, value: resolved.accessor.value };
        },

        async rav_vm_set({ path, value }) {
            if (!path) throw new Error('path is required');
            if (value === undefined) throw new Error('value is required');
            if (typeof windowRef.vmSet === 'function') {
                windowRef.vmSet(path, value);
                return { ok: true, path, value };
            }
            const resolved = resolveVmPath(path, ['number', 'boolean', 'string', 'enum', 'color']);
            if (!resolved) {
                throw new Error(`Property "${path.split('/').pop()}" not found or not writable`);
            }
            resolved.accessor.value = value;
            return { ok: true, path, kind: resolved.kind, value };
        },

        async rav_vm_fire({ path }) {
            if (!path) throw new Error('path is required');
            if (typeof windowRef.vmFire === 'function') {
                windowRef.vmFire(path);
                return { ok: true, path };
            }
            const resolved = resolveVmPath(path, ['trigger']);
            if (!resolved) {
                throw new Error(`Trigger "${path.split('/').pop()}" not found`);
            }
            if (typeof resolved.accessor.trigger === 'function') {
                resolved.accessor.trigger();
            } else if (typeof resolved.accessor.fire === 'function') {
                resolved.accessor.fire();
            }
            return { ok: true, path };
        },
    };
}
