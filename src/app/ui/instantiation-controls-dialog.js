import { controlSnapshotKeyForDescriptor } from '../rive/vm-controls.js';
import {
    collectNodeInputKeys,
    renderControlHierarchyTree,
    sanitizeSelection,
} from './export/control-tree.js';

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
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    let currentFileName = null;
    let currentHierarchy = null;
    let currentAvailableKeys = new Set();
    let selectedControlKeys = null;
    let currentPreviewText = '';
    let expandedBranchKeys = new Set();

    function getDialog() {
        return elements.instantiationControlsDialog;
    }

    function getSelectedControlKeys() {
        return selectedControlKeys instanceof Set ? Array.from(selectedControlKeys) : null;
    }

    function getChangedControlKeySet() {
        return new Set(
            getChangedVmControlSnapshot()
                .map((entry) => controlSnapshotKeyForDescriptor(entry?.descriptor))
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

        const totalControls = currentAvailableKeys.size;
        const selectedCount = selectedControlKeys instanceof Set ? selectedControlKeys.size : 0;
        if (!totalControls) {
            elements.instantiationSelectionSummary.textContent = 'No bound controls available for serialization.';
            return;
        }
        if (!selectedCount) {
            elements.instantiationSelectionSummary.textContent = `0 of ${totalControls} controls selected. Export will not restore bound values.`;
            return;
        }
        elements.instantiationSelectionSummary.textContent = `${selectedCount} of ${totalControls} controls selected for snippet/export.`;
    }

    function setSelection(nextSelection) {
        selectedControlKeys = sanitizeSelection(nextSelection, currentAvailableKeys);
        clearPreview();
        renderTree();
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

    async function exportDemoFromDialog() {
        if (!ensureDialogState()) {
            return null;
        }

        const outputPath = await createDemoBundle({
            snippetMode: getSnippetMode(),
            selectedControlKeys: getSelectedControlKeys() || [],
        });
        if (outputPath) {
            getDialog()?.close();
        }
        return outputPath;
    }

    async function openDialog() {
        if (!ensureDialogState()) {
            return { open: false };
        }
        renderTree();
        renderPreview();
        getDialog()?.showModal();
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
