import {
    DEFAULT_LAYOUT_ALIGNMENT,
    DEFAULT_LAYOUT_FIT,
    FALLBACK_RUNTIME_VERSION_OPTIONS,
    RUNTIME_VERSION_OPTION_COUNT,
} from './src/app/core/constants.js';
import { getElements } from './src/app/core/elements.js';
import { createDemoExportController } from './src/app/platform/demo-export.js';
import { createAppUpdaterController } from './src/app/platform/app-updater.js';
import {
    createFileSessionController,
    normalizeOpenedFilePath,
} from './src/app/platform/file-session.js';
import { createGlobalBindingsController } from './src/app/platform/global-bindings.js';
import {
    loadRuntimeMeta,
    loadRuntimeVersionByFile,
    loadRuntimeVersionPreference,
    buildFileRuntimePreferenceId as createFileRuntimePreferenceId,
} from './src/app/platform/runtime-utils.js';
import { createRuntimeLoaderController } from './src/app/platform/runtime-loader.js';
import { createTauriBridgeController } from './src/app/platform/tauri-bridge.js';
import { createTransparencyController } from './src/app/platform/transparency-controller.js';
import { buildEffectiveInstantiationDescriptor } from './src/app/platform/web-instantiation.js';
import { createArtboardSwitcherController } from './src/app/rive/artboard-switcher.js';
import {
    detectDefaultStateMachineName,
} from './src/app/rive/default-state-machine.js';
import { createRiveInstanceController } from './src/app/rive/instance-controller.js';
import { createPlaybackController } from './src/app/rive/playback-controls.js';
import { createVmControlsController } from './src/app/rive/vm-controls.js';
import { bindUiActionHandlers } from './src/app/ui/action-bindings.js';
import { createCodeEditorController } from './src/app/ui/code-editor.js';
import { createEventLogController } from './src/app/ui/event-log.js';
import { createMcpSetupController } from './src/app/ui/mcp-setup.js';
import { createInstantiationControlsDialogController } from './src/app/ui/instantiation-controls-dialog.js';
import { createScriptConsoleController } from './src/app/ui/script-console.js';
import { createShellController } from './src/app/ui/shell-controller.js';
import {
    createStatusController,
} from './src/app/ui/status-controller.js';

// CodeMirror will be loaded dynamically if available
let CodeMirrorModules = null;
const tauriController = createTauriBridgeController();
const {
    ensureTauriBridge,
    getTauriEventListener,
    getTauriInvoker,
    isTauriEnvironment,
} = tauriController;

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

const runtimeRegistry = {};
const runtimePromises = {};
const runtimeVersions = {};
const runtimeResolvedUrls = {};
const runtimeSourceTexts = {};
const runtimeBlobUrls = {};
const runtimeAssets = {};
const runtimeWarningsShown = new Set();
const APP_VERSION_PLACEHOLDER = '__APP' + '_VERSION__';
const APP_BUILD_PLACEHOLDER = '__APP' + '_BUILD__';

let demoExportController = null;
let fileSessionController = null;
let instanceController = null;
let instantiationControlsDialogController = null;
let shellController = null;
let statusController = null;
let updaterController = null;
let currentRuntime = 'webgl2';
let runtimeVersionToken = loadRuntimeVersionPreference();
let currentLayoutAlignment = DEFAULT_LAYOUT_ALIGNMENT;
let currentLayoutFit = DEFAULT_LAYOUT_FIT;
let currentConsoleMode = 'events';
let syncingConsoleMode = false;
const runtimeMeta = loadRuntimeMeta();
const runtimeVersionByFile = loadRuntimeVersionByFile();
const runtimeVersionOptionsState = {
    latest: FALLBACK_RUNTIME_VERSION_OPTIONS[0],
    versions: FALLBACK_RUNTIME_VERSION_OPTIONS.slice(0, RUNTIME_VERSION_OPTION_COUNT),
};

