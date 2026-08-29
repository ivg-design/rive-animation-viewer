function disclosureKeyForNode(node) {
    const globalScope = node?.source === 'global-view-model'
        ? `gvm:${encodeURIComponent(node.globalViewModelName || '')}:`
        : '';
    return `${globalScope}${node?.kind || 'vm'}:${node?.path || '<unknown>'}`;
}

function disclosureTopologySignature(hierarchy) {
    const entries = [];
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        entries.push(`node:${disclosureKeyForNode(node)}`);
        (node.inputs || []).forEach((input) => {
            entries.push(`input:${input?.kind || 'unknown'}:${input?.path || input?.name || '<unknown>'}`);
        });
        (node.children || []).forEach(walk);
    };
    if (Array.isArray(hierarchy)) {
        hierarchy.forEach(walk);
    } else {
        walk(hierarchy);
    }
    return entries.join('|');
}

/**
 * Retains the tree's disclosure state only while both the playback identity
 * and the rendered control topology remain compatible. A canonical response
 * may advance its topology revision without changing its actual tree.
 */
export function createVmDisclosureState({
    getRemoteSessionId = () => null,
    isAuthoritativeChildMode = false,
} = {}) {
    let scope = null;
    const state = new Map();
    const localSourceIds = new WeakMap();
    let nextLocalSourceId = 1;

    function localSourceId(source) {
        if (!source || (typeof source !== 'object' && typeof source !== 'function')) {
            return null;
        }
        if (!localSourceIds.has(source)) {
            localSourceIds.set(source, nextLocalSourceId);
            nextLocalSourceId += 1;
        }
        return localSourceIds.get(source);
    }

    function scopeFor({ hierarchy, source = null } = {}) {
        const topology = disclosureTopologySignature(hierarchy);
        if (!topology) return null;
        if (isAuthoritativeChildMode) {
            // A child session is the file/playback boundary. Do not preserve
            // state with a legacy payload that cannot prove file identity.
            const sessionId = getRemoteSessionId();
            return sessionId ? `remote:${sessionId}:${topology}` : null;
        }
        const sourceId = localSourceId(source);
        return sourceId ? `local:${sourceId}:${topology}` : null;
    }

    function capture(tree) {
        if (!tree || !scope) return;
        tree.querySelectorAll('details.vm-section[data-vm-disclosure-key]').forEach((section) => {
            state.set(section.dataset.vmDisclosureKey, Boolean(section.open));
        });
    }

    function prepare(tree, context) {
        const nextScope = scopeFor(context);
        if (!nextScope || nextScope !== scope) {
            state.clear();
            scope = nextScope;
            return;
        }
        capture(tree);
    }

    return {
        clear() {
            scope = null;
            state.clear();
        },
        keyForNode: disclosureKeyForNode,
        openState: (node, isTopLevel) => {
            const key = disclosureKeyForNode(node);
            return state.has(key) ? state.get(key) : Boolean(isTopLevel);
        },
        prepare,
    };
}
