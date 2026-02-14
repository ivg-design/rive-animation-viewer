// CodeMirror will be loaded dynamically if available
let CodeMirrorModules = null;
let tauriApiLoadPromise = null;
const tauriBridge = {
    invoke: null,
    listen: null,
};

// Try to load CodeMirror modules
async function loadCodeMirror() {
    try {
        let modules;

        if (isTauriEnvironment()) {
            // Desktop app - load from bundled single file
            modules = await import('/vendor/codemirror-bundle.js');
        } else {
            // Web version - load from node_modules
            const [cm, js, theme] = await Promise.all([
                import('/node_modules/codemirror/dist/index.js'),
                import('/node_modules/@codemirror/lang-javascript/dist/index.js'),
                import('/node_modules/@codemirror/theme-one-dark/dist/index.js')
            ]);
            modules = {
                basicSetup: cm.basicSetup,
                EditorView: cm.EditorView,
                javascript: js.javascript,
                oneDark: theme.oneDark
            };
        }

        CodeMirrorModules = modules;
        return true;
    } catch (error) {
        console.warn('CodeMirror not available, using fallback textarea', error);
        return false;
    }
}

const RIVE_VERSION = '2.34.3';
const MIN_SCRIPTING_RUNTIME_VERSION = '2.34.0';
const runtimeSources = {
    canvas: `https://cdn.jsdelivr.net/npm/@rive-app/canvas@${RIVE_VERSION}`,
    webgl2: `https://cdn.jsdelivr.net/npm/@rive-app/webgl2@${RIVE_VERSION}`,
};

const runtimeRegistry = {};
const runtimePromises = {};
const runtimeVersions = {};
const runtimeResolvedUrls = {};
const runtimeSourceTexts = {};
const runtimeBlobUrls = {};
const runtimeAssets = {};
const runtimeWarningsShown = new Set();
const APP_VERSION = '__APP_VERSION__';
const APP_BUILD = '__APP_BUILD__';
let resolvedAppVersion = APP_VERSION;
let resolvedAppBuild = APP_BUILD;
const DEFAULT_LAYOUT_FIT = 'contain';
const LAYOUT_FITS = ['cover', 'contain', 'fill', 'fitWidth', 'fitHeight', 'scaleDown', 'none', 'layout'];
const RUNTIME_CACHE_NAME = 'rive-runtime-cache-v1';
const RUNTIME_META_STORAGE_KEY = 'riveRuntimeMeta';
const VM_CONTROL_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color', 'trigger']);
const EVENT_LOG_LIMIT = 500;
const VM_CONTROL_SYNC_INTERVAL_MS = 120;

let riveInstance = null;
let currentFileUrl = null;
let currentFileName = null;
let currentRuntime = 'webgl2';
let lastObjectUrl = null;
let currentLayoutFit = DEFAULT_LAYOUT_FIT;
let currentFileBuffer = null;
let currentFileMimeType = 'application/octet-stream';
let currentFileSizeBytes = 0;
let lastInitConfig = {};
let configDirty = false;
let errorTimeoutId = null;
let currentArtboardName = null;
let currentCanvasColor = '#0d1117';
let isLeftPanelVisible = false;
let isRightPanelVisible = true;
const runtimeMeta = loadRuntimeMeta();
let editorView = null;
let isAutoFilling = false;
const eventLogEntries = [];
const eventFilterState = {
    native: true,
    riveUser: true,
    ui: true,
    search: '',
};
let eventLogSequence = 0;
let riveEventUnsubscribers = [];
let lastFpsUpdate = 0;
let frameCount = 0;
let tauriOpenFileUnlisten = null;
let openedFilePollTimeout = null;
const OPEN_FILE_POLL_INTERVAL_MS = 900;
let vmControlSyncTimer = null;
let vmControlBindings = [];

const elements = {
    versionInfo: document.getElementById('version-info'),
    fileInput: document.getElementById('file-input'),
    fileTriggerButton: document.getElementById('file-trigger-btn'),
    runtimeSelect: document.getElementById('runtime-select'),
    layoutSelect: document.getElementById('layout-select'),
    codeEditor: document.getElementById('code-editor'),
    runtimeStripRuntime: document.getElementById('runtime-strip-runtime'),
    runtimeStripFile: document.getElementById('runtime-strip-file'),
    runtimeStripVersion: document.getElementById('runtime-strip-version'),
    runtimeStripBuild: document.getElementById('runtime-strip-build'),
    toggleLeftPanelButton: document.getElementById('toggle-left-panel-btn'),
    toggleRightPanelButton: document.getElementById('toggle-right-panel-btn'),
    showLeftPanelButton: document.getElementById('show-left-panel-btn'),
    showRightPanelButton: document.getElementById('show-right-panel-btn'),
    info: document.getElementById('info'),
    error: document.getElementById('error-message'),
    canvasContainer: document.getElementById('canvas-container'),
    canvasColorInput: document.getElementById('canvas-color-input'),
    mainGrid: document.getElementById('main-grid'),
    leftResizer: document.getElementById('left-resizer'),
    rightResizer: document.getElementById('right-resizer'),
    centerResizer: document.getElementById('center-resizer'),
    centerPanel: document.getElementById('center-panel'),
    rightPanel: document.getElementById('right-panel'),
    configPanel: document.getElementById('config-panel'),
    configContent: document.getElementById('config-content'),
    vmControlsPanel: document.getElementById('vm-controls-panel'),
    vmControlsCount: document.getElementById('vm-controls-count'),
    vmControlsEmpty: document.getElementById('vm-controls-empty'),
    vmControlsTree: document.getElementById('vm-controls-tree'),
    eventLogPanel: document.getElementById('event-log-panel'),
    eventLogCount: document.getElementById('event-log-count'),
    eventLogList: document.getElementById('event-log-list'),
    eventFilterNative: document.getElementById('event-filter-native'),
    eventFilterRiveUser: document.getElementById('event-filter-rive-user'),
    eventFilterUi: document.getElementById('event-filter-ui'),
    eventFilterSearch: document.getElementById('event-filter-search'),
    eventLogClearButton: document.getElementById('event-log-clear-btn'),
    settingsButton: document.getElementById('settings-btn'),
    settingsPopover: document.getElementById('settings-popover'),
};

init();

async function init() {
    console.log('[rive-viewer] init start');
    await ensureTauriBridge();
    initLucideIcons();
    resolveAppVersion();
    updateVersionInfo('Loading runtime...');
    setupFileInput();
    updateFileTriggerButton('empty');
    setupRuntimeSelect();
    setupLayoutSelect();
    await setupCodeEditor();
    setupCanvasColor();
    setupDemoButton();
    setupPanelResizers();
    setupCenterResizer();
    setupPanelVisibilityToggles();
    setupEventLog();
    setupSettingsPopover();
    setupDragAndDrop();
    await setupTauriOpenFileListener();
    resetVmInputControls('No animation loaded.');
    resetEventLog();
    refreshInfoStrip();
    window.addEventListener('resize', handleResize);
    window.addEventListener('beforeunload', () => {
        if (typeof tauriOpenFileUnlisten === 'function') {
            tauriOpenFileUnlisten();
            tauriOpenFileUnlisten = null;
        }
        if (openedFilePollTimeout) {
            clearTimeout(openedFilePollTimeout);
            openedFilePollTimeout = null;
        }
        revokeLastObjectUrl();
    });
    console.log('[rive-viewer] setup complete, loading runtime...');
    ensureRuntime(currentRuntime)
        .then(async () => {
            updateVersionInfo();
            refreshInfoStrip();
            console.log('[rive-viewer] runtime ready:', currentRuntime);
            // Check if the app was launched via "Open With" with a .riv file
            const loadedFromPending = await checkOpenedFile();
            if (!loadedFromPending) {
                console.log('[rive-viewer] no pending file at startup; open-file polling enabled');
            }
            startOpenedFilePolling();
        })
        .catch((error) => {
            console.error('[rive-viewer] runtime load failed:', error);
            showError(`Failed to load runtime: ${error.message}`);
        });

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
            console.log('[rive-viewer] opened via "Open With":', filePath);
            await loadRivFromPath(filePath);
            return true;
        }
    } catch (e) {
        console.warn('[rive-viewer] get_opened_file failed:', e);
    }
    return false;
}

function startOpenedFilePolling(intervalMs = OPEN_FILE_POLL_INTERVAL_MS) {
    if (!isTauriEnvironment()) {
        return;
    }
    if (openedFilePollTimeout) {
        clearTimeout(openedFilePollTimeout);
        openedFilePollTimeout = null;
    }

    const poll = async () => {
        await checkOpenedFile();
        openedFilePollTimeout = setTimeout(poll, intervalMs);
    };

    openedFilePollTimeout = setTimeout(poll, Math.max(250, intervalMs));
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

function extractOpenedFilePath(payload) {
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

function normalizeOpenedFilePath(rawPath) {
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

function getFileNameFromPath(filePath) {
    const normalized = String(filePath || '');
    const segments = normalized.split(/[\\/]+/);
    return segments[segments.length - 1] || normalized;
}

async function loadRivFromPath(filePath) {
    const invoke = getTauriInvoker();
    if (!invoke) return;
    try {
        const normalizedPath = normalizeOpenedFilePath(filePath);
        const fileName = getFileNameFromPath(normalizedPath);
        if (!/\.riv$/i.test(fileName)) {
            showError(`Unsupported file type: ${fileName}`);
            return;
        }
        logEvent('ui', 'open-with', `Opened via system: ${fileName}`);
        const base64 = await invoke('read_riv_file', { path: normalizedPath });
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const buffer = bytes.buffer;
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const fileUrl = URL.createObjectURL(blob);
        setCurrentFile(fileUrl, fileName, true, buffer, blob.type, buffer.byteLength);
        hideError();
        await loadRiveAnimation(fileUrl, fileName);
    } catch (e) {
        console.error('[rive-viewer] loadRivFromPath failed:', e);
        showError(`Failed to open file: ${e.message || e}`);
    }
}

function initLucideIcons() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
}

function setupDragAndDrop() {
    const container = elements.canvasContainer;
    if (!container) return;

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        container.classList.add('drag-active');
    });

    container.addEventListener('dragleave', () => {
        container.classList.remove('drag-active');
    });

    container.addEventListener('drop', async (e) => {
        e.preventDefault();
        container.classList.remove('drag-active');
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.riv')) {
            showError('Please drop a .riv file');
            logEvent('ui', 'drop-invalid', `Rejected dropped file: ${file.name}`);
            return;
        }
        logEvent('ui', 'file-dropped', `Dropped file: ${file.name}`);
        updateFileTriggerButton('loaded', file.name);
        const buffer = await file.arrayBuffer();
        const fileUrl = URL.createObjectURL(file);
        setCurrentFile(fileUrl, file.name, true, buffer, file.type, file.size);
        hideError();
        try {
            await loadRiveAnimation(fileUrl, file.name);
        } catch {
            logEvent('native', 'load-failed', `Failed to load dropped ${file.name}.`);
        }
    });
}

function setupSettingsPopover() {
    const btn = elements.settingsButton;
    const popover = elements.settingsPopover;
    if (!btn || !popover) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = popover.hidden;
        popover.hidden = !isHidden;
    });

    document.addEventListener('click', (e) => {
        if (!popover.hidden && !popover.contains(e.target) && e.target !== btn) {
            popover.hidden = true;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !popover.hidden) {
            popover.hidden = true;
        }
    });
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
        const fileUrl = URL.createObjectURL(selectedFile);
        setCurrentFile(fileUrl, selectedFile.name, true, buffer, selectedFile.type, selectedFile.size);
        hideError();
        try {
            await loadRiveAnimation(fileUrl, selectedFile.name);
        } catch {
            // loadRiveAnimation already surfaced the error
            logEvent('native', 'load-failed', `Failed to load ${selectedFile.name}.`);
        } finally {
            event.target.value = '';
        }
    });
}

