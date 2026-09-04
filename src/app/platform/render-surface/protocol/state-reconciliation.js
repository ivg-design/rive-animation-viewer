const SCALAR_CONTROL_KINDS = new Set(['boolean', 'color', 'enum', 'number', 'string']);

export function stateRevisionOf(state) {
    return Number(state?.stateRevision ?? state?.revision) || 0;
}

export function topologyRevisionOf(state, fallback = 0) {
    const revision = Number(state?.topologyRevision);
    return Number.isFinite(revision) && revision >= 0 ? revision : fallback;
}

function controlKey(input) {
    if (typeof input?.key === 'string' && input.key) return input.key;
    const descriptor = input?.descriptor && typeof input.descriptor === 'object' ? input.descriptor : input;
    const kind = input?.kind || descriptor?.kind || '';
    if (descriptor?.source === 'state-machine') {
        return `sm:${descriptor.stateMachineName || ''}:${descriptor.name || ''}:${kind}`;
    }
    if (descriptor?.source === 'global-view-model') {
        return `gvm:${encodeURIComponent(descriptor.globalViewModelName || '')}:${descriptor.path || ''}:${kind}`;
    }
    return descriptor?.path ? `vm:${descriptor.path}:${kind}` : null;
}

function indexControls(hierarchy) {
    const controls = new Map();
    const walk = (node) => {
        (node?.inputs || []).forEach((input) => {
            const key = controlKey(input);
            if (key) controls.set(key, input);
        });
        (node?.children || []).forEach(walk);
    };
    walk(hierarchy);
    return controls;
}

function applyControlChanges(controlIndex, changes) {
    const applied = [];
    (Array.isArray(changes) ? changes : []).forEach((change) => {
        const target = controlIndex.get(controlKey(change));
        if (!target) return;
        const kind = change?.kind || target.kind || target.descriptor?.kind;
        if (kind === 'enum' && (Object.hasOwn(change, 'value') || Array.isArray(change.values))) {
            if (Object.hasOwn(change, 'value')) target.value = change.value;
            if (Array.isArray(change.values)) target.values = change.values.filter((value) => typeof value === 'string');
        } else if (SCALAR_CONTROL_KINDS.has(kind) && Object.hasOwn(change, 'value')) {
            target.value = change.value;
        } else if (kind === 'image' && Object.hasOwn(change, 'present')) {
            target.present = Boolean(change.present);
            if (Object.hasOwn(change, 'metadata')) {
                target.metadata = change.metadata && typeof change.metadata === 'object' ? { ...change.metadata } : null;
            }
        } else if (kind === 'trigger') {
            const receipt = Number(change.receipt) || 0;
            if (receipt < (Number(target.receipt) || 0)) return;
            target.receipt = receipt;
        } else return;
        applied.push(change);
    });
    return applied;
}

export function bufferTopologyDelta(sessionBuffer, payload) {
    const topologyRevision = topologyRevisionOf(payload);
    const stateRevision = stateRevisionOf(payload);
    const buffered = sessionBuffer.get(topologyRevision) || {
        controlChanges: new Map(), latestPayload: null, latestRevision: -1,
    };
    if (stateRevision >= buffered.latestRevision) {
        buffered.latestPayload = { ...(buffered.latestPayload || {}), ...payload };
        buffered.latestRevision = stateRevision;
    }
    (payload.controlChanges || []).forEach((change) => {
        const key = controlKey(change);
        if (!key) return;
        const previous = buffered.controlChanges.get(key);
        if (!previous || stateRevision >= previous.stateRevision) {
            buffered.controlChanges.set(key, { change, stateRevision });
        }
    });
    sessionBuffer.set(topologyRevision, buffered);
}

export function materializeTopologyDelta(buffered) {
    if (!buffered?.latestPayload) return null;
    return {
        ...buffered.latestPayload,
        controlChanges: [...buffered.controlChanges.values()].map(({ change }) => change),
        revision: buffered.latestRevision,
        stateRevision: buffered.latestRevision,
    };
}

export function reconcileRenderSurfaceState(record, payload) {
    if (!payload || typeof payload !== 'object') return record;
    const current = record?.canonical || null;
    const nextStateRevision = stateRevisionOf(payload);
    const currentStateRevision = stateRevisionOf(current);
    if (current && nextStateRevision <= currentStateRevision) return record;
    const currentTopologyRevision = topologyRevisionOf(current);
    const nextTopologyRevision = topologyRevisionOf(payload, currentTopologyRevision);
    if (current && nextTopologyRevision < currentTopologyRevision) return record;
    const hasHierarchy = Boolean(payload.controlsHierarchy && typeof payload.controlsHierarchy === 'object');
    const isDelta = payload.stateType === 'delta' || (!hasHierarchy && Array.isArray(payload.controlChanges));
    if (isDelta && (!current || nextTopologyRevision !== currentTopologyRevision)) return record;
    if (hasHierarchy || !current) {
        const canonical = { ...payload };
        delete canonical.stateType;
        delete canonical.controlChanges;
        Object.assign(canonical, {
            revision: nextStateRevision,
            stateRevision: nextStateRevision,
            topologyRevision: nextTopologyRevision,
        });
        return { canonical, controlIndex: indexControls(canonical.controlsHierarchy) };
    }
    const canonical = {
        ...current,
        ...payload,
        controlChanges: applyControlChanges(record.controlIndex, payload.controlChanges),
        controlsHierarchy: current.controlsHierarchy,
        revision: nextStateRevision,
        stateRevision: nextStateRevision,
        topologyRevision: nextTopologyRevision,
    };
    delete canonical.stateType;
    return { ...record, canonical };
}
