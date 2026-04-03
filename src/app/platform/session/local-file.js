import { getFileNameFromPath, normalizeOpenedFilePath } from './path-utils.js';

function isSupportedRivFileName(fileName) {
    return /\.riv$/i.test(fileName || '');
}

export function createPathRivLoader({
    applyStoredRuntimeVersionForCurrentFile,
    getTauriInvoker,
    hideError,
    loadRiveAnimation,
    logEvent,
    setCurrentFile,
    showError,
    urlApi,
    windowRef,
} = {}) {
    return async function loadRivFromPath(filePath, { source = 'open-with' } = {}) {
        const invoke = getTauriInvoker();
        if (!invoke) {
            return;
        }
        try {
            const normalizedPath = normalizeOpenedFilePath(filePath);
            const fileName = getFileNameFromPath(normalizedPath);
            if (!isSupportedRivFileName(fileName)) {
                showError(`Unsupported file type: ${fileName}`);
                return;
            }

            logEvent(
                'ui',
                source === 'drop-path' ? 'file-dropped' : 'open-with',
                `${source === 'drop-path' ? 'Dropped' : 'Opened via system'} file: ${fileName}`,
            );

            const base64 = await invoke('read_riv_file', { path: normalizedPath });
            const binary = windowRef.atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
            const buffer = bytes.buffer;
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const fileUrl = urlApi.createObjectURL(blob);
            setCurrentFile(fileUrl, fileName, true, buffer, blob.type, buffer.byteLength, {
                sourcePath: normalizedPath,
            });
            hideError();
            await applyStoredRuntimeVersionForCurrentFile();
            await loadRiveAnimation(fileUrl, fileName, { forceAutoplay: true });
        } catch (error) {
            console.error('[rive-viewer] loadRivFromPath failed:', error);
            showError(`Failed to open file: ${error.message || error}`);
        }
    };
}

async function loadLocalRivFile(file, {
    applyStoredRuntimeVersionForCurrentFile,
    hideError,
    loadRiveAnimation,
    logEvent,
    setCurrentFile,
    showError,
    updateFileTriggerButton,
    urlApi,
} = {}) {
    if (!isSupportedRivFileName(file?.name)) {
        showError(file ? 'Please select a .riv file' : 'Please drop a .riv file');
        return false;
    }

    updateFileTriggerButton('loaded', file.name);
    logEvent('ui', 'file-selected', `Selected file: ${file.name}`);
    const buffer = await file.arrayBuffer();
    const fileUrl = urlApi.createObjectURL(file);
    setCurrentFile(fileUrl, file.name, true, buffer, file.type, file.size, {
        lastModified: file.lastModified,
    });
    hideError();
    await applyStoredRuntimeVersionForCurrentFile();
    try {
        await loadRiveAnimation(fileUrl, file.name, { forceAutoplay: true });
    } catch {
        logEvent('native', 'load-failed', `Failed to load ${file.name}.`);
    }
    return true;
}

export function createFileInputSetup({
    applyStoredRuntimeVersionForCurrentFile,
    elements,
    hideError,
    loadRiveAnimation,
    logEvent,
    setCurrentFile,
    showError,
    updateFileTriggerButton,
    urlApi,
} = {}) {
    return function setupFileInput() {
        if (!elements.fileInput) {
            return;
        }
        elements.fileInput.addEventListener('change', async (event) => {
            const selectedFile = event.target.files?.[0];
            if (!selectedFile) {
                updateFileTriggerButton('empty');
                return;
            }
            if (!isSupportedRivFileName(selectedFile.name)) {
                showError('Please select a .riv file');
                event.target.value = '';
                updateFileTriggerButton('empty');
                logEvent('ui', 'file-invalid', `Rejected file: ${selectedFile.name}`);
                return;
            }
            try {
                await loadLocalRivFile(selectedFile, {
                    applyStoredRuntimeVersionForCurrentFile,
                    hideError,
                    loadRiveAnimation,
                    logEvent,
                    setCurrentFile,
                    showError,
                    updateFileTriggerButton,
                    urlApi,
                });
            } finally {
                event.target.value = '';
            }
        });
    };
}

export { isSupportedRivFileName, loadLocalRivFile };