function setupRuntimeSelect() {
    if (!elements.runtimeSelect) {
        return;
    }

    elements.runtimeSelect.addEventListener('change', async (event) => {
        const selected = event.target.value;
        if (selected === currentRuntime) {
            return;
        }

        currentRuntime = selected;
        updateInfo(`Runtime changed to: ${getRuntimeDisplayName(currentRuntime)}`);
        refreshInfoStrip();
        updateVersionInfo('Loading runtime...');
        logEvent('ui', 'runtime-change', `Runtime set to ${getRuntimeDisplayName(currentRuntime)}`);

        try {
            await ensureRuntime(currentRuntime);
            updateVersionInfo();
            if (currentFileUrl && currentFileName) {
                await loadRiveAnimation(currentFileUrl, currentFileName);
            }
        } catch (error) {
            showError(`Failed to load runtime: ${error.message}`);
            logEvent('native', 'runtime-load-failed', `Failed to load runtime ${currentRuntime}.`, error);
        }
    });
}

function setupLayoutSelect() {
    const select = elements.layoutSelect;
    if (!select) {
        return;
    }

    select.value = currentLayoutFit;
    select.addEventListener('change', async (event) => {
        const selected = event.target.value;
        if (!selected || selected === currentLayoutFit) {
            return;
        }
        if (!LAYOUT_FITS.includes(selected)) {
            showError(`Unsupported layout fit: ${selected}`);
            return;
        }
        currentLayoutFit = selected;
        updateInfo(`Layout fit set to: ${currentLayoutFit}`);
        logEvent('ui', 'layout-change', `Layout fit set to ${currentLayoutFit}`);
        if (currentFileUrl && currentFileName) {
            try {
                await loadRiveAnimation(currentFileUrl, currentFileName);
            } catch {
                /* loadRiveAnimation already reports errors */
            }
        }
    });
}

function setupConfigToggle() {
    const panel = elements.configPanel;
    const toggle = elements.configToggle;
    if (!panel || !toggle) {
        console.warn('setupConfigToggle: missing panel or toggle');
        return;
    }
    toggle.addEventListener('click', () => {
        applyConfigPanelState(panel.classList.contains('collapsed'));
    });
    applyConfigPanelState(!panel.classList.contains('collapsed'));
}

function applyConfigPanelState(visible) {
    const panel = elements.configPanel;
    const content = elements.configContent;
    const grid = elements.mainGrid;
    const toggle = elements.configToggle;
    if (!panel || !grid || !toggle) {
        console.warn('applyConfigPanelState: missing element', {
            panel: !!panel,
            grid: !!grid,
            toggle: !!toggle,
        });
        return;
    }
    panel.hidden = !visible;
    panel.classList.toggle('collapsed', !visible);
    if (content) {
        content.hidden = !visible;
    }
    grid.classList.toggle('config-collapsed', !visible);

    // Clear inline style so CSS class can take effect
    if (!visible) {
        grid.style.gridTemplateColumns = '';
    }

    const label = visible ? 'Hide settings panel' : 'Show settings panel';
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
    toggle.classList.toggle('collapsed', !visible);
    handleResize();
}

async function setupCodeEditor() {
    const editorEl = document.getElementById('code-editor');
    if (!editorEl) {
        return;
    }

    // Set initial code
    const initialCode = `// Rive instantiation config — riveInst is the global instance
// Uncomment any property to override defaults

({
  autoplay: true,
  autoBind: true,

  // artboard: "MyArtboard",
  // stateMachines: "main-sm",
  // animations: "idle",

  // layout: { fit: "contain", alignment: "center" },
  //   fit options: contain, cover, fill, fitWidth, fitHeight, scaleDown, none, layout
  //   alignment: center, topLeft, topCenter, topRight, etc.

  onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  },

  // onStateChange: (event) => { console.log("state:", event); },
  // onAdvance: (event) => { console.log("advance:", event); },
  // onPlay: () => { console.log("play"); },
  // onPause: () => { console.log("pause"); },
  // onStop: () => { console.log("stop"); },
  // onLoop: (event) => { console.log("loop:", event); },
})`;

    // Try to load CodeMirror
    const hasCodeMirror = await loadCodeMirror();

    if (hasCodeMirror && CodeMirrorModules) {
        // Use CodeMirror if available
        const { EditorView, basicSetup, javascript, oneDark } = CodeMirrorModules;
        editorView = new EditorView({
            doc: initialCode,
            extensions: [
                basicSetup,
                javascript(),
                oneDark,
                EditorView.lineWrapping,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && !isAutoFilling) {
                        configDirty = true;
                    }
                })
            ],
            parent: editorEl
        });

        // Prevent default tab behavior when editor is focused
        editorEl.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && (e.target.classList.contains('cm-content') || editorEl.contains(e.target))) {
                // Prevent default browser tab behavior
                e.preventDefault();
                e.stopPropagation();

                // Get current selection
                const state = editorView.state;
                const selection = state.selection;

                if (e.shiftKey) {
                    // Shift+Tab: Remove indentation
                    const changes = [];
                    const newRanges = [];

                    for (const range of selection.ranges) {
                        const line = state.doc.lineAt(range.from);
                        const lineText = line.text;
                        let spaces = 0;

                        // Count spaces at beginning of line (up to 2)
                        for (let i = 0; i < Math.min(2, lineText.length); i++) {
                            if (lineText[i] === ' ') spaces++;
                            else break;
                        }

                        if (spaces > 0) {
                            changes.push({ from: line.from, to: line.from + spaces, insert: '' });
                            newRanges.push({
                                anchor: range.anchor - spaces,
                                head: range.head - spaces
                            });
                        } else {
                            newRanges.push({ anchor: range.anchor, head: range.head });
                        }
                    }

                    if (changes.length > 0) {
                        editorView.dispatch({
                            changes,
                            selection: { anchor: newRanges[0].anchor, head: newRanges[0].head }
                        });
                    }
                } else {
                    // Tab: Add indentation
                    const changes = [];
                    const newRanges = [];

                    for (const range of selection.ranges) {
                        changes.push({ from: range.from, insert: '  ' });
                        newRanges.push({
                            anchor: range.anchor + 2,
                            head: range.head + 2
                        });
                    }

                    editorView.dispatch({
                        changes,
                        selection: { anchor: newRanges[0].anchor, head: newRanges[0].head }
                    });
                }
            }
        }, true);
    } else {
        // Fallback to textarea
        const textarea = document.createElement('textarea');
        textarea.value = initialCode;
        textarea.style.width = '100%';
        textarea.style.height = '100%';
        textarea.style.background = '#1e1e1e';
        textarea.style.color = '#d4d4d4';
        textarea.style.fontFamily = 'Monaco, Menlo, monospace';
        textarea.style.fontSize = '13px';
        textarea.style.border = 'none';
        textarea.style.outline = 'none';
        textarea.style.padding = '10px';
        textarea.style.resize = 'none';
        textarea.addEventListener('input', () => {
            if (!isAutoFilling) {
                configDirty = true;
            }
        });
        editorEl.appendChild(textarea);

        // Create a simple API to match CodeMirror
        editorView = {
            dom: textarea,
            state: { doc: { toString: () => textarea.value } },
            dispatch: () => {}
        };
    }

    // CRITICAL: Reset dirty flag after initial setup
    configDirty = false;
    isAutoFilling = false;

    setTimeout(() => {
        configDirty = false;
    }, 100);
}

function setupCanvasColor() {
    const input = elements.canvasColorInput;
    if (!input) {
        return;
    }
    input.value = currentCanvasColor;
    input.addEventListener('input', (event) => {
        currentCanvasColor = event.target.value || '#0d1117';
        updateCanvasBackground();
        logEvent('ui', 'canvas-color', `Canvas color changed to ${currentCanvasColor}`);
    });
    updateCanvasBackground();
}

function setupDemoButton() {
    const button = document.getElementById('demo-bundle-btn');
    if (!button) {
        return;
    }

    const setButtonState = (enabled) => {
        button.disabled = !enabled;
        button.classList.toggle('demo-button--disabled', !enabled);
        button.title = enabled
            ? 'Package the current animation into a demo executable'
            : 'Available in the desktop app';
    };

    const refreshState = () => {
        setButtonState(Boolean(getTauriInvoker()));
    };

    refreshState();

    let attempts = 0;
    const maxAttempts = 20;
    const interval = setInterval(() => {
        refreshState();
        if (getTauriInvoker()) {
            clearInterval(interval);
            return;
        }
        attempts += 1;
        if (attempts >= maxAttempts) {
            clearInterval(interval);
        }
    }, 300);

    window.addEventListener(
        'tauri://ready',
        () => {
            refreshState();
        },
        { once: true },
    );
}

