import {
    DEFAULT_LAYOUT_FIT,
    FALLBACK_RUNTIME_VERSION_OPTIONS,
    RUNTIME_VERSION_OPTION_COUNT,
} from './src/app/core/constants.js';
import { getElements } from './src/app/core/elements.js';
import { createDemoExportController } from './src/app/platform/demo-export.js';
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
let shellController = null;
let statusController = null;
let currentRuntime = 'webgl2';
let runtimeVersionToken = loadRuntimeVersionPreference();
let currentLayoutFit = DEFAULT_LAYOUT_FIT;
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
const eventLogController = createEventLogController({ elements, handleResize });
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
const codeEditorController = createCodeEditorController({
    callbacks: {
        getTauriInvoker,
        loadRiveAnimation,
        logEvent,
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
    injectCodeSnippet,
    setEditorCode,
} = codeEditorController;
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
    renderVmInputControls,
    resetVmInputControls,
    serializeVmHierarchy,
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
        showError,
        syncArtboardStateAfterLoad,
        syncArtboardStateFromConfig,
        updateInfo,
        updatePlaybackChips,
    },
    elements,
    getCurrentFileBuffer,
    getCurrentLayoutFit,
    getCurrentRuntime,
    getEditorConfig,
});
shellController = createShellController({
    callbacks: {
        ensureRuntime,
        getCurrentFileName,
        getCurrentFileUrl,
        getCurrentLayoutFit,
        getCurrentRuntime,
        getEventLogFilterState,
        getTauriInvoker,
        getTransparencyStateSnapshot,
        handleResize,
        loadRiveAnimation,
        logEvent,
        refreshInfoStrip,
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
    getArtboardStateSnapshot,
    getCurrentFileBuffer,
    getCurrentFileName,
    getCurrentLayoutFit,
    getCurrentRuntime,
    getEditorConfig,
    getEffectiveRuntimeVersionToken,
    getLayoutStateSnapshot: () => shellController?.captureLayoutStateForExport() ?? {},
    getRiveInstance,
    getRuntimeAsset,
    getRuntimeVersionToken: () => runtimeVersionToken,
    getTransparencyStateSnapshot,
    serializeVmHierarchy,
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
        getRuntimeSourceText,
        getRuntimeVersion,
        handleFileButtonClick: () => fileSessionController?.handleFileButtonClick(),
        injectCodeSnippet,
        loadRiveAnimation,
        logEvent,
        pause,
        play,
        refreshVmInputControls: renderVmInputControls,
        reset,
        resetToDefaultArtboard,
        setCurrentFile: (...args) => fileSessionController?.setCurrentFile(...args),
        setEditorCode,
        showMcpSetup,
        switchArtboard,
    },
    elements,
});

init();

async function init() {
    console.log('[rive-viewer] init start');
    await ensureTauriBridge();
    globalBindingsController.bind();
    initLucideIcons();
    resolveAppVersion();
    updateVersionInfo('Loading runtime...');
    bindUiActionHandlers({
        elements,
        actions: {
            applyCodeAndReload,
            createDemoBundle,
            handleFileButtonClick: () => fileSessionController?.handleFileButtonClick(),
            injectCodeSnippet,
            pause,
            play,
            reset,
            showMcpSetup,
        },
    });
    fileSessionController.setupFileInput();
    fileSessionController.updateFileTriggerButton('empty');
    setupCanvasColor();
    setupTransparencyControls();
    setupEventLog();
    setupArtboardSwitcher();
    shellController?.setup();
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
        shellController?.dispose();
        fileSessionController?.dispose();
        cleanupTransparencyRuntime().catch(() => {
            /* noop */
        });
    });
    console.log('[rive-viewer] setup complete, loading runtime...');
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