const getCurrentFileBuffer = () => fileSessionController?.getCurrentFileBuffer() ?? null;
const getCurrentFileMimeType = () => fileSessionController?.getCurrentFileMimeType() ?? 'application/octet-stream';
const getCurrentFileName = () => fileSessionController?.getCurrentFileName() ?? null;
const getCurrentFilePreferenceId = () => fileSessionController?.getCurrentFilePreferenceId() ?? null;
const getCurrentFileSizeBytes = () => fileSessionController?.getCurrentFileSizeBytes() ?? 0;
const getCurrentFileUrl = () => fileSessionController?.getCurrentFileUrl() ?? null;
const getCurrentRuntime = () => currentRuntime;
const getCurrentLayoutAlignment = () => currentLayoutAlignment;
const getCurrentLayoutFit = () => currentLayoutFit;

function refreshInfoStrip() {
    statusController?.refreshInfoStrip();
}

function updateInfo(message) {
    statusController?.updateInfo(message);
}

function showError(message) {
    statusController?.showError(message);
}

function hideError() {
    statusController?.hideError();
}

function updateVersionInfo(statusMessage) {
    statusController?.updateVersionInfo(statusMessage);
}

async function resolveAppVersion() {
    return statusController?.resolveAppVersion();
}

const elements = getElements();
const eventLogController = createEventLogController({
    elements,
    handleResize,
    onCollapsedChange: handleEventLogCollapsedChange,
});
const {
    getEntriesSnapshot: getEventLogEntries,
    getFilterStateSnapshot: getEventLogFilterState,
    logEvent,
    resetEventLog,
    setupEventLog,
} = eventLogController;
const { showMcpSetup } = createMcpSetupController({
    elements,
    getBridgeConnected: () => window._mcpBridge?.connected,
    getTauriInvoker,
    initLucideIcons,
});
const scriptConsoleController = createScriptConsoleController({
    callbacks: {
        logEvent,
        onOpenChange: handleScriptConsoleOpenChange,
        onToggleRequested: handleScriptConsoleToggleRequest,
        renderEventLog: eventLogController.renderEventLog,
    },
    elements,
});
const codeEditorController = createCodeEditorController({
    callbacks: {
        getTauriInvoker,
        loadRiveAnimation,
        logEvent,
        refreshCurrentState,
        showError,
        updateInfo,
    },
    codeMirrorModulesRef: () => CodeMirrorModules,
    getCurrentFileName,
    getCurrentFileUrl,
    loadCodeMirror,
});
const {
    applyCodeAndReload,
    ensureEditorReady,
    getEditorCode,
    getEditorConfig,
    getLiveConfig,
    getLiveConfigState,
    injectCodeSnippet,
    setEditorCode,
    toggleLiveConfigSource,
} = codeEditorController;
updaterController = createAppUpdaterController({
    callbacks: {
        logEvent,
        showError,
        updateInfo,
    },
    elements,
    getTauriInvoker,
    isTauriEnvironment,
});
const runtimeLoaderController = createRuntimeLoaderController({
    elements,
    state: {
        runtimeRegistry,
        runtimePromises,
        runtimeVersions,
        runtimeResolvedUrls,
        runtimeSourceTexts,
        runtimeBlobUrls,
        runtimeAssets,
        runtimeWarningsShown,
        runtimeMeta,
        runtimeVersionByFile,
        runtimeVersionOptionsState,
        getCurrentRuntime: () => currentRuntime,
        getRuntimeVersionToken: () => runtimeVersionToken,
        setRuntimeVersionToken: (nextToken) => {
            runtimeVersionToken = nextToken;
        },
        getCurrentFileUrl,
        getCurrentFileName,
        getCurrentFilePreferenceId,
    },
    callbacks: {
        loadRiveAnimation,
        logEvent,
        reloadCurrentAnimation: refreshCurrentState,
        refreshInfoStrip,
        showError,
        updateVersionInfo,
    },
});
const {
    applyRuntimeVersionToken,
    applyStoredRuntimeVersionForCurrentFile,
    ensureRuntime,
    getCurrentRuntimeSource,
    getCurrentRuntimeVersion,
    getEffectiveRuntimeVersionToken,
    getLoadedRuntime,
    getRuntimeAsset,
    getRuntimeCacheKey,
    getRuntimeSourceText,
    getRuntimeVersion,
    setupRuntimeVersionPicker,
} = runtimeLoaderController;
statusController = createStatusController({
    callbacks: {
        getCurrentFileName,
        getCurrentFileSizeBytes,
        getCurrentRuntime,
        getCurrentRuntimeSource,
        getCurrentRuntimeVersion,
        getLoadedRuntime,
        getRuntimeVersionToken: () => runtimeVersionToken,
        initLucideIcons,
    },
    elements,
    placeholders: {
        appBuild: '__APP_BUILD__',
        appBuildPlaceholder: APP_BUILD_PLACEHOLDER,
        appVersion: '__APP_VERSION__',
        appVersionPlaceholder: APP_VERSION_PLACEHOLDER,
    },
});
const transparencyController = createTransparencyController({
    callbacks: {
        logEvent,
    },
    elements,
    getCurrentRuntime,
    getRiveInstance,
    getTauriInvoker,
    isTauriEnvironment,
});
const {
    cleanupTransparencyRuntime,
    getStateSnapshot: getTransparencyStateSnapshot,
    isCanvasEffectivelyTransparent,
    setupCanvasColor,
    setupTransparencyControls,
    syncTransparencyControls,
} = transparencyController;
const vmControlsController = createVmControlsController({
    elements,
    getCurrentRuntime,
    getLoadedRuntime,
    getRiveInstance,
    callbacks: {
        initLucideIcons,
        logEvent,
    },
});
const {
    applyVmControlSnapshot,
    captureVmControlSnapshot,
    getChangedVmControlSnapshot,
    renderVmInputControls,
    resetVmInputControls,
    serializeControlHierarchy,
    serializeVmHierarchy,
    setVmControlBaselineSnapshot,
} = vmControlsController;
const artboardSwitcherController = createArtboardSwitcherController({
    elements,
    getCurrentFileName,
    getCurrentFileUrl,
    getRiveInstance,
    callbacks: {
        initLucideIcons,
        loadRiveAnimation,
        logEvent,
        renderVmInputControls,
        showError,
        updateInfo,
    },
});
const {
    getStateSnapshot: getArtboardStateSnapshot,
    populateArtboardSwitcher,
    resetForNewFile: resetArtboardSwitcherState,
    resetToDefaultArtboard,
    setupArtboardSwitcher,
    switchArtboard,
    switchVmInstance,
    syncStateAfterLoad: syncArtboardStateAfterLoad,
    syncStateFromConfig: syncArtboardStateFromConfig,
} = artboardSwitcherController;
const playbackController = createPlaybackController({
    getCurrentFileName,
    getCurrentFileUrl,
    getPlaybackState: () => getArtboardStateSnapshot(),
    getRiveInstance,
    callbacks: {
        applyVmControlSnapshot,
        captureVmControlSnapshot,
        loadRiveAnimation,
        logEvent,
        showError,
        updateInfo,
    },
});
const {
    pause,
    play,
    reset,
    resetPlaybackChips,
    updatePlaybackChips,
} = playbackController;
fileSessionController = createFileSessionController({
    callbacks: {
        applyStoredRuntimeVersionForCurrentFile,
        buildFileRuntimePreferenceId: (fileName, fileSizeBytes, metadata = {}) => (
            createFileRuntimePreferenceId(fileName, fileSizeBytes, metadata, normalizeOpenedFilePath)
        ),
        cleanupInstance,
        ensureTauriBridge,
        getTauriEventListener,
        getTauriInvoker,
        hideError,
        initLucideIcons,
        isTauriEnvironment,
        loadRiveAnimation,
        logEvent,
        refreshInfoStrip,
        resetArtboardSwitcherState,
        resetVmInputControls,
        showError,
    },
    elements,
});
instanceController = createRiveInstanceController({
    callbacks: {
        cleanupTransparencyRuntime,
        detectDefaultStateMachineName,
        ensureRuntime,
        hideError,
        isCanvasEffectivelyTransparent,
        logEvent,
        populateArtboardSwitcher,
        refreshInfoStrip,
        renderVmInputControls,
        resetPlaybackChips,
        resetVmInputControls,
        setVmControlBaselineSnapshot,
        showError,
        syncArtboardStateAfterLoad,
        syncArtboardStateFromConfig,
        updateInfo,
        updatePlaybackChips,
    },
    elements,
    getCurrentLayoutAlignment,
    getCurrentFileBuffer,
    getCurrentLayoutFit,
    getCurrentRuntime,
    getEditorConfig: getLiveConfig,
});
shellController = createShellController({
    callbacks: {
        ensureRuntime,
        getCurrentFileName,
        getCurrentFileUrl,
        getCurrentLayoutAlignment,
        getCurrentLayoutFit,
        getCurrentRuntime,
        getEventLogFilterState,
        getTauriInvoker,
        getTransparencyStateSnapshot,
        handleResize,
        loadRiveAnimation,
        logEvent,
        reloadCurrentAnimation: refreshCurrentState,
        refreshInfoStrip,
        setCurrentLayoutAlignment: (nextLayoutAlignment) => {
            currentLayoutAlignment = nextLayoutAlignment;
        },
        setCurrentLayoutFit: (nextLayoutFit) => {
            currentLayoutFit = nextLayoutFit;
        },
        setCurrentRuntime: (nextRuntime) => {
            currentRuntime = nextRuntime;
        },
        showError,
        syncTransparencyControls,
        updateInfo,
        updateVersionInfo,
    },
    elements,
});
demoExportController = createDemoExportController({
    callbacks: {
        ensureRuntime,
        getTauriInvoker,
        logEvent,
        showError,
        updateInfo,
    },
    captureVmControlSnapshot,
    getArtboardStateSnapshot,
    getCurrentFileBuffer,
    getCurrentFileName,
    getCurrentLayoutAlignment,
    getCurrentLayoutFit,
    getCurrentRuntime,
    getEditorConfig: getLiveConfig,
    getEffectiveRuntimeVersionToken,
    getLayoutStateSnapshot: () => shellController?.captureLayoutStateForExport() ?? {},
    getRiveInstance,
    getRuntimeAsset,
    getLiveConfigState,
    getRuntimeVersionToken: () => runtimeVersionToken,
    getSelectedControlKeys: () => instantiationControlsDialogController?.getSelectedControlKeys() ?? null,
    getTransparencyStateSnapshot,
    getChangedVmControlSnapshot,
    serializeVmHierarchy,
});
instantiationControlsDialogController = createInstantiationControlsDialogController({
    callbacks: {
        createDemoBundle: (options) => demoExportController.createDemoBundle(options),
        generateWebInstantiationCode: (options) => demoExportController.generateWebInstantiationCode(options),
        getCurrentFileName,
        getTauriInvoker,
        initLucideIcons,
        logEvent,
        showError,
        updateInfo,
    },
    captureVmControlSnapshot,
    elements,
    getChangedVmControlSnapshot,
    serializeControlHierarchy,
});
const globalBindingsController = createGlobalBindingsController({
    callbacks: {
        applyCodeAndReload,
        createDemoBundle,
        ensureEditorReady,
        exportDemoToPath: (outputPath) => demoExportController.exportDemoToPath(outputPath),
        getArtboardStateSnapshot,
        getCurrentFileBuffer,
        getCurrentFileMimeType,
        getCurrentFileName,
        getCurrentRuntime,
        getEditorCode,
        getEventLogEntries,
        getGenerateWebInstantiationCode: async (packageSource) => demoExportController.generateWebInstantiationCode({ packageSource }),
        getLiveConfigState,
        getScriptConsoleEntries: (limit) => scriptConsoleController.readCaptured(limit),
        getRuntimeSourceText,
        getRuntimeVersion,
        handleFileButtonClick: () => fileSessionController?.handleFileButtonClick(),
        injectCodeSnippet,
        loadRiveAnimation,
        logEvent,
        closeScriptConsole: () => {
            void setConsoleMode('events');
            return { open: false };
        },
        execScriptConsole: async (code) => {
            await setConsoleMode('js');
            return scriptConsoleController.exec(code);
        },
        isScriptConsoleOpen: () => scriptConsoleController.isOpen(),
        openScriptConsole: async () => {
            await setConsoleMode('js');
            return { open: true };
        },
        pause,
        play,
        refreshVmInputControls: renderVmInputControls,
        reset,
        resetToDefaultArtboard,
        setCurrentFile: (...args) => fileSessionController?.setCurrentFile(...args),
        setEditorCode,
        showMcpSetup,
        switchArtboard,
        toggleInstantiationControlsDialog: (action) => instantiationControlsDialogController?.toggleDialog(action),
        toggleLiveConfigSource,
    },
    elements,
});