function setupPanelResizers() {
    const grid = elements.mainGrid;
    const leftResizer = elements.leftResizer;
    const rightResizer = elements.rightResizer;
    if (!grid || !leftResizer || !rightResizer) {
        return;
    }

    const setGridVar = (key, value) => {
        grid.style.setProperty(key, `${Math.round(value)}px`);
    };

    const startResizerDrag = (event, side) => {
        if ((side === 'left' && !isLeftPanelVisible) || (side === 'right' && !isRightPanelVisible)) {
            return;
        }
        event.preventDefault();
        const gridRect = grid.getBoundingClientRect();
        const startX = event.clientX;
        const initialLeft = grid.style.getPropertyValue('--left-width')
            ? parseFloat(grid.style.getPropertyValue('--left-width'))
            : elements.configPanel?.offsetWidth || 340;
        const initialRight = grid.style.getPropertyValue('--right-width')
            ? parseFloat(grid.style.getPropertyValue('--right-width'))
            : elements.rightPanel?.offsetWidth || 330;

        const activeResizer = side === 'left' ? leftResizer : rightResizer;
        activeResizer.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - startX;
            if (side === 'left') {
                const maxLeft = Math.max(260, gridRect.width - initialRight - 380);
                const nextLeft = clamp(initialLeft + deltaX, 240, maxLeft);
                setGridVar('--left-width', nextLeft);
            } else {
                const maxRight = Math.max(320, gridRect.width - initialLeft - 320);
                const nextRight = clamp(initialRight - deltaX, 260, maxRight);
                setGridVar('--right-width', nextRight);
            }
            handleResize();
        };

        const onUp = () => {
            activeResizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            handleResize();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    leftResizer.addEventListener('mousedown', (event) => startResizerDrag(event, 'left'));
    rightResizer.addEventListener('mousedown', (event) => startResizerDrag(event, 'right'));
}

function setupCenterResizer() {
    const centerPanel = elements.centerPanel;
    const centerResizer = elements.centerResizer;
    if (!centerPanel || !centerResizer) {
        return;
    }

    centerResizer.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = centerPanel.style.getPropertyValue('--center-log-height')
            ? parseFloat(centerPanel.style.getPropertyValue('--center-log-height'))
            : 230;

        centerResizer.classList.add('is-dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        const onMove = (moveEvent) => {
            const deltaY = moveEvent.clientY - startY;
            const nextHeight = clamp(startHeight - deltaY, 120, 420);
            centerPanel.style.setProperty('--center-log-height', `${Math.round(nextHeight)}px`);
            handleResize();
        };

        const onUp = () => {
            centerResizer.classList.remove('is-dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            handleResize();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

function setupPanelVisibilityToggles() {
    const grid = elements.mainGrid;
    const leftButton = elements.toggleLeftPanelButton;
    const rightButton = elements.toggleRightPanelButton;
    const showLeftButton = elements.showLeftPanelButton;
    const showRightButton = elements.showRightPanelButton;
    if (!grid || !leftButton || !rightButton || !showLeftButton || !showRightButton) {
        return;
    }

    const applyVisibility = () => {
        grid.classList.toggle('left-hidden', !isLeftPanelVisible);
        grid.classList.toggle('right-hidden', !isRightPanelVisible);
        leftButton.classList.toggle('is-collapsed', !isLeftPanelVisible);
        rightButton.classList.toggle('is-collapsed', !isRightPanelVisible);
        leftButton.setAttribute('aria-pressed', String(isLeftPanelVisible));
        rightButton.setAttribute('aria-pressed', String(isRightPanelVisible));
        leftButton.title = isLeftPanelVisible ? 'Hide Script Panel' : 'Show Script Panel';
        rightButton.title = isRightPanelVisible ? 'Hide Properties Panel' : 'Show Properties Panel';
        leftButton.setAttribute('aria-label', leftButton.title);
        rightButton.setAttribute('aria-label', rightButton.title);
        showLeftButton.hidden = isLeftPanelVisible;
        showRightButton.hidden = isRightPanelVisible;
        handleResize();
        // Resize again after the CSS grid transition completes (0.2s)
        setTimeout(handleResize, 250);
    };

    leftButton.addEventListener('click', () => {
        isLeftPanelVisible = !isLeftPanelVisible;
        applyVisibility();
    });

    rightButton.addEventListener('click', () => {
        isRightPanelVisible = !isRightPanelVisible;
        applyVisibility();
    });

    showLeftButton.addEventListener('click', () => {
        isLeftPanelVisible = true;
        applyVisibility();
    });

    showRightButton.addEventListener('click', () => {
        isRightPanelVisible = true;
        applyVisibility();
    });

    applyVisibility();
}

function setupEventLog() {
    const nativeToggle = elements.eventFilterNative;
    const riveUserToggle = elements.eventFilterRiveUser;
    const uiToggle = elements.eventFilterUi;
    const searchInput = elements.eventFilterSearch;
    const clearButton = elements.eventLogClearButton;
    if (!nativeToggle || !riveUserToggle || !uiToggle || !searchInput || !clearButton) {
        return;
    }

    const syncFilterToggle = (element, active) => {
        element.classList.toggle('is-active', active);
        element.setAttribute('aria-pressed', String(active));
    };

    syncFilterToggle(nativeToggle, eventFilterState.native);
    syncFilterToggle(riveUserToggle, eventFilterState.riveUser);
    syncFilterToggle(uiToggle, eventFilterState.ui);
    searchInput.value = '';

    nativeToggle.addEventListener('click', () => {
        eventFilterState.native = !eventFilterState.native;
        syncFilterToggle(nativeToggle, eventFilterState.native);
        renderEventLog();
    });
    riveUserToggle.addEventListener('click', () => {
        eventFilterState.riveUser = !eventFilterState.riveUser;
        syncFilterToggle(riveUserToggle, eventFilterState.riveUser);
        renderEventLog();
    });
    uiToggle.addEventListener('click', () => {
        eventFilterState.ui = !eventFilterState.ui;
        syncFilterToggle(uiToggle, eventFilterState.ui);
        renderEventLog();
    });
    searchInput.addEventListener('input', () => {
        eventFilterState.search = searchInput.value.trim().toLowerCase();
        renderEventLog();
    });
    clearButton.addEventListener('click', () => {
        resetEventLog();
        logEvent('ui', 'log-cleared', 'Event log cleared.');
    });

    // Collapse/expand via header click (div-based, not <details>)
    const eventLogHeader = document.getElementById('event-log-header');
    const eventLogPanel = elements.eventLogPanel;
    const centerPanel = elements.centerPanel;
    const showEventLogBtn = document.getElementById('show-event-log-btn');

    if (eventLogHeader && eventLogPanel && centerPanel) {
        eventLogHeader.addEventListener('click', (e) => {
            // Don't toggle when clicking filters/search/clear
            if (e.target.closest('.event-log-summary-right')) return;
            const isCollapsed = centerPanel.classList.toggle('event-log-collapsed');
            eventLogPanel.classList.toggle('collapsed', isCollapsed);
            if (showEventLogBtn) showEventLogBtn.hidden = !isCollapsed;
            handleResize();
            setTimeout(handleResize, 300);
        });

        if (showEventLogBtn) {
            showEventLogBtn.addEventListener('click', () => {
                centerPanel.classList.remove('event-log-collapsed');
                eventLogPanel.classList.remove('collapsed');
                showEventLogBtn.hidden = true;
                handleResize();
                setTimeout(handleResize, 300);
            });
        }
    }
}

function resetEventLog() {
    eventLogEntries.length = 0;
    eventLogSequence = 0;
    renderEventLog();
}

function logEvent(source, type, message, payload) {
    eventLogEntries.unshift({
        id: ++eventLogSequence,
        source,
        type,
        message,
        payload,
        timestamp: Date.now(),
    });
    if (eventLogEntries.length > EVENT_LOG_LIMIT) {
        eventLogEntries.length = EVENT_LOG_LIMIT;
    }
    renderEventLog();
}

function renderEventLog() {
    const list = elements.eventLogList;
    const count = elements.eventLogCount;
    if (!list || !count) {
        return;
    }

    const filtered = eventLogEntries.filter((entry) => {
        if (entry.source === 'native' && !eventFilterState.native) {
            return false;
        }
        if (entry.source === 'rive-user' && !eventFilterState.riveUser) {
            return false;
        }
        if (entry.source === 'ui' && !eventFilterState.ui) {
            return false;
        }
        if (eventFilterState.search) {
            const haystack = `${entry.source} ${entry.type} ${entry.message} ${entry.payload ? safeJson(entry.payload) : ''}`.toLowerCase();
            if (!haystack.includes(eventFilterState.search)) {
                return false;
            }
        }
        return true;
    });

    count.textContent = String(filtered.length);
    list.innerHTML = '';
    if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No events match current filters.';
        list.appendChild(empty);
        return;
    }

    filtered.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'event-log-row';

        const time = document.createElement('span');
        time.className = 'event-row-time';
        time.textContent = formatEventTime(entry.timestamp);

        const source = document.createElement('span');
        source.className = `event-row-kind ${entry.source}`;
        source.textContent = entry.source === 'rive-user' ? 'USER' : entry.source;

        const message = document.createElement('span');
        message.className = 'event-row-message';
        message.textContent = formatEventRowMessage(entry);
        message.title = message.textContent;

        row.appendChild(time);
        row.appendChild(source);
        row.appendChild(message);
        list.appendChild(row);
    });
}

function formatEventRowMessage(entry) {
    const parts = [];
    if (entry.type) parts.push(entry.type);
    if (entry.message && entry.message !== entry.type) parts.push(entry.message);
    if (entry.payload) {
        const p = entry.payload;
        if (typeof p === 'object' && p !== null) {
            const keys = Object.keys(p).filter(k => k !== 'type' && k !== 'name');
            if (keys.length) {
                const vals = keys.map(k => {
                    const v = p[k];
                    if (typeof v === 'number') return `${k}: ${roundNum(v)}`;
                    if (typeof v === 'string') return `${k}: ${v}`;
                    return `${k}: ${JSON.stringify(v)}`;
                });
                parts.push(vals.join('  '));
            }
        } else {
            parts.push(String(p));
        }
    }
    return parts.join(' \u2022 ');
}

function roundNum(n) {
    if (Number.isInteger(n)) return String(n);
    return Number(n.toFixed(3)).toString();
}

function formatEventTime(timestamp) {
    const date = new Date(timestamp);
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const cs = String(Math.floor(date.getMilliseconds() / 10)).padStart(2, '0');
    return `${h}:${m}:${s}.${cs}`;
}

function safeJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function safelyInvokeUserCallback(callback, event, callbackName) {
    if (typeof callback !== 'function') {
        return;
    }
    try {
        callback(event);
    } catch (error) {
        console.warn(`Error in user ${callbackName}:`, error);
    }
}

function clearRiveEventListeners() {
    riveEventUnsubscribers.forEach((unsubscribe) => {
        try {
            unsubscribe();
        } catch {
            /* noop */
        }
    });
    riveEventUnsubscribers = [];
}

function attachRiveUserEventListeners(runtime, instance) {
    clearRiveEventListeners();
    console.log('[rive-viewer] attachRiveUserEventListeners: runtime.EventType:', runtime?.EventType, 'instance.on:', typeof instance?.on);
    if (!runtime?.EventType || !instance || typeof instance.on !== 'function') {
        console.warn('[rive-viewer] cannot attach event listeners: missing EventType or .on() method');
        return;
    }

    const eventType = runtime.EventType.RiveEvent;
    console.log('[rive-viewer] RiveEvent type:', eventType);
    if (!eventType) {
        console.warn('[rive-viewer] runtime.EventType.RiveEvent is falsy');
        return;
    }

    const listener = (event) => {
        console.log('[rive-viewer] Rive user event received:', event);
        const payload = event?.data ?? event;
        const eventName = payload?.name || event?.name || 'unknown';
        logEvent('rive-user', eventName, '', payload);
    };

    instance.on(eventType, listener);
    riveEventUnsubscribers.push(() => {
        if (typeof instance.off === 'function') {
            instance.off(eventType, listener);
        }
    });
    console.log('[rive-viewer] Rive event listener attached successfully');
}

function setCurrentFile(url, name, isObjectUrl = false, buffer, mimeType, fileSizeBytes) {
    if (lastObjectUrl && lastObjectUrl !== url) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }

    if (isObjectUrl) {
        lastObjectUrl = url;
    }

    currentFileUrl = url;
    currentFileName = name;
    if (buffer instanceof ArrayBuffer) {
        currentFileBuffer = buffer;
    }
    if (mimeType) {
        currentFileMimeType = mimeType;
    }
    if (Number.isFinite(fileSizeBytes)) {
        currentFileSizeBytes = Number(fileSizeBytes);
    }
    updateFileTriggerButton(name ? 'loaded' : 'empty', name);
    refreshInfoStrip();
}

