import { getFileNameFromPath, normalizeOpenedFilePath } from './path-utils.js';
import { normalizeLoadErrorMessage } from '../../rive/instances/load-settlement.js';

function isSupportedRivFileName(fileName) {
    return /\.riv$/i.test(fileName || '');
}

export function createPathRivLoader({
    applyStoredRuntimeVersionForCurrentFile,
    getTauriInvoker,
    hideError,
    loadRiveAnimation,
    logEvent,
    stageCurrentFile,
    showError,
    urlApi,
    windowRef,
} = {}) {
    return async function loadRivFromPath(filePath, { source = 'open-with' } = {}) {
        const invoke = getTauriInvoker();
        if (!invoke) {
            return false;
        }
        try {
            const normalizedPath = normalizeOpenedFilePath(filePath);
            const fileName = getFileNameFromPath(normalizedPath);
            if (!isSupportedRivFileName(fileName)) {
                showError(`Unsupported file type: ${fileName}`);
                return false;
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
            const fileTransaction = stageCurrentFile(fileUrl, fileName, true, buffer, blob.type, buffer.byteLength, {
                sourcePath: normalizedPath,
            });
            try {
                hideError();
                await applyStoredRuntimeVersionForCurrentFile();
                await loadRiveAnimation(fileUrl, fileName, { forceAutoplay: true, waitForActivation: true });
                fileTransaction.commit();
                return true;
            } catch (error) {
                fileTransaction.rollback();
                throw error;
            }
        } catch (error) {
            console.error('[rive-viewer] loadRivFromPath failed:', error);
            showError(`Failed to open file: ${normalizeLoadErrorMessage(error)}`);
            return false;
        }
    };
}

async function loadLocalRivFile(file, {
    applyStoredRuntimeVersionForCurrentFile,
    hideError,
    loadRiveAnimation,
    logEvent,
    stageCurrentFile,
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
    const fileTransaction = stageCurrentFile(fileUrl, file.name, true, buffer, file.type, file.size, {
        lastModified: file.lastModified,
    });
    try {
        hideError();
        await applyStoredRuntimeVersionForCurrentFile();
        await loadRiveAnimation(fileUrl, file.name, { forceAutoplay: true, waitForActivation: true });
        fileTransaction.commit();
    } catch (error) {
        fileTransaction.rollback();
        logEvent('native', 'load-failed', `Failed to load ${file.name}.`);
        throw error;
    }
    return true;
}

export function createFileInputSetup({
    applyStoredRuntimeVersionForCurrentFile,
    elements,
    hideError,
    loadRiveAnimation,
    logEvent,
    stageCurrentFile,
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
                    stageCurrentFile,
                    showError,
                    updateFileTriggerButton,
                    urlApi,
                });
            } catch {
                // The transactional loader already restored the prior file and
                // reported the runtime error. Avoid an unhandled event rejection.
            } finally {
                event.target.value = '';
            }
        });
    };
}

export { isSupportedRivFileName, loadLocalRivFile };