scriptConsoleController.installCapture();

function deriveConsoleModeFromControllers() {
    if (eventLogController?.isCollapsed?.()) {
        return 'closed';
    }
    if (scriptConsoleController?.isOpen?.()) {
        return 'js';
    }
    return 'events';
}

function updateConsoleModeChip() {
    const chip = elements.consoleModeChip;
    if (!chip) {
        return;
    }

    const labels = {
        closed: 'CLOSED',
        events: 'EVENTS',
        js: 'JS',
    };
    const titles = {
        closed: 'Console closed (click to open events)',
        events: 'Event console open (click to open JavaScript console)',
        js: 'JavaScript console open (click to close console)',
    };

    chip.dataset.consoleMode = currentConsoleMode;
    chip.title = titles[currentConsoleMode] || titles.closed;
    if (elements.consoleModeChipLabel) {
        elements.consoleModeChipLabel.textContent = labels[currentConsoleMode] || labels.closed;
    } else {
        chip.textContent = labels[currentConsoleMode] || labels.closed;
    }
}

async function setConsoleMode(mode) {
    const normalizedMode = ['closed', 'events', 'js'].includes(mode) ? mode : 'events';
    syncingConsoleMode = true;
    try {
        if (normalizedMode === 'closed') {
            scriptConsoleController.close();
            eventLogController.setCollapsed(true);
        } else if (normalizedMode === 'events') {
            eventLogController.setCollapsed(false);
            scriptConsoleController.close();
        } else {
            eventLogController.setCollapsed(false);
            await scriptConsoleController.open();
        }
        currentConsoleMode = normalizedMode;
    } catch (error) {
        currentConsoleMode = deriveConsoleModeFromControllers();
        showError(`Failed to open JavaScript console: ${error.message}`);
        logEvent('ui', 'console-open-failed', error.message);
        throw error;
    } finally {
        syncingConsoleMode = false;
        updateConsoleModeChip();
    }
}

