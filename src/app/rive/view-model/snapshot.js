import {
    controlSnapshotKeyForDescriptor,
    resolveVmRootInstance,
} from './accessors.js';
import {
    buildVmHierarchy,
    stripNestedRootVmInputs,
} from './hierarchy.js';

function cloneSnapshotEntry(entry) {
    if (!entry?.descriptor) {
        return null;
    }
    return {
        descriptor: { ...entry.descriptor },
        enumValues: Array.isArray(entry.enumValues) ? [...entry.enumValues] : undefined,
        kind: entry.kind,
        value: entry.value,
    };
}

function serializeHierarchyNode(node, resolveControlAccessor) {
    const serializeNode = (currentNode) => ({
        children: (currentNode.children || []).map(serializeNode),
        inputs: (currentNode.inputs || []).map((input) => {
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
        kind: currentNode.kind,
        label: currentNode.label,
        path: currentNode.path,
    });

    return serializeNode(node);
}

export function createVmSnapshotController({
    buildStateMachineHierarchy,
    getBindings,
    getRiveInstance,
    resolveControlAccessor,
    syncVmControlBindings,
}) {
    let baselineVmControlSnapshot = [];

    function captureVmControlSnapshot() {
        const bindings = getBindings();
        if (!bindings.length) {
            return [];
        }

        const snapshot = [];
        const seen = new Set();
        bindings.forEach((binding) => {
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

    function serializeVmHierarchy() {
        const rootVm = resolveVmRootInstance(getRiveInstance());
        if (!rootVm) {
            return null;
        }

        const hierarchy = buildVmHierarchy(rootVm);
        if (!hierarchy) {
            return null;
        }

        return serializeHierarchyNode(stripNestedRootVmInputs(hierarchy), resolveControlAccessor);
    }

    function serializeControlHierarchy() {
        const rootVm = resolveVmRootInstance(getRiveInstance());
        const vmHierarchy = rootVm ? stripNestedRootVmInputs(buildVmHierarchy(rootVm)) : null;
        const stateMachineHierarchy = buildStateMachineHierarchy();
        const children = [];

        if (vmHierarchy && (vmHierarchy.inputs.length || vmHierarchy.children.length)) {
            children.push(serializeHierarchyNode(vmHierarchy, resolveControlAccessor));
        }

        if (stateMachineHierarchy?.children?.length) {
            stateMachineHierarchy.children.forEach((node) => {
                children.push(serializeHierarchyNode(node, resolveControlAccessor));
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
        getChangedVmControlSnapshot,
        serializeControlHierarchy,
        serializeVmHierarchy,
        setVmControlBaselineSnapshot,
    };
}
