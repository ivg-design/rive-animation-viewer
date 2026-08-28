import { createDragAndDropSetup } from './drag-drop.js';
import { createFileInputSetup, createPathRivLoader } from './local-file.js';
import { createOpenedFileQueue } from './open-file-queue.js';
import { extractOpenedFilePath } from './path-utils.js';

export {
    extractOpenedFilePath,
    getFileNameFromPath,
    normalizeOpenedFilePath,
} from './path-utils.js';

export function createFileSessionController({
    callbacks = {},
    clearTimeoutFn = globalThis.clearTimeout,
    documentRef = globalThis.document,
    elements,
    setTimeoutFn = globalThis.setTimeout,
    urlApi = globalThis.URL,
    windowRef = globalThis.window,
} = {}) {
    const {
        applyStoredRuntimeVersionForCurrentFile = async () => {},
        buildFileRuntimePreferenceId = () => null,
        cleanupInstance = () => {},
        ensureTauriBridge = async () => {},
        getTauriEventListener = async () => null,
        getTauriInvoker = () => null,
        hideError = () => {},
        initLucideIcons = () => {},
        isTauriEnvironment = () => false,
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        refreshInfoStrip = () => {},
        resetArtboardSwitcherState = () => {},
        resetVmInputControls = () => {},
        restoreFileSessionUi = () => {},
        showError = () => {},
    } = callbacks;

    let currentFileBuffer = null;
    let currentFileMimeType = 'application/octet-stream';
    let currentFileName = null;
    let currentFilePreferenceId = null;
    let currentFileSourcePath = '';
    let currentFileSizeBytes = 0;
    let currentFileUrl = null;
    let lastObjectUrl = null;
    let stagedFileTransaction = null;
    let fileTransactionSequence = 0;

    function getCurrentFileBuffer() {
        return currentFileBuffer;
    }

    function getCurrentFileMimeType() {
        return currentFileMimeType;
    }

    function getCurrentFileName() {
        return currentFileName;
    }

    function getCurrentFilePreferenceId() {
        return currentFilePreferenceId;
    }

    function getCurrentFileSourcePath() {
        return currentFileSourcePath;
    }

    function getCurrentFileSizeBytes() {
        return currentFileSizeBytes;
    }

    function getCurrentFileUrl() {
        return currentFileUrl;
    }

    function updateFileTriggerButton(state, fileName) {
        const button = elements.fileTriggerButton || documentRef.getElementById('file-trigger-btn');
        if (!button) {
            return;
        }
        if (state === 'loaded' && fileName) {
            button.classList.remove('btn-dark', 'btn-muted');
            button.classList.add('btn-file-loaded');
        } else {
            button.classList.remove('btn-file-loaded');
            button.classList.remove('btn-dark', 'btn-muted');
        }
    }

    function revokeLastObjectUrl() {
        if (lastObjectUrl) {
            urlApi.revokeObjectURL(lastObjectUrl);
            lastObjectUrl = null;
        }
    }

    function captureFileState() {
        return {
            buffer: currentFileBuffer,
            mimeType: currentFileMimeType,
            name: currentFileName,
            objectUrl: lastObjectUrl,
            preferenceId: currentFilePreferenceId,
            sizeBytes: currentFileSizeBytes,
            sourcePath: currentFileSourcePath,
            url: currentFileUrl,
        };
    }

    function applyFileState(state) {
        currentFileBuffer = state.buffer;
        currentFileMimeType = state.mimeType;
        currentFileName = state.name;
        currentFilePreferenceId = state.preferenceId;
        currentFileSizeBytes = state.sizeBytes;
        currentFileSourcePath = state.sourcePath;
        currentFileUrl = state.url;
        lastObjectUrl = state.objectUrl;
        updateFileTriggerButton(state.name ? 'loaded' : 'empty', state.name);
        refreshInfoStrip();
    }

    function stageCurrentFile(url, name, isObjectUrl = false, buffer, mimeType, fileSizeBytes, metadata = {}) {
        stagedFileTransaction?.rollback?.();
        const previous = captureFileState();
        const transactionId = ++fileTransactionSequence;
        const staged = {
            buffer: buffer instanceof ArrayBuffer ? buffer : previous.buffer,
            mimeType: mimeType || previous.mimeType,
            name,
            objectUrl: isObjectUrl ? url : null,
            preferenceId: buildFileRuntimePreferenceId(name, Number.isFinite(fileSizeBytes) ? Number(fileSizeBytes) : 0, metadata),
            sizeBytes: Number.isFinite(fileSizeBytes) ? Number(fileSizeBytes) : 0,
            sourcePath: typeof metadata.sourcePath === 'string' ? metadata.sourcePath : '',
            url,
        };
        let settled = false;
        applyFileState(staged);
        resetArtboardSwitcherState();
        const transaction = {
            commit() {
                if (settled || stagedFileTransaction !== transaction) return false;
                settled = true;
                stagedFileTransaction = null;
                if (previous.objectUrl && previous.objectUrl !== staged.objectUrl) {
                    urlApi.revokeObjectURL(previous.objectUrl);
                }
                return true;
            },
            rollback() {
                if (settled || stagedFileTransaction !== transaction) return false;
                settled = true;
                stagedFileTransaction = null;
                if (staged.objectUrl && staged.objectUrl !== previous.objectUrl) {
                    urlApi.revokeObjectURL(staged.objectUrl);
                }
                applyFileState(previous);
                restoreFileSessionUi(previous);
                return true;
            },
            id: transactionId,
        };
        stagedFileTransaction = transaction;
        return transaction;
    }

    function setCurrentFile(url, name, isObjectUrl = false, buffer, mimeType, fileSizeBytes, metadata = {}) {
        stagedFileTransaction?.rollback?.();
        if (lastObjectUrl && lastObjectUrl !== url) {
            urlApi.revokeObjectURL(lastObjectUrl);
            lastObjectUrl = null;
        }

        if (isObjectUrl) {
            lastObjectUrl = url;
        }

        currentFileUrl = url;
        currentFileName = name;
        currentFileSourcePath = typeof metadata.sourcePath === 'string' ? metadata.sourcePath : '';
        resetArtboardSwitcherState();
        if (buffer instanceof ArrayBuffer) {
            currentFileBuffer = buffer;
        }
        if (mimeType) {
            currentFileMimeType = mimeType;
        }
        if (Number.isFinite(fileSizeBytes)) {
            currentFileSizeBytes = Number(fileSizeBytes);
        }
        currentFilePreferenceId = buildFileRuntimePreferenceId(
            currentFileName,
            currentFileSizeBytes,
            metadata,
        );
        updateFileTriggerButton(name ? 'loaded' : 'empty', name);
        refreshInfoStrip();
    }

    async function clearCurrentFile() {
        stagedFileTransaction?.rollback?.();
        cleanupInstance();
        revokeLastObjectUrl();
        currentFileUrl = null;
        currentFileName = null;
        currentFileBuffer = null;
        currentFileSizeBytes = 0;
        currentFilePreferenceId = null;
        currentFileSourcePath = '';
        resetArtboardSwitcherState();
        updateFileTriggerButton('empty');
        if (elements.canvasContainer) {
            elements.canvasContainer.innerHTML = `
        <div class="placeholder">
            <div class="placeholder-icon"><i data-lucide="play" class="lucide-24"></i></div>
            <p>DROP FILE OR CLICK OPEN</p>
        </div>
    `;
        }
        initLucideIcons();
        resetVmInputControls('No bound ViewModel inputs detected.');
        refreshInfoStrip();
    }

    const loadRivFromPath = createPathRivLoader({
        applyStoredRuntimeVersionForCurrentFile,
        getTauriInvoker,
        hideError,
        loadRiveAnimation,
        logEvent,
        setCurrentFile,
        stageCurrentFile,
        showError,
        urlApi,
        windowRef,
    });

    const openedFileQueue = createOpenedFileQueue({
        clearTimeoutFn,
        ensureTauriBridge,
        getTauriEventListener,
        getTauriInvoker,
        isTauriEnvironment,
        loadRivFromPath,
        setTimeoutFn,
    });

    function dispose() {
        openedFileQueue.dispose();
        revokeLastObjectUrl();
    }

    const setupFileInput = createFileInputSetup({
        applyStoredRuntimeVersionForCurrentFile,
        elements,
        hideError,
        loadRiveAnimation,
        logEvent,
        setCurrentFile,
        stageCurrentFile,
        showError,
        updateFileTriggerButton,
        urlApi,
    });

    const setupDragAndDrop = createDragAndDropSetup({
        applyStoredRuntimeVersionForCurrentFile,
        elements,
        hideError,
        loadRiveAnimation,
        loadRivFromPath,
        logEvent,
        setCurrentFile,
        stageCurrentFile,
        showError,
        updateFileTriggerButton,
        urlApi,
        windowRef,
    });

    async function handleFileButtonClick() {
        if (!elements.fileInput) {
            return;
        }
        const invoke = getTauriInvoker();
        if (isTauriEnvironment() && typeof invoke === 'function') {
            try {
                const filePath = extractOpenedFilePath(await invoke('pick_riv_file'));
                if (filePath) {
                    await loadRivFromPath(filePath, { source: 'open-button' });
                }
                return;
            } catch (error) {
                console.warn('[rive-viewer] native file picker failed, falling back to browser input:', error);
            }
        }
        if (currentFileUrl) {
            clearCurrentFile();
            updateFileTriggerButton('empty');
            elements.fileInput.value = '';
            logEvent('ui', 'file-cleared', 'Cleared current animation.');
        }
        elements.fileInput.click();
    }

    return {
        checkOpenedFile: openedFileQueue.drain,
        clearCurrentFile,
        dispose,
        getCurrentFileBuffer,
        getCurrentFileMimeType,
        getCurrentFileName,
        getCurrentFilePreferenceId,
        getCurrentFileSourcePath,
        getCurrentFileSizeBytes,
        getCurrentFileUrl,
        handleFileButtonClick,
        loadRivFromPath,
        drainOpenedFiles: openedFileQueue.drain,
        revokeLastObjectUrl,
        setCurrentFile,
        stageCurrentFile,
        setupDragAndDrop,
        setupFileInput,
        setupTauriOpenFileListener: openedFileQueue.setupListener,
        startOpenedFilePolling: openedFileQueue.startPolling,
        updateFileTriggerButton,
    };
}