function handleEventLogCollapsedChange(collapsed) {
    if (syncingConsoleMode) {
        return;
    }

    if (collapsed && scriptConsoleController?.isOpen()) {
        scriptConsoleController.close();
    }

    currentConsoleMode = collapsed
        ? 'closed'
        : (scriptConsoleController?.isOpen() ? 'js' : 'events');
    updateConsoleModeChip();
}

function handleScriptConsoleOpenChange(isOpen) {
    if (syncingConsoleMode) {
        return;
    }

    currentConsoleMode = isOpen
        ? 'js'
        : (eventLogController?.isCollapsed?.() ? 'closed' : 'events');
    updateConsoleModeChip();
}

function handleScriptConsoleToggleRequest() {
    const nextMode = deriveConsoleModeFromControllers() === 'js' ? 'events' : 'js';
    setConsoleMode(nextMode).catch(() => {
        /* setConsoleMode already reports errors */
    });
}

function buildLiveInstantiationDescriptor() {
    const liveConfigState = getLiveConfigState();
    return buildEffectiveInstantiationDescriptor({
        artboardState: getArtboardStateSnapshot(),
        currentFileName: getCurrentFileName() || 'animation.riv',
        currentLayoutAlignment,
        currentLayoutFit,
        detectedStateMachines: Array.isArray(getRiveInstance()?.stateMachineNames)
            ? getRiveInstance().stateMachineNames
            : [],
        editorCode: liveConfigState.appliedEditorCode,
        editorConfig: getLiveConfig(),
        runtimeName: getCurrentRuntime(),
        runtimeVersion: getCurrentRuntimeVersion(),
        sourceMode: liveConfigState.sourceMode,
        transparencyState: getTransparencyStateSnapshot(),
    });
}