async function loadRiveAnimation(fileUrl, fileName) {
    if (!fileUrl) {
        showError('Please load a Rive file first');
        return;
    }

    console.log('[rive-viewer] loadRiveAnimation:', fileName, currentRuntime);
    updateInfo(`Loading ${fileName} (${currentRuntime})...`);
    resetVmInputControls('Loading ViewModel inputs...');
    logEvent('native', 'load-start', `Loading ${fileName} on ${currentRuntime}.`);

    try {
        const runtime = await ensureRuntime(currentRuntime);
        const container = elements.canvasContainer;
        if (!runtime || !container) {
            throw new Error('Runtime or canvas container is not available');
        }
        console.log('[rive-viewer] runtime loaded, Rive constructor:', typeof runtime.Rive);

        cleanupInstance();
        container.innerHTML = '';

        const canvas = document.createElement('canvas');
        canvas.id = 'rive-canvas';
        container.appendChild(canvas);
        resizeCanvas(canvas);
        console.log('[rive-viewer] canvas:', canvas.width, 'x', canvas.height);

        const userConfig = getEditorConfig();
        lastInitConfig = { ...userConfig };
        const config = { ...userConfig };
        console.log('[rive-viewer] config:', JSON.stringify(Object.keys(config)));

        // Preserve user callbacks and wrap them so native events are logged.
        const userOnLoad = config.onLoad;
        const userOnLoadError = config.onLoadError;
        const userOnPlay = config.onPlay;
        const userOnPause = config.onPause;
        const userOnStop = config.onStop;
        const userOnLoop = config.onLoop;
        const userOnStateChange = config.onStateChange;
        const userOnAdvance = config.onAdvance;
        const configuredStateMachines = normalizeStateMachineSelection(config.stateMachines);
        const configuredAnimations = normalizeAnimationSelection(config.animations);
        const userSpecifiedStateMachines = configuredStateMachines.length > 0;
        let didRestartForStateMachine = false;

        if (config.artboard) {
            currentArtboardName = config.artboard;
        }
        config.src = fileUrl;
        config.canvas = canvas;
        if (typeof config.autoBind === 'undefined') {
            config.autoBind = true;
        }
        const layoutFromConfig = config.layout && typeof config.layout === 'object' ? config.layout : {};
        const { alignment, fit: _ignoredFit, ...otherLayoutProps } = layoutFromConfig;
        config.layout = new runtime.Layout({
            fit: currentLayoutFit,
            alignment: alignment || 'center',
            ...otherLayoutProps,
        });

        config.onLoad = () => {
            console.log('[rive-viewer] onLoad fired, riveInstance:', !!riveInstance);

            // Auto-detect state machine: if user didn't specify one, discover from
            // the artboard and restart the instance with it in the constructor config.
            if (!didRestartForStateMachine && !userSpecifiedStateMachines) {
                // Use artboard low-level API (same pattern as rive_dev_playground parser)
                let detectedSmName = null;
                try {
                    const artboard = riveInstance?.artboard;
                    if (artboard && typeof artboard.stateMachineCount === 'function') {
                        const count = artboard.stateMachineCount();
                        if (count > 0) {
                            const sm = artboard.stateMachineByIndex(0);
                            if (sm && sm.name) detectedSmName = sm.name;
                        }
                    }
                } catch { /* noop */ }

                // Fallback to high-level API
                if (!detectedSmName) {
                    const names = Array.isArray(riveInstance?.stateMachineNames) ? riveInstance.stateMachineNames : [];
                    if (names.length > 0) detectedSmName = names[0];
                }

                if (detectedSmName) {
                    console.log('[rive-viewer] detected state machine:', detectedSmName, '— restarting with it');
                    didRestartForStateMachine = true;

                    // Clean up current instance
                    clearRiveEventListeners();
                    try { riveInstance.cleanup(); } catch { /* noop */ }

                    // Recreate canvas (WebGL context needs a fresh canvas)
                    container.innerHTML = '';
                    const newCanvas = document.createElement('canvas');
                    newCanvas.id = 'rive-canvas';
                    container.appendChild(newCanvas);
                    resizeCanvas(newCanvas);

                    // Restart with state machine specified
                    config.canvas = newCanvas;
                    config.stateMachines = detectedSmName;
                    riveInstance = new runtime.Rive(config);
                    window.riveInst = riveInstance;
                    attachRiveUserEventListeners(runtime, riveInstance);
                    return; // New instance will fire onLoad again
                }
            }

            hideError();
            const activeCanvas = config.canvas;
            resizeCanvas(activeCanvas);
            riveInstance?.resizeDrawingSurfaceToCanvas();
            logEvent('native', 'load', `Loaded ${fileName} using ${currentRuntime}.`);

            // Get state machine names from instance
            const names = Array.isArray(riveInstance?.stateMachineNames) ? riveInstance.stateMachineNames : [];
            const playingStateMachines = Array.isArray(riveInstance?.playingStateMachineNames)
                ? riveInstance.playingStateMachineNames
                : [];

            console.log('[rive-viewer] onLoad state:', {
                stateMachineNames: names,
                playingStateMachines,
                configuredSM: config.stateMachines,
                isPaused: riveInstance?.isPaused,
                isPlaying: riveInstance?.isPlaying,
                viewModelInstance: !!riveInstance?.viewModelInstance,
            });

            // Show which state machine is initialized
            let activeStateMachine = 'none';
            if (config.stateMachines) {
                activeStateMachine = Array.isArray(config.stateMachines)
                    ? config.stateMachines[0]
                    : config.stateMachines;
            } else if (names.length > 0) {
                activeStateMachine = names[0];
            }

            const statusMsg = names.length > 0
                ? `Loaded: ${fileName} (${currentRuntime}) - state machine "${activeStateMachine}" active`
                : `Loaded: ${fileName} (${currentRuntime}) - no state machines`;
            updateInfo(statusMsg);
            currentArtboardName = riveInstance?.artboard?.name || currentArtboardName || config.artboard || null;
            refreshInfoStrip();

            // Call user's onLoad callback if provided
            if (typeof userOnLoad === 'function') {
                try {
                    userOnLoad();
                } catch (e) {
                    console.warn('Error in user onLoad:', e);
                }
            }

            renderVmInputControls();
        };

        config.onLoadError = (error) => {
            const errorMsg = error?.message || error?.toString() || String(error);
            showError(`Error loading animation: ${errorMsg}`);
            logEvent('native', 'loaderror', `Load error for ${fileName}.`, error);
            safelyInvokeUserCallback(userOnLoadError, error, 'onLoadError');
        };
        config.onPlay = (event) => {
            logEvent('native', 'play', 'Playback started by runtime.', event);
            safelyInvokeUserCallback(userOnPlay, event, 'onPlay');
        };
        config.onPause = (event) => {
            logEvent('native', 'pause', 'Playback paused by runtime.', event);
            safelyInvokeUserCallback(userOnPause, event, 'onPause');
        };
        config.onStop = (event) => {
            logEvent('native', 'stop', 'Playback stopped by runtime.', event);
            safelyInvokeUserCallback(userOnStop, event, 'onStop');
        };
        config.onLoop = (event) => {
            logEvent('native', 'loop', 'Loop event emitted by runtime.', event);
            safelyInvokeUserCallback(userOnLoop, event, 'onLoop');
        };
        config.onStateChange = (event) => {
            logEvent('native', 'statechange', 'State machine changed state.', event);
            safelyInvokeUserCallback(userOnStateChange, event, 'onStateChange');
        };
        config.onAdvance = (event) => {
            updatePlaybackChips();
            safelyInvokeUserCallback(userOnAdvance, event, 'onAdvance');
        };

        // Remove undefined keys — Rive runtime treats {stateMachines: undefined}
        // differently from omitting the key (undefined prevents auto-detection)
        Object.keys(config).forEach((key) => {
            if (config[key] === undefined) {
                delete config[key];
            }
        });

        console.log('[rive-viewer] creating Rive instance with:', {
            src: typeof config.src,
            canvas: !!config.canvas,
            autoplay: config.autoplay,
            autoBind: config.autoBind,
            stateMachines: config.stateMachines,
            configKeys: Object.keys(config),
        });
        riveInstance = new runtime.Rive(config);
        console.log('[rive-viewer] Rive instance created:', !!riveInstance);
        // Expose globally for code editor access
        window.riveInst = riveInstance;
        attachRiveUserEventListeners(runtime, riveInstance);
    } catch (error) {
        console.error('[rive-viewer] loadRiveAnimation error:', error);
        showError(`Error initializing Rive: ${error.message}`);
        logEvent('native', 'init-error', 'Error initializing runtime instance.', error);
        throw error;
    }
}

async function applyCodeAndReload() {
    if (!currentFileUrl || !currentFileName) {
        showError('Please load a Rive file first');
        return;
    }

    logEvent('ui', 'apply-reload', 'Applied editor config and reloaded animation.');
    try {
        await loadRiveAnimation(currentFileUrl, currentFileName);
    } catch {
        // loadRiveAnimation already reported the error
    }
}

function play() {
    console.log('[rive-viewer] play() called, riveInstance:', !!riveInstance);
    if (riveInstance) {
        riveInstance.play();
        updateInfo('Playing');
        logEvent('ui', 'play', 'Playback started from UI.');
    } else {
        console.warn('[rive-viewer] play() called but no riveInstance');
    }
}

function pause() {
    console.log('[rive-viewer] pause() called, riveInstance:', !!riveInstance);
    if (riveInstance) {
        riveInstance.pause();
        updateInfo('Paused');
        logEvent('ui', 'pause', 'Playback paused from UI.');
    }
}

function reset() {
    console.log('[rive-viewer] reset() called, riveInstance:', !!riveInstance);
    if (riveInstance) {
        riveInstance.reset();
        resetPlaybackChips();
        updateInfo('Reset');
        logEvent('ui', 'reset', 'Animation reset from UI.');
    }
}

let devToolsEnabled = false;

async function injectCodeSnippet() {
    // Open dev tools in Tauri desktop app
    const invoke = getTauriInvoker();
    if (invoke && !devToolsEnabled) {
        try {
            devToolsEnabled = true;
            await invoke('open_devtools');
        } catch { /* noop */ }
    }

    if (!editorView) {
        showError('Code editor is not available');
        return;
    }

    try {
        const currentCode = editorView.state.doc.toString();
        const hasVmExplorer = currentCode.includes('vmExplore') || currentCode.includes('vmRootInstance');

        // Toggle: if explorer is present, revert to default; otherwise inject explorer
        let newCode;
        if (hasVmExplorer) {
            // Revert to default — replace onLoad block with simple version
            newCode = replaceOnLoadBlock(currentCode, `onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  }`);
            updateInfo('VM explorer removed — restored default');
            console.log('VM explorer removed. Default onLoad restored.');
        } else {
            // Load the explorer snippet from external file
            let explorerOnLoad = null;
            try {
                const resp = await fetch('/vm-explorer-snippet.js');
                if (resp.ok) {
                    const text = await resp.text();
                    // The file wraps the snippet in: const vmExplorerSnippet = `...`;
                    // Extract just the onLoad: () => { ... } portion
                    const startMarker = 'onLoad: () => {';
                    const startIdx = text.indexOf(startMarker);
                    if (startIdx !== -1) {
                        // Find matching closing brace using brace counting from the opening {
                        const braceStart = text.indexOf('{', startIdx + 'onLoad:'.length);
                        explorerOnLoad = extractBraceBlock(text, startIdx, 'onLoad:');
                    }
                }
            } catch { /* noop */ }

            if (!explorerOnLoad) {
                showError('Could not load VM explorer snippet');
                return;
            }

            newCode = replaceOnLoadBlock(currentCode, explorerOnLoad);
            updateInfo('VM explorer injected — click Apply & Reload');
            console.log('%cVM Explorer injected. Click Apply & Reload to activate.', 'color: #C4F82A; font-weight: bold');
            console.log('After reload: vmExplore(), vmGet("path"), vmSet("path", val), vmFire("path")');
        }

        if (!newCode || newCode === currentCode) {
            showError('Could not modify onLoad block — check editor code syntax');
            return;
        }

        // Update editor
        if (editorView.dispatch) {
            editorView.dispatch({
                changes: { from: 0, to: editorView.state.doc.length, insert: newCode }
            });
        }
    } catch (error) {
        showError(`Failed to modify code: ${error.message}`);
    }
}

// Replace the onLoad: () => { ... } block in config code using brace matching.
// If no onLoad exists, inserts before the closing })
function replaceOnLoadBlock(code, replacement) {
    const onLoadIdx = code.indexOf('onLoad:');
    if (onLoadIdx === -1) {
        // No onLoad — insert before closing paren of ({...})
        const lastClose = code.lastIndexOf('}');
        if (lastClose === -1) return null;
        // Find whether we need a comma
        const before = code.substring(0, lastClose).trimEnd();
        const needsComma = before.endsWith(',') ? '' : ',';
        return before + needsComma + '\n  ' + replacement.trim() + '\n' + code.substring(lastClose);
    }

    // Find the opening brace of the onLoad function body
    const braceStart = code.indexOf('{', onLoadIdx + 'onLoad:'.length);
    if (braceStart === -1) return null;

    // Count braces to find the matching close
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) return null;

    return code.substring(0, onLoadIdx) + replacement.trim() + code.substring(end + 1);
}

// Extract onLoad: () => { ... } block from text starting at onLoadIdx using brace matching
function extractBraceBlock(text, onLoadIdx, prefix) {
    const braceStart = text.indexOf('{', onLoadIdx + prefix.length);
    if (braceStart === -1) return null;

    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) return null;

    return text.substring(onLoadIdx, end + 1);
}

