import { controlSnapshotKeyForDescriptor } from '../accessors.js';

function normalizeRemoteInput(input) {
    const descriptor = input?.descriptor && typeof input.descriptor === 'object'
        ? input.descriptor
        : input;
    const kind = input?.kind || descriptor?.kind;
    if (!descriptor || !kind) return null;
    return {
        kind,
        name: descriptor.name || input?.name || '',
        path: descriptor.path || input?.path || '',
        source: descriptor.source || input?.source,
        globalViewModelName: descriptor.globalViewModelName || input?.globalViewModelName,
        stateMachineName: descriptor.stateMachineName || input?.stateMachineName,
        value: input?.value,
        present: Boolean(input?.present),
        receipt: Number(input?.receipt) || 0,
        metadata: input?.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : null,
        values: Array.isArray(input?.values)
            ? [...input.values]
            : (Array.isArray(input?.enumValues)
                ? [...input.enumValues]
                : (Array.isArray(descriptor?.enumValues) ? [...descriptor.enumValues] : [])),
    };
}

function normalizeRemoteNode(node) {
    if (!node || typeof node !== 'object') return null;
    return {
        children: (node.children || []).map(normalizeRemoteNode).filter(Boolean),
        inputs: (node.inputs || []).map(normalizeRemoteInput).filter(Boolean),
        kind: node.kind || 'vm',
        label: node.label || '',
        path: node.path || '',
        source: node.source,
        globalViewModelName: node.globalViewModelName,
    };
}

function revisionOf(state) {
    return {
        sessionId: typeof state?.sessionId === 'string' && state.sessionId ? state.sessionId : null,
        state: Number(state?.stateRevision ?? state?.revision) || 0,
        topology: Number(state?.topologyRevision) || 0,
    };
}

function isOlderThan(next, current) {
    return next.state < current.state || next.topology < current.topology;
}

function isDifferentSession(next, current) {
    return next.sessionId !== current.sessionId && Boolean(next.sessionId || current.sessionId);
}

function applyRemoteControlChanges(controlsByKey, changes) {
    (Array.isArray(changes) ? changes : []).forEach((change) => {
        const key = typeof change?.key === 'string'
            ? change.key
            : controlSnapshotKeyForDescriptor(change);
        const control = controlsByKey.get(key);
        if (!control) return;
        if (Object.hasOwn(change, 'value')) control.value = change.value;
        if (control.kind === 'enum' && Array.isArray(change.values)) {
            control.values = change.values.filter((value) => typeof value === 'string');
        }
        if (Object.hasOwn(change, 'present')) control.present = Boolean(change.present);
        if (Object.hasOwn(change, 'receipt')) {
            control.receipt = Math.max(control.receipt || 0, Number(change.receipt) || 0);
        }
        if (Object.hasOwn(change, 'metadata')) {
            control.metadata = change.metadata && typeof change.metadata === 'object' ? { ...change.metadata } : null;
        }
    });
}

export function createRemoteControlsAdapter({
    getCanonicalState = () => null,
    getExpectedSessionId = () => getCanonicalState()?.sessionId || null,
} = {}) {
    let cachedHierarchy = null;
    let cachedRevision = null;
    let cachedState = null;
    let controlsByKey = new Map();
    const accessorsByKey = new Map();

    function rebuild(state) {
        if (state?.sessionId !== cachedState?.sessionId || state?.artboard !== cachedState?.artboard
            || state?.vmInstance?.key !== cachedState?.vmInstance?.key) accessorsByKey.clear();
        cachedState = state;
        cachedRevision = revisionOf(state);
        cachedHierarchy = normalizeRemoteNode(state?.controlsHierarchy);
        controlsByKey = new Map();
        const walk = (node) => {
            (node?.inputs || []).forEach((input) => {
                const key = controlSnapshotKeyForDescriptor(input);
                if (key) controlsByKey.set(key, input);
            });
            (node?.children || []).forEach(walk);
        };
        walk(cachedHierarchy);
    }

    function acceptCanonicalState(state) {
        const expected = getExpectedSessionId();
        if (state && expected && state.sessionId !== expected) return cachedState;
        if (!state) {
            if (cachedState !== null) rebuild(null);
            return null;
        }
        const nextRevision = revisionOf(state);
        if (cachedRevision && isDifferentSession(nextRevision, cachedRevision)) {
            rebuild(state);
            return cachedState;
        }
        if (cachedRevision && isOlderThan(nextRevision, cachedRevision)) {
            return cachedState;
        }
        if (cachedRevision
            && nextRevision.state === cachedRevision.state
            && nextRevision.topology === cachedRevision.topology) {
            return cachedState;
        }
        if (!cachedRevision || nextRevision.topology !== cachedRevision.topology) {
            rebuild(state);
        } else if (Array.isArray(state.controlChanges)) {
            applyRemoteControlChanges(controlsByKey, state.controlChanges);
            cachedState = state;
            cachedRevision = nextRevision;
        } else if (state.controlsHierarchy !== cachedState?.controlsHierarchy) {
            // Protocol-v2 children published complete snapshots before deltas were introduced.
            rebuild(state);
        } else {
            cachedState = state;
            cachedRevision = nextRevision;
        }
        return cachedState;
    }

    function refreshCache() {
        return acceptCanonicalState(getCanonicalState?.() || null);
    }

    function getControl(descriptor) {
        refreshCache();
        return controlsByKey.get(controlSnapshotKeyForDescriptor(descriptor)) || null;
    }

    function resolveAccessor(descriptor) {
        const key = controlSnapshotKeyForDescriptor(descriptor);
        if (!key || !getControl(descriptor)) return null;
        if (!accessorsByKey.has(key)) {
            const sessionId = cachedRevision?.sessionId;
            const artboard = cachedState?.artboard;
            const vmInstanceKey = cachedState?.vmInstance?.key;
            const capturedControl = () => {
                const control = getControl(descriptor);
                return cachedRevision?.sessionId === sessionId && cachedState?.artboard === artboard
                    && cachedState?.vmInstance?.key === vmInstanceKey ? control : null;
            };
            accessorsByKey.set(key, {
                get value() {
                    return capturedControl()?.value;
                },
                get values() {
                    return capturedControl()?.values || [];
                },
                get present() {
                    return Boolean(capturedControl()?.present);
                },
                get metadata() {
                    const metadata = capturedControl()?.metadata;
                    return metadata && typeof metadata === 'object' ? { ...metadata } : null;
                },
                get receipt() {
                    return Number(capturedControl()?.receipt) || 0;
                },
            });
        }
        return accessorsByKey.get(key);
    }

    return {
        acceptCanonicalState,
        getHierarchy: () => {
            refreshCache();
            return cachedHierarchy;
        },
        getRevision: () => {
            refreshCache();
            return cachedRevision || { state: 0, topology: 0 };
        },
        resolveAccessor,
    };
}

export { applyRemoteControlChanges, normalizeRemoteInput, normalizeRemoteNode };