async function cycleConsoleMode() {
    const modeOrder = ['closed', 'events', 'js'];
    currentConsoleMode = deriveConsoleModeFromControllers();
    const currentIndex = modeOrder.indexOf(currentConsoleMode);
    const nextMode = modeOrder[(currentIndex + 1) % modeOrder.length];
    await setConsoleMode(nextMode);
}

async function refreshCurrentState() {
    const currentFileUrl = getCurrentFileUrl();
    const currentFileName = getCurrentFileName();
    if (!currentFileUrl || !currentFileName) {
        showError('Please load a Rive file first');
        return false;
    }

    const currentArtboardState = getArtboardStateSnapshot();
    const viewModelSnapshot = captureVmControlSnapshot();
    const wasPlaying = Boolean(getRiveInstance()?.isPlaying);
    const configOverrides = {
        autoBind: true,
        autoplay: true,
    };

    if (currentArtboardState.currentArtboard) {
        configOverrides.artboard = currentArtboardState.currentArtboard;
    }
    if (currentArtboardState.currentPlaybackType === 'stateMachine' && currentArtboardState.currentPlaybackName) {
        configOverrides.stateMachines = currentArtboardState.currentPlaybackName;
        delete configOverrides.animations;
    } else if (currentArtboardState.currentPlaybackType === 'animation' && currentArtboardState.currentPlaybackName) {
        configOverrides.animations = currentArtboardState.currentPlaybackName;
        delete configOverrides.stateMachines;
    }

    updateInfo(`Refreshing ${currentFileName}...`);
    logEvent('ui', 'refresh-start', `Refreshing ${currentFileName}.`, {
        artboard: currentArtboardState.currentArtboard || null,
        controls: viewModelSnapshot.length,
        playback: currentArtboardState.currentPlaybackName || null,
        wasPlaying,
    });

    let restoredControls = 0;
    try {
        await new Promise((resolve, reject) => {
            let settled = false;
            const resolveOnce = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const rejectOnce = (error) => {
                if (!settled) {
                    settled = true;
                    reject(error || new Error('Animation refresh failed'));
                }
            };

            loadRiveAnimation(currentFileUrl, currentFileName, {
                configOverrides,
                onLoaded: () => {
                    restoredControls = applyVmControlSnapshot(viewModelSnapshot);
                    if (!wasPlaying) {
                        getRiveInstance()?.pause?.();
                    }
                    resolveOnce();
                },
                onLoadError: rejectOnce,
            }).catch(rejectOnce);
        });

        updateInfo(`Refreshed ${currentFileName}`);
        logEvent('ui', 'refresh-complete', `Refreshed ${currentFileName}.`, {
            artboard: currentArtboardState.currentArtboard || null,
            playback: currentArtboardState.currentPlaybackName || null,
            restoredControls,
            wasPlaying,
        });
        return true;
    } catch (error) {
        showError(`Failed to refresh animation: ${error?.message || error}`);
        logEvent('ui', 'refresh-failed', 'Failed to refresh current animation state.', error);
        return false;
    }
}

