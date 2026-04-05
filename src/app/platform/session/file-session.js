import { OPEN_FILE_POLL_INTERVAL_MS } from '../../core/constants.js';
import { createDragAndDropSetup } from './drag-drop.js';
import { createFileInputSetup, createPathRivLoader } from './local-file.js';
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
    let openedFilePollTimeout = null;
    let tauriOpenFileUnlisten = null;

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

    function setCurrentFile(url, name, isObjectUrl = false, buffer, mimeType, fileSizeBytes, metadata = {}) {
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
        showError,
        urlApi,
        windowRef,
    });

    async function checkOpenedFile() {
        await ensureTauriBridge();
        const invoke = getTauriInvoker();
        if (!invoke) {
            if (isTauriEnvironment()) {
                console.warn('[rive-viewer] Tauri environment detected but invoke bridge is unavailable');
            }
            return false;
        }

        try {
            const filePath = extractOpenedFilePath(await invoke('get_opened_file'));
            if (filePath) {
                await loadRivFromPath(filePath);
                return true;
            }
        } catch (error) {
            console.warn('[rive-viewer] get_opened_file failed:', error);
        }
        return false;
    }

    function startOpenedFilePolling(intervalMs = OPEN_FILE_POLL_INTERVAL_MS) {
        if (!isTauriEnvironment()) {
            return;
        }
        if (openedFilePollTimeout) {
            clearTimeoutFn(openedFilePollTimeout);
            openedFilePollTimeout = null;
        }

        const poll = async () => {
            await checkOpenedFile();
            openedFilePollTimeout = setTimeoutFn(poll, intervalMs);
        };

        openedFilePollTimeout = setTimeoutFn(poll, Math.max(250, intervalMs));
    }

    async function setupTauriOpenFileListener() {
        const listen = await getTauriEventListener();
        if (typeof listen !== 'function') {
            return;
        }

        try {
            tauriOpenFileUnlisten = await listen('open-file', async (event) => {
                const filePath = extractOpenedFilePath(event?.payload);
                if (!filePath) {
                    return;
                }
                try {
                    await loadRivFromPath(filePath);
                } catch (error) {
                    console.warn('[rive-viewer] open-file event load failed:', error);
                }
            });
        } catch (error) {
            console.warn('[rive-viewer] failed to register open-file listener:', error);
        }
    }

    function dispose() {
        if (openedFilePollTimeout) {
            clearTimeoutFn(openedFilePollTimeout);
            openedFilePollTimeout = null;
        }
        revokeLastObjectUrl();
        if (typeof tauriOpenFileUnlisten === 'function') {
            try {
                tauriOpenFileUnlisten();
            } catch {
                /* noop */
            }
            tauriOpenFileUnlisten = null;
        }
    }

    const setupFileInput = createFileInputSetup({
        applyStoredRuntimeVersionForCurrentFile,
        elements,
        hideError,
        loadRiveAnimation,
        logEvent,
        setCurrentFile,
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
        checkOpenedFile,
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
        revokeLastObjectUrl,
        setCurrentFile,
        setupDragAndDrop,
        setupFileInput,
        setupTauriOpenFileListener,
        startOpenedFilePolling,
        updateFileTriggerButton,
    };
}
