import { OPEN_FILE_POLL_INTERVAL_MS } from '../core/constants.js';

export function extractOpenedFilePath(payload) {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }
    if (Array.isArray(payload)) {
        const firstPath = payload.find((entry) => typeof entry === 'string' && entry.trim());
        return firstPath ? firstPath.trim() : '';
    }
    if (payload && typeof payload === 'object') {
        const candidate = payload.path ?? payload.filePath ?? payload.file ?? payload.paths;
        return extractOpenedFilePath(candidate);
    }
    return '';
}

export function normalizeOpenedFilePath(rawPath) {
    const path = String(rawPath || '').trim();
    if (!path) {
        return '';
    }

    if (/^file:\/\//i.test(path)) {
        try {
            const url = new URL(path);
            let decoded = decodeURIComponent(url.pathname || '');
            if (/^\/[a-zA-Z]:\//.test(decoded)) {
                decoded = decoded.slice(1);
            }
            return decoded || path;
        } catch {
            return path;
        }
    }

    return path;
}

export function getFileNameFromPath(filePath) {
    const normalized = String(filePath || '');
    const segments = normalized.split(/[\\/]+/);
    return segments[segments.length - 1] || normalized;
}

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
            button.classList.add('btn-dark', 'btn-muted');
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

    async function loadRivFromPath(filePath, { source = 'open-with' } = {}) {
        const invoke = getTauriInvoker();
        if (!invoke) {
            return;
        }
        try {
            const normalizedPath = normalizeOpenedFilePath(filePath);
            const fileName = getFileNameFromPath(normalizedPath);
            if (!/\.riv$/i.test(fileName)) {
                showError(`Unsupported file type: ${fileName}`);
                return;
            }

            if (source === 'drop-path') {
                logEvent('ui', 'file-dropped', `Dropped file: ${fileName}`);
            } else {
                logEvent('ui', 'open-with', `Opened via system: ${fileName}`);
            }

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
    }

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

    function setupFileInput() {
        if (!elements.fileInput) {
            return;
        }
        elements.fileInput.addEventListener('change', async (event) => {
            const selectedFile = event.target.files?.[0];
            if (!selectedFile) {
                updateFileTriggerButton('empty');
                return;
            }
            if (!selectedFile.name.toLowerCase().endsWith('.riv')) {
                showError('Please select a .riv file');
                event.target.value = '';
                updateFileTriggerButton('empty');
                logEvent('ui', 'file-invalid', `Rejected file: ${selectedFile.name}`);
                return;
            }

            updateFileTriggerButton('loaded', selectedFile.name);
            logEvent('ui', 'file-selected', `Selected file: ${selectedFile.name}`);

            const buffer = await selectedFile.arrayBuffer();
            const fileUrl = urlApi.createObjectURL(selectedFile);
            setCurrentFile(fileUrl, selectedFile.name, true, buffer, selectedFile.type, selectedFile.size, {
                lastModified: selectedFile.lastModified,
            });
            hideError();
            await applyStoredRuntimeVersionForCurrentFile();
            try {
                await loadRiveAnimation(fileUrl, selectedFile.name, { forceAutoplay: true });
            } catch {
                logEvent('native', 'load-failed', `Failed to load ${selectedFile.name}.`);
            } finally {
                event.target.value = '';
            }
        });
    }

    function setupDragAndDrop() {
        const container = elements.canvasContainer;
        if (!container) {
            return;
        }

        const setDragActive = (active) => {
            container.classList.toggle('drag-active', active);
        };

        const getDroppedFileFromDataTransfer = (dataTransfer) => {
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
        };

        const getDroppedFilePathFromDataTransfer = (dataTransfer) => {
            if (!dataTransfer || typeof dataTransfer.getData !== 'function') {
                return '';
            }
            const uriList = dataTransfer.getData('text/uri-list') || '';
            const plainText = dataTransfer.getData('text/plain') || '';
            const lines = `${uriList}\n${plainText}`
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#'));

            const candidate = lines.find((line) => /^file:\/\//i.test(line))
                || lines.find((line) => /^([A-Za-z]:[\\/]|\/)/.test(line));
            return candidate || '';
        };

        const hasFileDropPayload = (dataTransfer) => {
            if (!dataTransfer) {
                return false;
            }
            if ((dataTransfer.files?.length || 0) > 0) {
                return true;
            }
            if (Array.from(dataTransfer.items || []).some((item) => item?.kind === 'file')) {
                return true;
            }
            return Boolean(getDroppedFilePathFromDataTransfer(dataTransfer));
        };

        const handleDroppedPayload = async (dataTransfer) => {
            const droppedFile = getDroppedFileFromDataTransfer(dataTransfer);
            if (droppedFile) {
                if (!droppedFile.name.toLowerCase().endsWith('.riv')) {
                    showError('Please drop a .riv file');
                    logEvent('ui', 'drop-invalid', `Rejected dropped file: ${droppedFile.name}`);
                    return;
                }
                logEvent('ui', 'file-dropped', `Dropped file: ${droppedFile.name}`);
                updateFileTriggerButton('loaded', droppedFile.name);
                const buffer = await droppedFile.arrayBuffer();
                const fileUrl = urlApi.createObjectURL(droppedFile);
                setCurrentFile(fileUrl, droppedFile.name, true, buffer, droppedFile.type, droppedFile.size, {
                    lastModified: droppedFile.lastModified,
                });
                hideError();
                await applyStoredRuntimeVersionForCurrentFile();
                try {
                    await loadRiveAnimation(fileUrl, droppedFile.name, { forceAutoplay: true });
                } catch {
                    logEvent('native', 'load-failed', `Failed to load dropped ${droppedFile.name}.`);
                }
                return;
            }

            const droppedPath = getDroppedFilePathFromDataTransfer(dataTransfer);
            if (droppedPath) {
                const fileName = getFileNameFromPath(normalizeOpenedFilePath(droppedPath));
                if (!/\.riv$/i.test(fileName)) {
                    showError('Please drop a .riv file');
                    logEvent('ui', 'drop-invalid', `Rejected dropped path: ${fileName || droppedPath}`);
                    return;
                }
                await loadRivFromPath(droppedPath, { source: 'drop-path' });
                return;
            }

            showError('No readable file payload found in drop event.');
            logEvent('ui', 'drop-invalid', 'Drop payload was empty or unreadable.');
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
                await handleDroppedPayload(event.dataTransfer);
            } catch (error) {
                console.error('[rive-viewer] dropped file load failed:', error);
                showError(`Failed to load dropped file: ${error?.message || error}`);
                logEvent('native', 'load-failed', 'Dropped file load failed.', error);
            }
        });
    }

    function handleFileButtonClick() {
        if (!elements.fileInput) {
            return;
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