init();

async function init() {
    console.log('[rive-viewer] init start');
    await ensureTauriBridge();
    globalBindingsController.bind();
    window.buildLiveInstantiationDescriptor = buildLiveInstantiationDescriptor;
    initLucideIcons();
    resolveAppVersion();
    updateVersionInfo('Loading runtime...');
    bindUiActionHandlers({
        elements,
        actions: {
            applyCodeAndReload,
            handleFileButtonClick: () => fileSessionController?.handleFileButtonClick(),
            injectCodeSnippet,
            pause,
            play,
            reset,
            showInstantiationControlsDialogForExport: () => instantiationControlsDialogController?.openDialog(),
            showInstantiationControlsDialogForSnippet: () => instantiationControlsDialogController?.openDialog(),
            showMcpSetup,
        },
    });
    elements.consoleModeChip?.addEventListener('click', () => {
        cycleConsoleMode().catch(() => {
            /* setConsoleMode already reports errors */
        });
    });
    fileSessionController.setupFileInput();
    fileSessionController.updateFileTriggerButton('empty');
    setupCanvasColor();
    setupTransparencyControls();
    setupEventLog();
    instantiationControlsDialogController?.setup();
    scriptConsoleController.setup();
    updateConsoleModeChip();
    setupArtboardSwitcher();
    shellController?.setup();
    updaterController?.setup();
    await ensureEditorReady();
    window.setTimeout(() => {
        ensureEditorReady().catch(() => {
            /* noop */
        });
    }, 0);
    await setupRuntimeVersionPicker();
    fileSessionController.setupDragAndDrop();
    await fileSessionController.setupTauriOpenFileListener();
    resetVmInputControls('No animation loaded.');
    resetEventLog();
    refreshInfoStrip();
    window.addEventListener('resize', handleResize);
    window.addEventListener('beforeunload', () => {
        scriptConsoleController.destroy();
        shellController?.dispose();
        fileSessionController?.dispose();
        cleanupTransparencyRuntime().catch(() => {
            /* noop */
        });
    });
    console.log('[rive-viewer] setup complete, loading runtime...');
    updaterController?.checkForUpdatesOnLaunch().catch((error) => {
        console.warn('[rive-viewer] updater check failed:', error);
    });
    ensureRuntime(currentRuntime)
        .then(async () => {
            updateVersionInfo();
            refreshInfoStrip();
            console.log('[rive-viewer] runtime ready:', getCurrentRuntime());
            // Check if the app was launched via "Open With" with a .riv file
            const loadedFromPending = await fileSessionController.checkOpenedFile();
            if (!loadedFromPending) {
                console.log('[rive-viewer] no pending file at startup; open-file polling enabled');
            }
            fileSessionController.startOpenedFilePolling();
        })
        .catch((error) => {
            console.error('[rive-viewer] runtime load failed:', error);
            showError(`Failed to load runtime: ${error.message}`);
        });

}

function initLucideIcons() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
}

function getRiveInstance() {
    return instanceController?.getRiveInstance() ?? null;
}

async function loadRiveAnimation(fileUrl, fileName, options = {}) {
    if (!instanceController) {
        throw new Error('Rive instance controller is not initialized');
    }
    return instanceController.loadRiveAnimation(fileUrl, fileName, options);
}

async function createDemoBundle() {
    return demoExportController?.createDemoBundle();
}

function handleResize() {
    instanceController?.handleResize();
}

function cleanupInstance() {
    instanceController?.cleanupInstance();
}
