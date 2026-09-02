import { normalizeControlSelectionKey } from '../../rive/vm-controls.js';

export function buildControlHierarchyTopologySignature(currentHierarchy) {
    const topology = [];
    const visit = (node, parentKey = '') => {
        if (!node) return;
        const nodeIdentity = `${parentKey}>${node.kind || ''}:${node.path || ''}:${node.label || ''}`;
        topology.push(['node', nodeIdentity]);
        (node.inputs || []).forEach((input) => {
            const descriptor = input?.descriptor || input || {};
            topology.push([
                'input',
                nodeIdentity,
                descriptor.source || input?.source || '',
                descriptor.stateMachineName || input?.stateMachineName || '',
                descriptor.path || input?.path || '',
                descriptor.name || input?.name || '',
                descriptor.kind || input?.kind || '',
            ]);
        });
        (node.children || []).forEach((child) => visit(child, nodeIdentity));
    };
    visit(currentHierarchy);
    return JSON.stringify(topology);
}

export function requestExportOverlayStateSync(documentRef) {
    const EventCtor = documentRef.defaultView?.CustomEvent || globalThis.CustomEvent;
    documentRef.dispatchEvent(new EventCtor('rav:ui-overlay-state-dirty', {
        detail: { purpose: 'export' },
    }));
}

export function configureInstantiationControls({ selection, packageSource, snippetMode } = {}, {
    clearPreview,
    currentAvailableKeys,
    documentRef,
    elements,
    ensureDialogState,
    getChangedControlKeySet,
    getSelectedControlKeys,
    getSnippetMode,
    isOverlayOpen,
    setSelection,
}) {
    if (!ensureDialogState()) throw new Error('Instantiation controls are not available');

    if (selection === 'changed') setSelection(getChangedControlKeySet());
    else if (selection === 'all') setSelection(new Set(currentAvailableKeys));
    else if (selection === 'none') setSelection(new Set());
    else if (Array.isArray(selection)) {
        const normalizedKeys = selection.map((key) => ({
            original: key,
            normalized: normalizeControlSelectionKey(key),
        }));
        const unmatchedKeys = normalizedKeys.filter(({ normalized }) => (
            !normalized || !currentAvailableKeys.has(normalized)
        ));
        if (unmatchedKeys.length) {
            throw new Error(`Unknown control selection key(s): ${unmatchedKeys
                .map(({ original }) => String(original))
                .join(', ')}`);
        }
        setSelection(new Set(normalizedKeys.map(({ normalized }) => normalized)));
    }

    if (packageSource !== undefined) {
        if (!['cdn', 'local'].includes(packageSource)) {
            throw new Error("packageSource must be 'cdn' or 'local'");
        }
        if (elements.instantiationPackageSourceSelect) {
            elements.instantiationPackageSourceSelect.value = packageSource;
        }
        clearPreview();
    }

    if (snippetMode !== undefined) {
        if (!['compact', 'scaffold'].includes(snippetMode)) {
            throw new Error("snippetMode must be 'compact' or 'scaffold'");
        }
        if (elements.instantiationSnippetModeSelect) {
            elements.instantiationSnippetModeSelect.value = snippetMode;
        }
        clearPreview();
    }

    if (isOverlayOpen()) requestExportOverlayStateSync(documentRef);
    return {
        availableControlKeys: Array.from(currentAvailableKeys),
        packageSource: elements.instantiationPackageSourceSelect?.value || 'cdn',
        selectedControlKeys: getSelectedControlKeys() || [],
        snippetMode: getSnippetMode(),
    };
}