// Serialize the current VM hierarchy with live values for embedding in demo exports
function serializeVmHierarchy() {
    const rootVm = resolveVmRootInstance();
    if (!rootVm) return null;
    const hierarchy = buildVmHierarchy(rootVm);
    if (!hierarchy) return null;

    function serializeNode(node) {
        return {
            label: node.label,
            path: node.path,
            kind: node.kind,
            inputs: (node.inputs || []).map(input => {
                let value = null;
                try {
                    const accessor = resolveVmAccessor(input.path, input.kind);
                    if (accessor && input.kind !== 'trigger') {
                        value = accessor.value;
                    }
                    // For enums, also capture available values
                    if (accessor && input.kind === 'enum' && Array.isArray(accessor.values)) {
                        return { name: input.name, path: input.path, kind: input.kind, value, enumValues: accessor.values };
                    }
                } catch { /* noop */ }
                return { name: input.name, path: input.path, kind: input.kind, value };
            }),
            children: (node.children || []).map(serializeNode),
        };
    }

    return serializeNode(hierarchy);
}

async function createDemoBundle() {
    const invoke = getTauriInvoker();
    if (!invoke) {
        showError('Demo bundles can only be created inside the desktop app.');
        return;
    }

    if (!currentFileBuffer || !currentFileName) {
        showError('Please load a Rive file first.');
        return;
    }

    const exportRuntime = elements.runtimeSelect?.value || currentRuntime;
    try {
        await ensureRuntime(exportRuntime);
    } catch (error) {
        showError(`Failed to prepare ${exportRuntime} runtime for export.`);
        logEvent('ui', 'demo-build-runtime-error', `Runtime prep failed for ${exportRuntime}.`, error);
        return;
    }

    const runtimeAsset = runtimeAssets[exportRuntime];
    if (!runtimeAsset?.text) {
        showError(`Runtime data for ${exportRuntime} is not ready yet. Please wait for it to finish loading.`);
        return;
    }

    const configuredStateMachines = normalizeStateMachineSelection(lastInitConfig.stateMachines);
    const detectedStateMachines = Array.isArray(riveInstance?.stateMachineNames)
        ? riveInstance.stateMachineNames
        : [];
    const stateMachines = configuredStateMachines.length ? configuredStateMachines : detectedStateMachines;

    // Snapshot the current VM hierarchy with live values
    const vmHierarchy = serializeVmHierarchy();

    const payload = {
        file_name: currentFileName,
        animation_base64: arrayBufferToBase64(currentFileBuffer),
        runtime_name: exportRuntime,
        runtime_version: runtimeAsset.version,
        runtime_script: runtimeAsset.text,
        autoplay: typeof lastInitConfig.autoplay === 'boolean' ? lastInitConfig.autoplay : true,
        layout_fit: currentLayoutFit,
        state_machines: stateMachines,
        artboard_name: currentArtboardName,
        canvas_color: currentCanvasColor,
        vm_hierarchy: vmHierarchy ? JSON.stringify(vmHierarchy) : null,
    };

    updateInfo('Building demo bundle...');
    logEvent('ui', 'demo-build', `Building demo bundle for ${currentFileName} (${exportRuntime}).`);
    try {
        const outputPath = await invoke('make_demo_bundle', { payload });
        updateInfo(`Demo bundle saved to: ${outputPath}`);
        logEvent('ui', 'demo-build-success', `Demo bundle saved: ${outputPath}`);
    } catch (error) {
        showError(`Failed to create demo bundle: ${error.message || error}`);
        logEvent('ui', 'demo-build-failed', 'Failed to build demo bundle.', error);
    }
}

function getRuntimeDisplayName(runtimeName = currentRuntime) {
    return runtimeName === 'canvas' ? 'Canvas' : 'WebGL';
}

function updatePlaybackChips() {
    frameCount += 1;
    const now = performance.now();
    if (now - lastFpsUpdate >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        const fpsChip = document.getElementById('fps-chip');
        if (fpsChip) {
            fpsChip.innerHTML = `<span class="dot"></span>${fps} FPS`;
        }
        frameCount = 0;
        lastFpsUpdate = now;
    }
}

function resetPlaybackChips() {
    frameCount = 0;
    lastFpsUpdate = performance.now();
    const fpsChip = document.getElementById('fps-chip');
    if (fpsChip) fpsChip.innerHTML = '<span class="dot"></span>-- FPS';
}

function formatByteSize(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return '';
    }
    if (value < 1024) {
        return `${value} B`;
    }
    const kib = value / 1024;
    if (kib < 1024) {
        return `${kib.toFixed(1)} KB`;
    }
    return `${(kib / 1024).toFixed(2)} MB`;
}

function refreshInfoStrip() {
    if (elements.runtimeStripRuntime) {
        elements.runtimeStripRuntime.innerHTML = `<span class="dot dot-sm" aria-hidden="true"></span>Runtime: ${getRuntimeDisplayName(currentRuntime)}`;
    }
    if (elements.runtimeStripVersion) {
        const runtimeVersion = runtimeVersions[currentRuntime] || runtimeRegistry[currentRuntime]?.version || RIVE_VERSION;
        elements.runtimeStripVersion.textContent = `v${runtimeVersion}`;
    }
    if (elements.runtimeStripBuild) {
        elements.runtimeStripBuild.textContent = `build ${getBuildIdLabel()}`;
    }
    if (elements.runtimeStripFile) {
        if (currentFileName) {
            const sizeLabel = formatByteSize(currentFileSizeBytes);
            const fileLabel = sizeLabel ? `${currentFileName} \u00B7 ${sizeLabel}` : currentFileName;
            elements.runtimeStripFile.innerHTML = `<i data-lucide="file" class="lucide-10"></i>${escapeHtml(fileLabel)}`;
            initLucideIcons();
        } else {
            elements.runtimeStripFile.innerHTML = '<i data-lucide="file" class="lucide-10"></i>No animation loaded';
            initLucideIcons();
        }
    }
}

function updateInfo(message) {
    if (elements.info) {
        elements.info.textContent = message;
    }
    refreshInfoStrip();
}

function showError(message) {
    if (elements.error) {
        elements.error.textContent = message;
        elements.error.classList.add('visible');
        if (errorTimeoutId) {
            clearTimeout(errorTimeoutId);
        }
        errorTimeoutId = setTimeout(() => {
            hideError();
        }, 6000);
    }
}

function hideError() {
    if (elements.error) {
        elements.error.textContent = '';
        elements.error.classList.remove('visible');
    }
    if (errorTimeoutId) {
        clearTimeout(errorTimeoutId);
        errorTimeoutId = null;
    }
}

function getEditorConfig() {
    if (!editorView) {
        console.log('[rive-viewer] getEditorConfig: no editorView, returning {}');
        return {};
    }

    const code = editorView.state.doc.toString().trim();
    if (!code) {
        return {};
    }

    let result;
    try {
        // Evaluate JavaScript code with access to global scope
        // Wrap in parentheses to handle leading comments
        const wrappedCode = `(function() {
            return (
                ${code}
            );
        })()`;
        result = eval(wrappedCode);
    } catch (error) {
        throw new Error(`Invalid JavaScript config: ${error.message}`);
    }

    if (!result || Array.isArray(result) || typeof result !== 'object') {
        throw new Error('Initialization config must return an object');
    }

    return result;
}

function resizeCanvas(canvas) {
    const container = elements.canvasContainer;
    if (!container || !canvas) {
        return;
    }
    const { clientWidth, clientHeight } = container;
    canvas.width = clientWidth;
    canvas.height = clientHeight;
}

function handleResize() {
    const canvas = document.getElementById('rive-canvas');
    if (!canvas) {
        return;
    }
    resizeCanvas(canvas);
    if (riveInstance) {
        riveInstance.resizeDrawingSurfaceToCanvas();
    }
}

function cleanupInstance() {
    clearRiveEventListeners();
    resetPlaybackChips();
    if (riveInstance?.cleanup) {
        try {
            riveInstance.cleanup();
        } catch (e) {
            // WebGL context may already be lost during cleanup — safe to ignore
            console.warn('[rive-viewer] cleanup error (WebGL context loss):', e.message);
        }
    }
    riveInstance = null;
    window.riveInst = null;
    resetVmInputControls('No animation loaded.');
}

function revokeLastObjectUrl() {
    if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }
}

function updateCanvasBackground() {
    if (elements.canvasContainer) {
        elements.canvasContainer.style.background = currentCanvasColor;
    }
}

function updateVersionInfo(statusMessage) {
    if (!elements.versionInfo) {
        return;
    }

    const appVersion = resolvedAppVersion || 'dev';
    const releaseLine = `Release: v${appVersion} · Build: ${getBuildIdLabel()}`;
    const footer = '<div class="version-footer">© 2025 IVG Design · MIT License · Runtime © Rive</div>';

    if (statusMessage) {
        elements.versionInfo.innerHTML = `${releaseLine}<br>${statusMessage}${footer}`;
        refreshInfoStrip();
        return;
    }

    const runtime = runtimeRegistry[currentRuntime];
    if (!runtime) {
        elements.versionInfo.innerHTML = `${releaseLine}<br>Runtime ${currentRuntime} is loading...${footer}`;
        refreshInfoStrip();
        return;
    }

    const version = runtimeVersions[currentRuntime] || runtime.version || 'resolving...';
    const source = runtimeResolvedUrls[currentRuntime] || runtimeSources[currentRuntime];
    elements.versionInfo.innerHTML = `
        ${releaseLine}<br>
        Runtime: ${currentRuntime}<br>
        Version: ${version}<br>
        Source: ${source}
        ${footer}
    `;
    refreshInfoStrip();
}

function loadRuntime(runtimeName) {
    if (runtimeRegistry[runtimeName]) {
        return Promise.resolve(runtimeRegistry[runtimeName]);
    }

    if (runtimePromises[runtimeName]) {
        return runtimePromises[runtimeName];
    }

    const scriptUrl = runtimeSources[runtimeName];
    if (!scriptUrl) {
        return Promise.reject(new Error(`Unknown runtime: ${runtimeName}`));
    }

    runtimePromises[runtimeName] = (async () => {
        const asset = await prepareRuntimeAsset(runtimeName);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = asset.objectUrl;
            script.async = true;
            script.onload = () => {
                if (!window.rive) {
                    reject(new Error('Runtime did not expose the expected API'));
                    return;
                }
                runtimeRegistry[runtimeName] = window.rive;
                if (runtimeName === currentRuntime) {
                    updateVersionInfo();
                }
                resolve(window.rive);
            };
            script.onerror = () => reject(new Error(`Failed to load runtime from ${script.src}`));
            document.head.appendChild(script);
        });
    })();

    return runtimePromises[runtimeName];
}

async function prepareRuntimeAsset(runtimeName) {
    if (runtimeAssets[runtimeName]) {
        return runtimeAssets[runtimeName];
    }

    const scriptUrl = runtimeSources[runtimeName];
    if (!scriptUrl) {
        throw new Error(`Unknown runtime: ${runtimeName}`);
    }

    const { resolvedUrl, version } = await resolveRuntimeSource(scriptUrl, runtimeName);
    const asset = await fetchRuntimeAsset(resolvedUrl);
    const record = {
        objectUrl: asset.objectUrl,
        text: asset.text,
        resolvedUrl,
        version: version || runtimeMeta[runtimeName]?.version || extractVersionFromUrl(resolvedUrl) || 'unknown',
    };

    if (runtimeBlobUrls[runtimeName]) {
        URL.revokeObjectURL(runtimeBlobUrls[runtimeName]);
    }

    runtimeBlobUrls[runtimeName] = record.objectUrl;
    runtimeSourceTexts[runtimeName] = record.text;
    runtimeResolvedUrls[runtimeName] = resolvedUrl;
    runtimeVersions[runtimeName] = record.version;
    runtimeAssets[runtimeName] = record;
    persistRuntimeMeta(runtimeName, {
        resolvedUrl,
        version: record.version,
        cachedAt: Date.now(),
    });

    return record;
}

async function fetchRuntimeAsset(resolvedUrl) {
    if (typeof caches === 'undefined') {
        return fetchRuntimeDirectly(resolvedUrl);
    }

    const cache = await caches.open(RUNTIME_CACHE_NAME);
    let response = await cache.match(resolvedUrl);
    if (!response) {
        response = await fetchRuntimeRequest(resolvedUrl);
        await cache.put(resolvedUrl, response.clone());
    }
    return responseToRuntimeAsset(response);
}

