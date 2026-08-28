import { controlSelectionKeyForDescriptor } from '../rive/vm-controls.js';
import {
    collectNodeInputKeys,
    collectTreeNodeInputKeys,
    countConcreteControls,
    renderControlHierarchyTree,
    sanitizeSelection,
} from './export/control-tree.js';
import { measureDialogOverlay } from './overlay/dialog-bounds.js';

function buildControlHierarchyTopologySignature(currentHierarchy) {
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

export function createInstantiationControlsDialogController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
    captureVmControlSnapshot = () => [],
    getChangedVmControlSnapshot = () => [],
    serializeControlHierarchy = () => null,
    windowRef = globalThis.window,
} = {}) {
    const {
        createDemoBundle = async () => null,
        generateWebInstantiationCode = async () => ({ code: '' }),
        getCurrentFileName = () => null,
        getTauriInvoker = () => null,
        initLucideIcons = () => {},
        logEvent = () => {},
        requestUiOverlay = null,
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    let currentFileName = null;
    let currentHierarchy = null;
    let currentAvailableKeys = new Set();
    let selectedControlKeys = null;
    let currentPreviewText = '';
    let expandedBranchKeys = new Set();
    let hierarchyRevision = 0;
    let hierarchySignature = '';
    let overlayHierarchyRevision = null;
    let overlayOpen = false;
    let overlayTreeScrollTop = 0;
    function getDialog() {
        return elements.instantiationControlsDialog;
    }

    function getSelectedControlKeys() {
        return selectedControlKeys instanceof Set ? Array.from(selectedControlKeys) : null;
    }

    function getChangedControlKeySet() {
        return new Set(
            getChangedVmControlSnapshot()
                .map((entry) => controlSelectionKeyForDescriptor(entry?.descriptor))
                .filter(Boolean),
        );
    }

    function clearPreview() {
        currentPreviewText = '';
        if (elements.instantiationPreviewOutput) {
            elements.instantiationPreviewOutput.textContent = '// Generate a snippet to preview it here.';
        }
        if (elements.instantiationPreviewStatus) {
            elements.instantiationPreviewStatus.textContent = 'Snippet preview not generated yet.';
        }
        if (elements.copyInstantiationPreviewButton) {
            elements.copyInstantiationPreviewButton.disabled = true;
        }
    }

    function getSnippetMode() {
        const value = elements.instantiationSnippetModeSelect?.value;
        return value === 'scaffold' ? 'scaffold' : 'compact';
    }

    function renderPreview() {
        if (elements.instantiationPreviewOutput) {
            elements.instantiationPreviewOutput.textContent = currentPreviewText || '// Generate a snippet to preview it here.';
        }
        if (elements.instantiationPreviewStatus) {
            elements.instantiationPreviewStatus.textContent = currentPreviewText
                ? 'Snippet preview is ready.'
                : 'Snippet preview not generated yet.';
        }
        if (elements.copyInstantiationPreviewButton) {
            elements.copyInstantiationPreviewButton.disabled = !currentPreviewText;
        }
    }

    function updateSelectionSummary() {
        if (!elements.instantiationSelectionSummary) {
            return;
        }

        const { selected: selectedCount, total: totalControls } = countConcreteControls(
            currentHierarchy,
            selectedControlKeys instanceof Set ? selectedControlKeys : new Set(),
        );
        const selectedFieldCount = selectedControlKeys instanceof Set ? selectedControlKeys.size : 0;
        const totalFieldCount = currentAvailableKeys.size;
        const fieldDetail = selectedFieldCount === selectedCount && totalFieldCount === totalControls
            ? ''
            : ` (${selectedFieldCount} of ${totalFieldCount} reusable field selectors).`;
        if (!totalControls) {
            elements.instantiationSelectionSummary.textContent = 'No bound controls available for serialization.';
            return;
        }
        if (!selectedCount) {
            elements.instantiationSelectionSummary.textContent = `0 of ${totalControls} concrete controls selected${fieldDetail} Export will not restore bound values.`;
            return;
        }
        elements.instantiationSelectionSummary.textContent = `${selectedCount} of ${totalControls} concrete controls selected for snippet/export${fieldDetail}`;
    }

    function setSelection(nextSelection) {
        selectedControlKeys = sanitizeSelection(nextSelection, currentAvailableKeys);
        clearPreview();
        if (!overlayOpen) renderTree();
        updateSelectionSummary();
    }

    function ensureDialogState() {
        const fileName = getCurrentFileName();
        if (!fileName) {
            showError('Please load a Rive file first.');
            return false;
        }

        if (fileName !== currentFileName) {
            currentFileName = fileName;
            selectedControlKeys = null;
            expandedBranchKeys = new Set();
            clearPreview();
        }

        currentHierarchy = serializeControlHierarchy();
        currentAvailableKeys = collectNodeInputKeys(currentHierarchy);
        const nextSignature = buildControlHierarchyTopologySignature(currentHierarchy);
        if (nextSignature !== hierarchySignature) {
            hierarchySignature = nextSignature;
            hierarchyRevision += 1;
        }
        if (selectedControlKeys === null) {
            selectedControlKeys = sanitizeSelection(getChangedControlKeySet(), currentAvailableKeys);
        } else {
            selectedControlKeys = sanitizeSelection(selectedControlKeys, currentAvailableKeys);
        }

        if (!currentPreviewText) {
            renderPreview();
        }
        updateSelectionSummary();

        if (elements.instantiationDialogExportButton) {
            elements.instantiationDialogExportButton.disabled = !getTauriInvoker();
        }

        return true;
    }

    function renderTree() {
        renderControlHierarchyTree({
            currentHierarchy,
            documentRef,
            expandedBranchKeys,
            onSelectionChange: setSelection,
            selectedKeys: selectedControlKeys,
            treeElement: elements.instantiationControlsTree,
        });
    }

    async function generateSnippetPreview() {
        if (!ensureDialogState()) {
            return null;
        }

        const packageSource = elements.instantiationPackageSourceSelect?.value || 'cdn';
        const snippetMode = getSnippetMode();
        const result = await generateWebInstantiationCode({
            packageSource,
            snippetMode,
            selectedControlKeys: getSelectedControlKeys() || [],
        });
        currentPreviewText = String(result?.code || '').trim();
        renderPreview();
        updateInfo(`Generated ${packageSource.toUpperCase()} ${snippetMode.toUpperCase()} web instantiation snippet.`);
        logEvent('ui', 'snippet-preview', `Generated ${packageSource} ${snippetMode} instantiation snippet.`);
        return result;
    }

    async function copyPreviewToClipboard() {
        if (!currentPreviewText) {
            await generateSnippetPreview();
        }
        if (!currentPreviewText) {
            return false;
        }
        await windowRef.navigator.clipboard.writeText(currentPreviewText);
        updateInfo('Instantiation snippet copied to clipboard.');
        return true;
    }

    async function exportDemoFromDialog({ strictResult = false } = {}) {
        if (!ensureDialogState()) {
            return null;
        }

        const bundleOptions = {
            packageSource: elements.instantiationPackageSourceSelect?.value === 'local' ? 'local' : 'cdn',
            snippetMode: getSnippetMode(),
            selectedControlKeys: getSelectedControlKeys() || [],
        };
        if (strictResult) bundleOptions.strictResult = true;
        const outputPath = await createDemoBundle(bundleOptions);
        if (outputPath && (!strictResult || outputPath.status === 'saved')) {
            getDialog()?.close();
        }
        return outputPath;
    }

    function captureOverlayState({ incremental = false } = {}) {
        const includeHierarchy = !incremental || overlayHierarchyRevision !== hierarchyRevision;
        const renderedSummary = elements.instantiationSelectionSummary?.textContent?.trim();
        let selectionSummary = renderedSummary;
        if (!selectionSummary) {
            const counts = countConcreteControls(currentHierarchy, selectedControlKeys || new Set());
            selectionSummary = `${counts.selected} of ${counts.total} controls selected.`;
        }
        const state = {
            expandedBranchKeys: Array.from(expandedBranchKeys),
            exportEnabled: Boolean(getTauriInvoker()),
            hierarchyRevision,
            packageSource: elements.instantiationPackageSourceSelect?.value || 'cdn',
            previewStatus: currentPreviewText ? 'Snippet preview is ready.' : 'Snippet preview not generated yet.',
            previewText: currentPreviewText,
            selectedControlKeys: getSelectedControlKeys() || [],
            selectionSummary,
            snippetMode: getSnippetMode(),
            treeScrollTop: overlayTreeScrollTop,
        };
        if (includeHierarchy) {
            state.hierarchy = currentHierarchy;
        }
        return state;
    }

    function markOverlayStateSynced(state) {
        if (Object.hasOwn(state || {}, 'hierarchy')) {
            overlayHierarchyRevision = Number(state.hierarchyRevision);
        }
    }

    async function handleOverlayAction({ action, value }) {
        if (action === 'selection-toggle' && value?.key) {
            const nextSelection = new Set(selectedControlKeys || []);
            if (value.selected) nextSelection.add(value.key);
            else nextSelection.delete(value.key);
            setSelection(nextSelection);
        } else if (action === 'branch-selection' && value?.branchKey) {
            const nextSelection = new Set(selectedControlKeys || []);
            collectTreeNodeInputKeys(currentHierarchy, value.branchKey).forEach((key) => {
                if (value.selected) nextSelection.add(key);
                else nextSelection.delete(key);
            });
            setSelection(nextSelection);
        } else if (action === 'selection-preset') {
            if (value === 'changed') setSelection(getChangedControlKeySet());
            if (value === 'all') setSelection(new Set(currentAvailableKeys));
            if (value === 'none') setSelection(new Set());
        } else if (action === 'branch-expanded' && value?.key) {
            if (value.expanded) expandedBranchKeys.add(value.key);
            else expandedBranchKeys.delete(value.key);
        } else if (action === 'tree-scroll') {
            overlayTreeScrollTop = Math.max(0, Number(value) || 0);
        } else if (action === 'package-source') {
            if (elements.instantiationPackageSourceSelect) {
                elements.instantiationPackageSourceSelect.value = value === 'local' ? 'local' : 'cdn';
            }
            clearPreview();
        } else if (action === 'snippet-mode') {
            if (elements.instantiationSnippetModeSelect) {
                elements.instantiationSnippetModeSelect.value = value === 'scaffold' ? 'scaffold' : 'compact';
            }
            clearPreview();
        } else if (action === 'generate-preview') {
            await generateSnippetPreview();
        } else if (action === 'copy-preview') {
            await copyPreviewToClipboard();
        } else if (action === 'export') {
            const result = await exportDemoFromDialog({ strictResult: true });
            if (result?.status === 'saved') return { close: true };
            if (result?.status === 'cancelled') return null;
            throw new Error('Export did not return a completion status.');
        }
        return null;
    }

    async function openDialog() {
        if (!ensureDialogState()) {
            return { open: false };
        }
        renderPreview();
        if (typeof requestUiOverlay === 'function') {
            const opened = await requestUiOverlay({
                bounds: measureDialogOverlay({ dialog: getDialog() }),
                getState: captureOverlayState,
                handleAction: handleOverlayAction,
                onClose: () => { overlayOpen = false; },
                onStateSynced: markOverlayStateSynced,
                purpose: 'export',
                restoreFocusTarget: elements.demoBundleButton,
                syncDelays: [0],
            });
            if (opened) {
                overlayOpen = true;
                return { open: true, overlay: true, selectionCount: selectedControlKeys.size };
            }
        }
        renderTree();
        getDialog()?.showModal();
        getDialog()?.ownerDocument?.activeElement?.blur?.();
        initLucideIcons();
        return { open: true, selectionCount: selectedControlKeys.size };
    }

    function closeDialog() {
        getDialog()?.close();
        return { open: false };
    }

    async function toggleDialog(action = 'toggle') {
        const dialog = getDialog();
        if (!dialog) {
            return { open: false };
        }

        if (action === 'close') {
            return closeDialog();
        }
        if (action === 'open') {
            return openDialog();
        }
        if (dialog.open) {
            return closeDialog();
        }
        return openDialog();
    }

    function setup() {
        documentRef.addEventListener('rav:vm-topology-changed', () => {
            if ((!getDialog()?.open && !overlayOpen) || !ensureDialogState()) {
                return;
            }
            if (overlayOpen) {
                const EventCtor = documentRef.defaultView?.CustomEvent || globalThis.CustomEvent;
                documentRef.dispatchEvent(new EventCtor('rav:ui-overlay-state-dirty', {
                    detail: { purpose: 'export' },
                }));
                return;
            }
            renderTree();
            initLucideIcons();
        });
        elements.instantiationControlsCloseButton?.addEventListener('click', () => {
            closeDialog();
        });
        elements.instantiationPresetChangedButton?.addEventListener('click', () => {
            if (!ensureDialogState()) {
                return;
            }
            setSelection(getChangedControlKeySet());
        });
        elements.instantiationPresetAllButton?.addEventListener('click', () => {
            if (!ensureDialogState()) {
                return;
            }
            setSelection(new Set(currentAvailableKeys));
        });
        elements.instantiationPresetNoneButton?.addEventListener('click', () => {
            if (!ensureDialogState()) {
                return;
            }
            setSelection(new Set());
        });
        elements.instantiationPackageSourceSelect?.addEventListener('change', () => {
            clearPreview();
        });
        elements.instantiationSnippetModeSelect?.addEventListener('change', () => {
            clearPreview();
        });
        elements.instantiationDialogSnippetButton?.addEventListener('click', () => {
            generateSnippetPreview().catch((error) => {
                showError(`Failed to generate snippet: ${error.message}`);
                logEvent('ui', 'snippet-preview-failed', 'Failed to generate instantiation snippet.', error);
            });
        });
        elements.copyInstantiationPreviewButton?.addEventListener('click', () => {
            copyPreviewToClipboard().catch((error) => {
                showError(`Failed to copy snippet: ${error.message}`);
            });
        });
        elements.instantiationDialogExportButton?.addEventListener('click', () => {
            exportDemoFromDialog().catch((error) => {
                showError(`Failed to export demo: ${error.message}`);
                logEvent('ui', 'dialog-export-failed', 'Failed to export demo from instantiation dialog.', error);
            });
        });
    }

    return {
        getSelectedControlKeys,
        openDialog,
        setup,
        toggleDialog,
    };
}
