import { controlSnapshotKeyForDescriptor } from '../rive/vm-controls.js';

function collectNodeInputKeys(node, keys = new Set()) {
    if (!node) {
        return keys;
    }

    (node.inputs || []).forEach((input) => {
        const key = controlSnapshotKeyForDescriptor(input?.descriptor);
        if (key) {
            keys.add(key);
        }
    });
    (node.children || []).forEach((child) => collectNodeInputKeys(child, keys));
    return keys;
}

function countSelectedKeys(node, selectedKeys) {
    const keys = collectNodeInputKeys(node);
    let selected = 0;
    keys.forEach((key) => {
        if (selectedKeys.has(key)) {
            selected += 1;
        }
    });
    return {
        selected,
        total: keys.size,
    };
}

function sanitizeSelection(selection, availableKeys) {
    const nextSelection = new Set();
    if (!(selection instanceof Set)) {
        return nextSelection;
    }
    selection.forEach((key) => {
        if (availableKeys.has(key)) {
            nextSelection.add(key);
        }
    });
    return nextSelection;
}

export function createInstantiationControlsDialogController({
    callbacks = {},
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

    function createInputRow(input, depth) {
        const row = document.createElement('label');
        row.className = 'instantiation-input-row';
        row.style.setProperty('--tree-depth', String(depth));

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        const key = controlSnapshotKeyForDescriptor(input?.descriptor);
        checkbox.checked = Boolean(key && selectedControlKeys?.has(key));
        checkbox.disabled = !key;
        checkbox.addEventListener('change', () => {
            const nextSelection = new Set(selectedControlKeys);
            if (!key) {
                return;
            }
            if (checkbox.checked) {
                nextSelection.add(key);
            } else {
                nextSelection.delete(key);
            }
            setSelection(nextSelection);
        });

        const text = document.createElement('div');
        text.className = 'instantiation-input-text';

        const title = document.createElement('span');
        title.className = 'instantiation-input-title';
        title.textContent = `${input.name} (${input.kind})`;

        const meta = document.createElement('span');
        meta.className = 'instantiation-input-meta';
        meta.textContent = input.source === 'state-machine'
            ? `${input.stateMachineName} / ${input.name}`
            : input.path;

        text.appendChild(title);
        text.appendChild(meta);
        row.appendChild(checkbox);
        row.appendChild(text);
        return row;
    }

    function createTreeNode(node, depth = 0) {
        const wrapper = document.createElement('div');
        wrapper.className = 'instantiation-tree-node';
        wrapper.style.setProperty('--tree-depth', String(depth));

        const counts = countSelectedKeys(node, selectedControlKeys);
        const branchKeys = collectNodeInputKeys(node);

        const details = document.createElement('details');
        details.className = 'instantiation-tree-branch';
        details.open = depth < 1;

        const summary = document.createElement('summary');
        summary.className = 'instantiation-tree-summary';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = counts.total > 0 && counts.selected === counts.total;
        checkbox.indeterminate = counts.selected > 0 && counts.selected < counts.total;
        checkbox.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        checkbox.addEventListener('change', () => {
            const nextSelection = new Set(selectedControlKeys);
            branchKeys.forEach((key) => {
                if (checkbox.checked) {
                    nextSelection.add(key);
                } else {
                    nextSelection.delete(key);
                }
            });
            setSelection(nextSelection);
        });

        const label = document.createElement('span');
        label.className = 'instantiation-tree-label';
        label.textContent = node.label;

        const badge = document.createElement('span');
        badge.className = 'instantiation-tree-badge';
        badge.textContent = counts.total ? `${counts.selected}/${counts.total}` : '0';

        summary.appendChild(checkbox);
        summary.appendChild(label);
        summary.appendChild(badge);
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'instantiation-tree-body';
        (node.inputs || []).forEach((input) => {
            body.appendChild(createInputRow(input, depth + 1));
        });
        (node.children || []).forEach((child) => {
            body.appendChild(createTreeNode(child, depth + 1));
        });

        if (!node.inputs?.length && !node.children?.length) {
            const empty = document.createElement('p');
            empty.className = 'instantiation-tree-empty';
            empty.textContent = 'No controls in this branch.';
            body.appendChild(empty);
        }

        details.appendChild(body);
        wrapper.appendChild(details);
        return wrapper;
    }

    function renderTree() {
        const tree = elements.instantiationControlsTree;
        if (!tree) {
            return;
        }

        tree.innerHTML = '';
        if (!currentHierarchy?.children?.length) {
            const empty = document.createElement('p');
            empty.className = 'instantiation-tree-empty';
            empty.textContent = 'No bound ViewModel or state machine controls are available.';
            tree.appendChild(empty);
            return;
        }

        currentHierarchy.children.forEach((node) => {
            tree.appendChild(createTreeNode(node));
        });
    }

    async function generateSnippetPreview() {
        if (!ensureDialogState()) {
            return null;
        }

        const packageSource = elements.instantiationPackageSourceSelect?.value || 'cdn';
        const result = await generateWebInstantiationCode({
            packageSource,
            selectedControlKeys: getSelectedControlKeys() || [],
        });
        currentPreviewText = String(result?.code || '').trim();
        renderPreview();
        updateInfo(`Generated ${packageSource.toUpperCase()} web instantiation snippet.`);
        logEvent('ui', 'snippet-preview', `Generated ${packageSource} instantiation snippet.`);
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