async function fetchRuntimeDirectly(resolvedUrl) {
    const response = await fetchRuntimeRequest(resolvedUrl);
    return responseToRuntimeAsset(response);
}

async function fetchRuntimeRequest(resolvedUrl) {
    const response = await fetch(resolvedUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to download runtime (${response.status})`);
    }
    return response;
}

async function responseToRuntimeAsset(response) {
    let text = await response.clone().text();

    // Strip sourceMappingURL to prevent blob warnings in Tauri/WebKit
    text = text.replace(/\/\/# sourceMappingURL=.*$/gm, '');

    // Create blob from cleaned text instead of original response
    const blob = new Blob([text], { type: 'application/javascript' });
    const objectUrl = URL.createObjectURL(blob);
    return { text, objectUrl };
}

async function ensureRuntime(runtimeName) {
    const runtime = await loadRuntime(runtimeName);
    window.rive = runtime;
    warnIfRuntimeLacksScripting(runtimeName);
    if (runtimeName === currentRuntime) {
        updateVersionInfo();
    }
    return runtime;
}

function warnIfRuntimeLacksScripting(runtimeName) {
    const version = runtimeVersions[runtimeName] || runtimeRegistry[runtimeName]?.version;
    if (!version || isSemverAtLeast(version, MIN_SCRIPTING_RUNTIME_VERSION)) {
        return;
    }
    const warningKey = `${runtimeName}@${version}`;
    if (runtimeWarningsShown.has(warningKey)) {
        return;
    }
    runtimeWarningsShown.add(warningKey);
    showError(`Runtime ${runtimeName}@${version} is below ${MIN_SCRIPTING_RUNTIME_VERSION}; VM scripting may be unavailable.`);
}

function isSemverAtLeast(version, minimum) {
    const currentParts = parseSemverParts(version);
    const minimumParts = parseSemverParts(minimum);
    if (!currentParts || !minimumParts) {
        return true;
    }
    for (let index = 0; index < 3; index += 1) {
        if (currentParts[index] > minimumParts[index]) {
            return true;
        }
        if (currentParts[index] < minimumParts[index]) {
            return false;
        }
    }
    return true;
}

function parseSemverParts(rawVersion) {
    const match = String(rawVersion || '').match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
        return null;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function resetVmInputControls(message = 'No bound ViewModel inputs detected.') {
    const count = elements.vmControlsCount;
    const empty = elements.vmControlsEmpty;
    const tree = elements.vmControlsTree;
    if (!count || !empty || !tree) {
        return;
    }
    tree.innerHTML = '';
    count.textContent = '0';
    empty.hidden = false;
    empty.textContent = message;
    clearVmControlBindings();
    stopVmControlSync();
}

function renderVmInputControls() {
    const count = elements.vmControlsCount;
    const empty = elements.vmControlsEmpty;
    const tree = elements.vmControlsTree;
    if (!count || !empty || !tree) {
        return;
    }

    tree.innerHTML = '';
    clearVmControlBindings();
    const rootVm = resolveVmRootInstance();
    const vmHierarchy = rootVm ? buildVmHierarchy(rootVm) : null;
    const stateMachineHierarchy = buildStateMachineHierarchy();

    const vmTotal = vmHierarchy?.totalInputs || 0;
    const stateMachineTotal = stateMachineHierarchy?.totalInputs || 0;
    const totalControls = vmTotal + stateMachineTotal;
    count.textContent = String(totalControls);

    if (!totalControls) {
        empty.hidden = false;
        empty.textContent = 'No writable ViewModel or state machine inputs were found.';
        stopVmControlSync();
        return;
    }

    empty.hidden = true;

    if (vmHierarchy) {
        // Filter out root-level inputs that are duplicated in child VMs
        if (vmHierarchy.children.length) {
            const childPaths = new Set();
            const collectChildPaths = (node) => {
                if (node.inputs) node.inputs.forEach((i) => childPaths.add(i.path));
                if (node.children) node.children.forEach(collectChildPaths);
            };
            vmHierarchy.children.forEach(collectChildPaths);
            vmHierarchy.inputs = vmHierarchy.inputs.filter((i) => !childPaths.has(i.path));
        }
        // Root section stays open by default.
        tree.appendChild(createVmSectionElement(vmHierarchy, true));
    }

    if (stateMachineHierarchy?.totalInputs) {
        // State machine groups stay collapsed by default.
        tree.appendChild(createVmSectionElement(stateMachineHierarchy, false));
    }
    startVmControlSync();
    syncVmControlBindings(true);
    initLucideIcons();
}

// Depth-based color palette for VM nesting levels
const VM_DEPTH_COLORS = [
    '#C4F82A', // depth 0 — neon green (root)
    '#38BDF8', // depth 1 — sky blue
    '#A78BFA', // depth 2 — purple
    '#FB923C', // depth 3 — orange
    '#F472B6', // depth 4 — pink
    '#34D399', // depth 5 — emerald
];

function getDepthColor(depth) {
    return VM_DEPTH_COLORS[depth % VM_DEPTH_COLORS.length];
}

function createVmSectionElement(node, isTopLevel = false, depth = 0) {
    const section = document.createElement('details');
    section.className = 'vm-section';
    section.open = Boolean(isTopLevel);

    const depthColor = getDepthColor(depth);

    const summary = document.createElement('summary');
    summary.className = 'vm-section-header';

    const sectionBar = document.createElement('span');
    sectionBar.className = 'vm-section-bar';
    sectionBar.style.background = depthColor;

    const titleText = document.createElement('span');
    titleText.textContent = node.label.toUpperCase();

    const inputCountBadge = document.createElement('span');
    inputCountBadge.className = 'vm-section-count';
    const totalInputs = countAllInputs(node);
    inputCountBadge.textContent = String(totalInputs);

    const chevron = document.createElement('i');
    chevron.setAttribute('data-lucide', 'chevron-down');
    chevron.className = 'lucide-12 vm-section-chevron';

    summary.appendChild(chevron);
    summary.appendChild(sectionBar);
    summary.appendChild(titleText);
    summary.appendChild(inputCountBadge);
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'vm-section-body';
    body.dataset.depth = depth;
    body.style.setProperty('--depth-color', depthColor);

    // Render this node's direct inputs
    if (node.inputs.length) {
        node.inputs.forEach((input) => {
            body.appendChild(createVmControlRow(input));
        });
    }

    // Render nested children as sub-sections
    if (node.children.length) {
        node.children.forEach((child) => {
            if (child.inputs.length || child.children.length) {
                body.appendChild(createVmSectionElement(child, false, depth + 1));
            }
        });
    }

    if (!node.inputs.length && !node.children.length) {
        const emptyMsg = document.createElement('p');
        emptyMsg.className = 'empty-state';
        emptyMsg.textContent = 'No controls.';
        body.appendChild(emptyMsg);
    }

    section.appendChild(body);
    return section;
}

function countAllInputs(node) {
    let total = node.inputs ? node.inputs.length : 0;
    if (node.children) {
        node.children.forEach((child) => {
            total += countAllInputs(child);
        });
    }
    return total;
}

function resolveVmRootInstance() {
    if (!riveInstance) {
        return null;
    }
    if (riveInstance.viewModelInstance) {
        return riveInstance.viewModelInstance;
    }

    try {
        const defaultViewModel = typeof riveInstance.defaultViewModel === 'function'
            ? riveInstance.defaultViewModel()
            : null;
        if (!defaultViewModel) {
            return null;
        }
        if (typeof defaultViewModel.defaultInstance === 'function') {
            return defaultViewModel.defaultInstance();
        }
        if (typeof defaultViewModel.instance === 'function') {
            return defaultViewModel.instance();
        }
    } catch (error) {
        console.warn('Unable to resolve default ViewModel instance', error);
    }

    return null;
}

function buildVmHierarchy(rootVm) {
    const seenInputPaths = new Set();
    const activeInstances = new WeakSet();
    let totalInputs = 0;

    const walk = (instance, label, basePath, kind = 'vm') => {
        const node = {
            label,
            path: basePath || '<root>',
            kind,
            inputs: [],
            children: [],
        };
        if (!instance || typeof instance !== 'object') {
            return node;
        }
        if (activeInstances.has(instance)) {
            return node;
        }
        activeInstances.add(instance);

        const properties = Array.isArray(instance.properties) ? instance.properties : [];
        properties.forEach((property) => {
            const name = property?.name;
            if (typeof name !== 'string' || !name) {
                return;
            }

            const fullPath = basePath ? `${basePath}/${name}` : name;
            const accessorInfo = getVmAccessor(instance, name);
            if (accessorInfo && VM_CONTROL_KINDS.has(accessorInfo.kind) && !seenInputPaths.has(fullPath)) {
                console.log('[rive-viewer] VM input discovered:', fullPath, 'kind:', accessorInfo.kind);
                node.inputs.push({
                    name,
                    path: fullPath,
                    kind: accessorInfo.kind,
                });
                seenInputPaths.add(fullPath);
                totalInputs += 1;
            }

            const nestedVm = safeVmMethodCall(instance, 'viewModelInstance', name)
                || safeVmMethodCall(instance, 'viewModel', name);
            if (nestedVm && nestedVm !== instance) {
                node.children.push(walk(nestedVm, name, fullPath, 'vm'));
            }

            const listAccessor = safeVmMethodCall(instance, 'list', name);
            const listLength = getVmListLength(listAccessor);
            if (listLength > 0) {
                const listNode = {
                    label: `${name} [${listLength}]`,
                    path: fullPath,
                    kind: 'list',
                    inputs: [],
                    children: [],
                };
                for (let index = 0; index < listLength; index += 1) {
                    const itemInstance = getVmListItemAt(listAccessor, index);
                    if (!itemInstance) {
                        continue;
                    }
                    const itemPath = `${fullPath}/${index}`;
                    listNode.children.push(walk(itemInstance, `Instance ${index}`, itemPath, 'instance'));
                }
                node.children.push(listNode);
            }
        });

        activeInstances.delete(instance);
        return node;
    };

    const rootNode = walk(rootVm, 'Root VM', '', 'vm');
    rootNode.totalInputs = totalInputs;
    return rootNode;
}

function getStateMachineInputKind(input) {
    if (!input || typeof input !== 'object') {
        return null;
    }
    if (typeof input.fire === 'function') {
        return 'trigger';
    }
    if (typeof input.value === 'boolean') {
        return 'boolean';
    }
    if (typeof input.value === 'number') {
        return 'number';
    }
    return null;
}

function buildStateMachineHierarchy() {
    if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function') {
        return null;
    }

    const stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
    if (!stateMachineNames.length) {
        return null;
    }

    const rootNode = {
        label: 'State Machines',
        path: '__state_machines__',
        kind: 'state-machines',
        inputs: [],
        children: [],
        totalInputs: 0,
    };

    stateMachineNames.forEach((stateMachineName) => {
        let inputs = [];
        try {
            const resolved = riveInstance.stateMachineInputs(stateMachineName);
            if (Array.isArray(resolved)) {
                inputs = resolved;
            }
        } catch {
            inputs = [];
        }

        const childNode = {
            label: stateMachineName,
            path: `stateMachine/${stateMachineName}`,
            kind: 'state-machine',
            inputs: [],
            children: [],
        };

        inputs.forEach((input) => {
            const inputKind = getStateMachineInputKind(input);
            const inputName = typeof input?.name === 'string' && input.name ? input.name : null;
            if (!inputKind || !inputName) {
                return;
            }

            childNode.inputs.push({
                name: inputName,
                path: `stateMachine/${stateMachineName}/${inputName}`,
                kind: inputKind,
                source: 'state-machine',
                stateMachineName,
            });
            rootNode.totalInputs += 1;
        });

        if (childNode.inputs.length) {
            rootNode.children.push(childNode);
        }
    });

    return rootNode.totalInputs > 0 ? rootNode : null;
}

function createVmControlRow(descriptor) {
    const row = document.createElement('div');
    row.className = 'vm-control-row';

    const label = document.createElement('div');
    label.className = 'vm-control-label';
    label.textContent = `${descriptor.name} (${descriptor.kind})`;
    label.title = descriptor.path;

    const inputContainer = document.createElement('div');
    inputContainer.className = 'vm-control-input';

    const accessor = resolveControlAccessor(descriptor);
    const isDisabled = !accessor;

    if (descriptor.kind === 'number') {
        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.step = 'any';
        numberInput.value = Number.isFinite(accessor?.value) ? String(accessor.value) : '0';
        numberInput.disabled = isDisabled;
        numberInput.addEventListener('change', () => {
            const nextValue = Number(numberInput.value);
            if (!Number.isFinite(nextValue)) {
                return;
            }
            const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'number' });
            if (liveAccessor) {
                liveAccessor.value = nextValue;
                const source = descriptor.source === 'state-machine' ? 'sm-number' : 'vm-number';
                logEvent('ui', source, `Set ${descriptor.path} = ${nextValue}`);
            }
        });
        registerVmControlBinding(descriptor, {
            kind: 'number',
            input: numberInput,
        });
        inputContainer.appendChild(numberInput);
    } else if (descriptor.kind === 'boolean') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(accessor?.value);
        checkbox.disabled = isDisabled;
        checkbox.addEventListener('change', () => {
            const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'boolean' });
            if (liveAccessor) {
                liveAccessor.value = checkbox.checked;
                const source = descriptor.source === 'state-machine' ? 'sm-boolean' : 'vm-boolean';
                logEvent('ui', source, `Set ${descriptor.path} = ${checkbox.checked}`);
            }
        });
        registerVmControlBinding(descriptor, {
            kind: 'boolean',
            input: checkbox,
        });
        inputContainer.appendChild(checkbox);
    } else if (descriptor.kind === 'string') {
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = typeof accessor?.value === 'string' ? accessor.value : '';
        textInput.disabled = isDisabled;
        textInput.addEventListener('change', () => {
            const liveAccessor = resolveVmAccessor(descriptor.path, 'string');
            if (liveAccessor) {
                liveAccessor.value = textInput.value;
                logEvent('ui', 'vm-string', `Set ${descriptor.path} = ${textInput.value}`);
            }
        });
        registerVmControlBinding(descriptor, {
            kind: 'string',
            input: textInput,
        });
        inputContainer.appendChild(textInput);
    } else if (descriptor.kind === 'enum') {
        const select = document.createElement('select');
        const values = Array.isArray(accessor?.values) ? accessor.values : [];
        values.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
        if (values.length === 0) {
            const fallback = document.createElement('option');
            fallback.value = '';
            fallback.textContent = '(no enum values)';
            select.appendChild(fallback);
        }
        if (typeof accessor?.value === 'string') {
            select.value = accessor.value;
        }
        select.disabled = isDisabled || values.length === 0;
        select.addEventListener('change', () => {
            const liveAccessor = resolveVmAccessor(descriptor.path, 'enum');
            if (liveAccessor) {
                liveAccessor.value = select.value;
                logEvent('ui', 'vm-enum', `Set ${descriptor.path} = ${select.value}`);
            }
        });
        registerVmControlBinding(descriptor, {
            kind: 'enum',
            input: select,
        });
        inputContainer.appendChild(select);
    } else if (descriptor.kind === 'color') {
        const colorWrap = document.createElement('div');
        colorWrap.className = 'vm-color-control';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        const alphaInput = document.createElement('input');
        alphaInput.type = 'number';
        alphaInput.min = '0';
        alphaInput.max = '100';
        alphaInput.step = '1';

        const colorMeta = argbToColorMeta(accessor?.value);
        colorInput.value = colorMeta.hex;
        alphaInput.value = String(colorMeta.alphaPercent);
        colorInput.disabled = isDisabled;
        alphaInput.disabled = isDisabled;

        const applyColor = () => {
            const liveAccessor = resolveVmAccessor(descriptor.path, 'color');
            if (!liveAccessor) {
                return;
            }
            const rgb = hexToRgb(colorInput.value);
            const alphaPercent = clamp(Number(alphaInput.value), 0, 100);
            alphaInput.value = String(Math.round(alphaPercent));
            const alpha = Math.round((alphaPercent / 100) * 255);
            if (typeof liveAccessor.argb === 'function') {
                liveAccessor.argb(alpha, rgb.r, rgb.g, rgb.b);
                logEvent('ui', 'vm-color', `Set ${descriptor.path} color to ${colorInput.value} (${alphaPercent}%).`);
                return;
            }
            liveAccessor.value = rgbAlphaToArgb(rgb.r, rgb.g, rgb.b, alpha);
            logEvent('ui', 'vm-color', `Set ${descriptor.path} color to ${colorInput.value} (${alphaPercent}%).`);
        };

        colorInput.addEventListener('input', applyColor);
        alphaInput.addEventListener('change', applyColor);
        registerVmControlBinding(descriptor, {
            kind: 'color',
            colorInput,
            alphaInput,
        });

        colorWrap.appendChild(colorInput);
        colorWrap.appendChild(alphaInput);
        inputContainer.appendChild(colorWrap);
    } else if (descriptor.kind === 'trigger') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Fire';
        button.disabled = isDisabled;
        button.addEventListener('click', () => {
            const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'trigger' });
            console.log('[rive-viewer] trigger click:', descriptor.path, 'accessor:', liveAccessor, 'type:', typeof liveAccessor, 'has .trigger:', typeof liveAccessor?.trigger, 'has .fire:', typeof liveAccessor?.fire);
            if (riveInstance?.isPaused) {
                console.log('[rive-viewer] resuming paused instance for trigger');
                riveInstance.play();
            }

            let firedVmTrigger = false;
            let firedStateMachineCount = 0;
            if (liveAccessor && typeof liveAccessor.trigger === 'function') {
                liveAccessor.trigger();
                firedVmTrigger = true;
                console.log('[rive-viewer] fired VM trigger via .trigger()');
            } else if (liveAccessor && typeof liveAccessor.fire === 'function') {
                liveAccessor.fire();
                firedVmTrigger = true;
                console.log('[rive-viewer] fired VM trigger via .fire()');
            }

            if (descriptor.source !== 'state-machine') {
                firedStateMachineCount = fireStateMachineTriggerByName(descriptor.name);
                console.log('[rive-viewer] state machine trigger fallback:', descriptor.name, 'fired:', firedStateMachineCount);
            }
            if (firedVmTrigger || firedStateMachineCount > 0) {
                const suffix = firedStateMachineCount > 0 ? ` (+${firedStateMachineCount} state machine trigger matches)` : '';
                const source = descriptor.source === 'state-machine' ? 'sm-trigger' : 'vm-trigger';
                logEvent('ui', source, `Fired trigger ${descriptor.path}${suffix}`);
            } else {
                const source = descriptor.source === 'state-machine' ? 'sm-trigger-miss' : 'vm-trigger-miss';
                logEvent('ui', source, `No trigger accessor or state machine trigger matched ${descriptor.path}`);
            }
        });
        inputContainer.appendChild(button);
    }

    row.appendChild(label);
    row.appendChild(inputContainer);
    return row;
}

function clearVmControlBindings() {
    vmControlBindings = [];
}

function registerVmControlBinding(descriptor, binding) {
    if (!descriptor || !binding) {
        return;
    }
    vmControlBindings.push({
        descriptor: { ...descriptor },
        ...binding,
    });
}

function startVmControlSync() {
    if (vmControlSyncTimer || !vmControlBindings.length) {
        return;
    }
    vmControlSyncTimer = setInterval(() => {
        syncVmControlBindings(false);
    }, VM_CONTROL_SYNC_INTERVAL_MS);
}

function stopVmControlSync() {
    if (vmControlSyncTimer) {
        clearInterval(vmControlSyncTimer);
        vmControlSyncTimer = null;
    }
}

function isEditingControl(element) {
    return document.activeElement === element;
}

function syncVmControlBindings(force = false) {
    if (!vmControlBindings.length) {
        return;
    }

    vmControlBindings.forEach((binding) => {
        const accessor = resolveControlAccessor(binding.descriptor);
        const canEdit = Boolean(accessor);

        if (binding.input) {
            binding.input.disabled = !canEdit;
        }
        if (binding.colorInput) {
            binding.colorInput.disabled = !canEdit;
        }
        if (binding.alphaInput) {
            binding.alphaInput.disabled = !canEdit;
        }
        if (!canEdit) {
            return;
        }

        if (binding.kind === 'number') {
            const value = Number(accessor.value);
            if (!Number.isFinite(value)) {
                return;
            }
            if (!force && isEditingControl(binding.input)) {
                return;
            }
            const next = String(value);
            if (binding.input.value !== next) {
                binding.input.value = next;
            }
            return;
        }

        if (binding.kind === 'boolean') {
            const next = Boolean(accessor.value);
            if (binding.input.checked !== next) {
                binding.input.checked = next;
            }
            return;
        }

        if (binding.kind === 'string') {
            const next = typeof accessor.value === 'string' ? accessor.value : '';
            if (!force && isEditingControl(binding.input)) {
                return;
            }
            if (binding.input.value !== next) {
                binding.input.value = next;
            }
            return;
        }

        if (binding.kind === 'enum') {
            const next = typeof accessor.value === 'string' ? accessor.value : '';
            if (binding.input.value !== next) {
                binding.input.value = next;
            }
            return;
        }

        if (binding.kind === 'color') {
            const meta = argbToColorMeta(accessor.value);
            if (!force && (isEditingControl(binding.colorInput) || isEditingControl(binding.alphaInput))) {
                return;
            }
            if (binding.colorInput.value !== meta.hex) {
                binding.colorInput.value = meta.hex;
            }
            const nextAlpha = String(meta.alphaPercent);
            if (binding.alphaInput.value !== nextAlpha) {
                binding.alphaInput.value = nextAlpha;
            }
        }
    });
}

function navigateToVmInstance(rootVm, path) {
    if (!path) return null;
    if (!path.includes('/')) {
        return { instance: rootVm, propertyName: path };
    }

    const segments = path.split('/');
    const propertyName = segments.pop();

    let current = rootVm;
    let i = 0;
    while (i < segments.length && current) {
        const segment = segments[i];

        // Try viewModel navigation
        let child = safeVmMethodCall(current, 'viewModel', segment)
            || safeVmMethodCall(current, 'viewModelInstance', segment);

        if (child) {
            current = child;
            i++;
            continue;
        }

        // Try list navigation: segment is list name, next segment is index
        if (i + 1 < segments.length) {
            const listAccessor = safeVmMethodCall(current, 'list', segment);
            const numIndex = parseInt(segments[i + 1], 10);
            if (listAccessor && !Number.isNaN(numIndex)) {
                const itemInstance = getVmListItemAt(listAccessor, numIndex);
                if (itemInstance) {
                    current = itemInstance;
                    i += 2;
                    continue;
                }
            }
        }

        // Navigation failed for this segment
        console.warn(`[rive-viewer] VM navigation failed at segment "${segment}" in path "${path}"`);
        return null;
    }

    return current ? { instance: current, propertyName } : null;
}

function resolveVmAccessor(path, expectedKind) {
    const rootVm = resolveVmRootInstance();
    if (!rootVm) {
        return null;
    }

    // Navigate to the correct VM instance for the property
    const nav = navigateToVmInstance(rootVm, path);
    if (!nav) {
        return null;
    }

    const accessorInfo = getVmAccessor(nav.instance, nav.propertyName);
    if (!accessorInfo) {
        return null;
    }
    if (expectedKind && accessorInfo.kind !== expectedKind) {
        return null;
    }
    return accessorInfo.accessor;
}

function resolveStateMachineInputAccessor(stateMachineName, inputName, expectedKind) {
    if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !stateMachineName || !inputName) {
        return null;
    }

    try {
        const inputs = riveInstance.stateMachineInputs(stateMachineName);
        if (!Array.isArray(inputs)) {
            return null;
        }

        const input = inputs.find((candidate) => candidate?.name === inputName);
        if (!input) {
            return null;
        }

        const detectedKind = getStateMachineInputKind(input);
        if (expectedKind && detectedKind !== expectedKind) {
            return null;
        }

        return input;
    } catch {
        return null;
    }
}

function resolveControlAccessor(descriptor) {
    if (descriptor?.source === 'state-machine') {
        return resolveStateMachineInputAccessor(descriptor.stateMachineName, descriptor.name, descriptor.kind);
    }
    return resolveVmAccessor(descriptor.path, descriptor.kind);
}

function fireStateMachineTriggerByName(triggerName) {
    if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !triggerName) {
        return 0;
    }

    const stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
    let firedCount = 0;

    stateMachineNames.forEach((stateMachineName) => {
        let inputs = [];
        try {
            const resolvedInputs = riveInstance.stateMachineInputs(stateMachineName);
            if (Array.isArray(resolvedInputs)) {
                inputs = resolvedInputs;
            }
        } catch {
            inputs = [];
        }

        inputs.forEach((input) => {
            if (!input || input.name !== triggerName || typeof input.fire !== 'function') {
                return;
            }
            try {
                input.fire();
                firedCount += 1;
            } catch {
                /* noop */
            }
        });
    });

    return firedCount;
}

function getVmAccessor(vmInstance, propertyName) {
    const probes = [
        ['number', 'number'],
        ['boolean', 'boolean'],
        ['string', 'string'],
        ['enum', 'enum'],
        ['color', 'color'],
        ['trigger', 'trigger'],
    ];

    for (const [kind, methodName] of probes) {
        const accessor = safeVmMethodCall(vmInstance, methodName, propertyName);
        if (accessor) {
            return { kind, accessor };
        }
    }

    return null;
}

function safeVmMethodCall(target, methodName, ...args) {
    if (!target || typeof target[methodName] !== 'function') {
        return null;
    }
    try {
        return target[methodName](...args) || null;
    } catch {
        return null;
    }
}

function getVmListLength(listAccessor) {
    if (!listAccessor) {
        return 0;
    }
    if (typeof listAccessor.length === 'number') {
        return Math.max(0, Math.floor(listAccessor.length));
    }
    if (typeof listAccessor.size === 'number') {
        return Math.max(0, Math.floor(listAccessor.size));
    }
    return 0;
}

function getVmListItemAt(listAccessor, index) {
    if (!listAccessor || typeof listAccessor.instanceAt !== 'function') {
        return null;
    }
    try {
        return listAccessor.instanceAt(index);
    } catch {
        return null;
    }
}

function argbToColorMeta(value) {
    const rawValue = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
    const alpha = (rawValue >>> 24) & 255;
    const red = (rawValue >>> 16) & 255;
    const green = (rawValue >>> 8) & 255;
    const blue = rawValue & 255;
    return {
        hex: `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`,
        alphaPercent: Math.round((alpha / 255) * 100),
    };
}

function toHexByte(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function hexToRgb(hex) {
    const cleanHex = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
        return { r: 0, g: 0, b: 0 };
    }
    return {
        r: parseInt(cleanHex.slice(0, 2), 16),
        g: parseInt(cleanHex.slice(2, 4), 16),
        b: parseInt(cleanHex.slice(4, 6), 16),
    };
}

function rgbAlphaToArgb(red, green, blue, alpha) {
    return (
        ((clamp(alpha, 0, 255) & 255) << 24)
        | ((clamp(red, 0, 255) & 255) << 16)
        | ((clamp(green, 0, 255) & 255) << 8)
        | (clamp(blue, 0, 255) & 255)
    ) >>> 0;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

// Expose controls for inline handlers
window.applyCodeAndReload = applyCodeAndReload;
window.play = play;
window.pause = pause;
window.reset = reset;
window.createDemoBundle = createDemoBundle;
window.injectCodeSnippet = injectCodeSnippet;
window.handleFileButtonClick = handleFileButtonClick;
window.refreshVmInputControls = renderVmInputControls;
window.__riveRuntimeCache = {
    getRuntimeSourceText: (runtimeName) => runtimeSourceTexts[runtimeName] || null,
    getRuntimeVersion: (runtimeName) => runtimeVersions[runtimeName] || null,
};
window.__riveAnimationCache = {
    getBuffer: () => currentFileBuffer,
    getName: () => currentFileName,
    getMimeType: () => currentFileMimeType,
};

function arrayBufferToBase64(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
        return '';
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

function normalizeStateMachineSelection(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return [value];
    }
    return [];
}

function normalizeAnimationSelection(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return [value];
    }
    return [];
}

function getTauriInvoker() {
    if (typeof tauriBridge.invoke === 'function') {
        return tauriBridge.invoke;
    }
    if (window.__TAURI_INTERNALS__?.invoke) {
        return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    }
    if (window.__TAURI__?.core?.invoke) {
        return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
    }
    if (window.__TAURI__?.invoke) {
        return window.__TAURI__.invoke.bind(window.__TAURI__);
    }
    if (typeof window.__TAURI_IPC__ === 'function') {
        return (cmd, args = {}) =>
            new Promise((resolve, reject) => {
                const successId = makeCallbackId('tauri_cb');
                const errorId = makeCallbackId('tauri_err');

                window[successId] = (data) => {
                    cleanupBridgeCallbacks(successId, errorId);
                    resolve(data);
                };
                window[errorId] = (error) => {
                    cleanupBridgeCallbacks(successId, errorId);
                    reject(error);
                };

                window.__TAURI_IPC__({
                    cmd,
                    callback: successId,
                    error: errorId,
                    ...args,
                });
            });
    }
    return null;
}

function isTauriEnvironment() {
    return Boolean(
        window.__TAURI_INTERNALS__
        || window.__TAURI__
        || typeof window.__TAURI_IPC__ === 'function'
    );
}

async function ensureTauriBridge() {
    if (!isTauriEnvironment()) {
        return tauriBridge;
    }
    if (window.__TAURI_INTERNALS__?.invoke) {
        tauriBridge.invoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    }
    if (window.__TAURI__?.core?.invoke) {
        tauriBridge.invoke = window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
    } else if (window.__TAURI__?.invoke) {
        tauriBridge.invoke = window.__TAURI__.invoke.bind(window.__TAURI__);
    }
    if (window.__TAURI__?.event?.listen) {
        tauriBridge.listen = window.__TAURI__.event.listen.bind(window.__TAURI__.event);
    }
    if (typeof tauriBridge.invoke === 'function' && typeof tauriBridge.listen === 'function') {
        return tauriBridge;
    }
    if (tauriApiLoadPromise) {
        await tauriApiLoadPromise;
        return tauriBridge;
    }

    tauriApiLoadPromise = (async () => {
        // Bare module imports are only resolvable in the local dev server.
        if (location.protocol !== 'http:' && location.protocol !== 'https:') {
            tauriApiLoadPromise = null;
            return;
        }
        try {
            const [{ invoke }, { listen }] = await Promise.all([
                import('@tauri-apps/api/core'),
                import('@tauri-apps/api/event'),
            ]);
            tauriBridge.invoke = tauriBridge.invoke || invoke;
            tauriBridge.listen = tauriBridge.listen || listen;
        } catch (error) {
            console.warn('[rive-viewer] failed to load Tauri API bridge:', error);
        } finally {
            tauriApiLoadPromise = null;
        }
    })();

    await tauriApiLoadPromise;
    return tauriBridge;
}

async function getTauriEventListener() {
    if (typeof tauriBridge.listen === 'function') {
        return tauriBridge.listen;
    }
    if (window.__TAURI__?.event?.listen) {
        return window.__TAURI__.event.listen.bind(window.__TAURI__.event);
    }
    await ensureTauriBridge();
    if (typeof tauriBridge.listen === 'function') {
        return tauriBridge.listen;
    }
    const legacyListen = window.__TAURI__?.event?.listen;
    return typeof legacyListen === 'function' ? legacyListen.bind(window.__TAURI__.event) : null;
}

function cleanupBridgeCallbacks(...ids) {
    ids.forEach((id) => Reflect.deleteProperty(window, id));
}

function makeCallbackId(prefix) {
    if (window.crypto?.randomUUID) {
        return `_${prefix}_${window.crypto.randomUUID()}`;
    }
    return `_${prefix}_${Math.random().toString(36).slice(2)}${Date.now()}`;
}

function loadRuntimeMeta() {
    try {
        const raw = localStorage.getItem(RUNTIME_META_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function persistRuntimeMeta(runtimeName, meta) {
    runtimeMeta[runtimeName] = meta;
    try {
        localStorage.setItem(RUNTIME_META_STORAGE_KEY, JSON.stringify(runtimeMeta));
    } catch {
        /* ignore storage errors */
    }
}

async function resolveRuntimeSource(scriptUrl, runtimeName) {
    try {
        const response = await fetch(scriptUrl, { method: 'HEAD' });
        if (!response.ok) {
            throw new Error(`Failed to resolve runtime version (${response.status})`);
        }
        const resolvedUrl = response.url || scriptUrl;
        const headerVersion = response.headers.get('x-jsd-version') || response.headers.get('x-rv-version');
        return {
            resolvedUrl,
            version: headerVersion || extractVersionFromUrl(resolvedUrl),
        };
    } catch (error) {
        const stored = runtimeMeta[runtimeName];
        if (stored?.resolvedUrl) {
            console.warn('Falling back to cached runtime metadata', error);
            return {
                resolvedUrl: stored.resolvedUrl,
                version: stored.version || null,
            };
        }
        console.warn('Unable to resolve runtime version metadata', error);
        return { resolvedUrl: scriptUrl, version: null };
    }
}

function extractVersionFromUrl(url) {
    const match = /@([^/]+)/.exec(url);
    return match ? match[1] : null;
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

function clearCurrentFile() {
    cleanupInstance();
    if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }
    currentFileUrl = null;
    currentFileName = null;
    currentFileBuffer = null;
    currentFileSizeBytes = 0;
    currentArtboardName = null;
    updateFileTriggerButton('empty');
    elements.canvasContainer.innerHTML = `
        <div class="placeholder">
            <div class="placeholder-icon"><i data-lucide="play" class="lucide-24"></i></div>
            <p>DROP FILE OR CLICK OPEN</p>
        </div>
    `;
    initLucideIcons();
    resetVmInputControls('No bound ViewModel inputs detected.');
    refreshInfoStrip();
}

function updateFileTriggerButton(state, fileName) {
    const button = elements.fileTriggerButton || document.getElementById('file-trigger-btn');
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
    // Always show "OPEN" — filename is shown in the runtime strip
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
async function resolveAppVersion() {
    if (resolvedAppVersion && resolvedAppVersion !== '__APP_VERSION__') {
        if (!resolvedAppBuild || resolvedAppBuild === '__APP_BUILD__') {
            resolvedAppBuild = 'dev';
        }
        return;
    }
    try {
        const response = await fetch('package.json', { cache: 'no-store' });
        if (response.ok) {
            const data = await response.json();
            if (data?.version) {
                resolvedAppVersion = data.version;
                updateVersionInfo();
            }
        }
    } catch {
        if (!resolvedAppVersion || resolvedAppVersion === '__APP_VERSION__') {
            resolvedAppVersion = 'dev';
        }
    }
    if (!resolvedAppBuild || resolvedAppBuild === '__APP_BUILD__') {
        resolvedAppBuild = 'dev';
    }
}

function getBuildIdLabel() {
    if (resolvedAppBuild && resolvedAppBuild !== '__APP_BUILD__') {
        return resolvedAppBuild;
    }
    return 'dev';
}
