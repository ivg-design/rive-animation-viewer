import { getFileNameFromPath, normalizeOpenedFilePath } from './path-utils.js';
import { isSupportedRivFileName, loadLocalRivFile } from './local-file.js';

function getDroppedFileFromDataTransfer(dataTransfer) {
    const directFiles = Array.from(dataTransfer?.files || []);
    if (directFiles.length > 0) {
        return directFiles[0];
    }
    const items = Array.from(dataTransfer?.items || []);
    for (const item of items) {
        if (item?.kind !== 'file') {
            continue;
        }
        const file = item.getAsFile?.();
        if (file) {
            return file;
        }
    }
    return null;
}

function getDroppedFilePathFromDataTransfer(dataTransfer) {
    if (!dataTransfer || typeof dataTransfer.getData !== 'function') {
        return '';
    }
    const uriList = dataTransfer.getData('text/uri-list') || '';
    const plainText = dataTransfer.getData('text/plain') || '';
    const lines = `${uriList}\n${plainText}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    return lines.find((line) => /^file:\/\//i.test(line))
        || lines.find((line) => /^([A-Za-z]:[\\/]|\/)/.test(line))
        || '';
}

function hasFileDropPayload(dataTransfer) {
    if (!dataTransfer) {
        return false;
    }
    return (dataTransfer.files?.length || 0) > 0
        || Array.from(dataTransfer.items || []).some((item) => item?.kind === 'file')
        || Boolean(getDroppedFilePathFromDataTransfer(dataTransfer));
}

async function handleDroppedPayload(dataTransfer, {
    applyStoredRuntimeVersionForCurrentFile,
    hideError,
    loadRiveAnimation,
    loadRivFromPath,
    logEvent,
    setCurrentFile,
    showError,
    updateFileTriggerButton,
    urlApi,
} = {}) {
    const droppedFile = getDroppedFileFromDataTransfer(dataTransfer);
    if (droppedFile) {
        if (!isSupportedRivFileName(droppedFile.name)) {
            showError('Please drop a .riv file');
            logEvent('ui', 'drop-invalid', `Rejected dropped file: ${droppedFile.name}`);
            return;
        }
        logEvent('ui', 'file-dropped', `Dropped file: ${droppedFile.name}`);
        await loadLocalRivFile(droppedFile, {
            applyStoredRuntimeVersionForCurrentFile,
            hideError,
            loadRiveAnimation,
            logEvent: () => {},
            setCurrentFile,
            showError,
            updateFileTriggerButton,
            urlApi,
        });
        return;
    }

    const droppedPath = getDroppedFilePathFromDataTransfer(dataTransfer);
    if (droppedPath) {
        const fileName = getFileNameFromPath(normalizeOpenedFilePath(droppedPath));
        if (!isSupportedRivFileName(fileName)) {
            showError('Please drop a .riv file');
            logEvent('ui', 'drop-invalid', `Rejected dropped path: ${fileName || droppedPath}`);
            return;
        }
        await loadRivFromPath(droppedPath, { source: 'drop-path' });
        return;
    }

    showError('No readable file payload found in drop event.');
    logEvent('ui', 'drop-invalid', 'Drop payload was empty or unreadable.');
}

export function createDragAndDropSetup({
    applyStoredRuntimeVersionForCurrentFile,
    elements,
    hideError,
    loadRiveAnimation,
    loadRivFromPath,
    logEvent,
    setCurrentFile,
    showError,
    updateFileTriggerButton,
    urlApi,
    windowRef,
} = {}) {
    return function setupDragAndDrop() {
        const container = elements.canvasContainer;
        if (!container) {
            return;
        }

        const setDragActive = (active) => {
            container.classList.toggle('drag-active', active);
        };

        let windowDragDepth = 0;

        windowRef.addEventListener('dragenter', (event) => {
            if (!hasFileDropPayload(event.dataTransfer)) {
                return;
            }
            event.preventDefault();
            windowDragDepth += 1;
            setDragActive(true);
        });

        windowRef.addEventListener('dragover', (event) => {
            if (!hasFileDropPayload(event.dataTransfer)) {
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy';
            }
            setDragActive(true);
        });

        windowRef.addEventListener('dragleave', () => {
            if (windowDragDepth === 0) {
                return;
            }
            windowDragDepth = Math.max(0, windowDragDepth - 1);
            if (windowDragDepth === 0) {
                setDragActive(false);
            }
        });

        windowRef.addEventListener('drop', async (event) => {
            if (!hasFileDropPayload(event.dataTransfer)) {
                return;
            }
            event.preventDefault();
            windowDragDepth = 0;
            setDragActive(false);
            try {
                await handleDroppedPayload(event.dataTransfer, {
                    applyStoredRuntimeVersionForCurrentFile,
                    hideError,
                    loadRiveAnimation,
                    loadRivFromPath,
                    logEvent,
                    setCurrentFile,
                    showError,
                    updateFileTriggerButton,
                    urlApi,
                });
            } catch (error) {
                console.error('[rive-viewer] dropped file load failed:', error);
                showError(`Failed to load dropped file: ${error?.message || error}`);
                logEvent('native', 'load-failed', 'Dropped file load failed.', error);
            }
        });
    };
}
