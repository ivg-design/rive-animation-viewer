import './platform/mcp/bridge-client.js';
import { createCodeMirrorLoader } from './bootstrap/codemirror-loader.js';
import { createControllerStack } from './bootstrap/stacks/controller-stack.js';
import { installAppDialogs } from './bootstrap/dom/dialogs.js';
import { createInstanceHooks } from './bootstrap/instance-hooks.js';
import { startApp } from './bootstrap/startup.js';
import { createStatusHelpers } from './bootstrap/status-helpers.js';
import {
    loadCanvasSizingPreference,
    normalizeCanvasSizingState,
    persistCanvasSizingPreference,
} from './core/canvas-sizing.js';
import {
    DEFAULT_LAYOUT_ALIGNMENT,
    DEFAULT_LAYOUT_FIT,
    FALLBACK_RUNTIME_VERSION_OPTIONS,
    RUNTIME_VERSION_OPTION_COUNT,
} from './core/constants.js';
import { getElements } from './core/elements.js';
import { normalizeOpenedFilePath } from './platform/session/file-session.js';
import {
    buildFileRuntimePreferenceId as createFileRuntimePreferenceId,
    loadRuntimeMeta,
    loadRuntimeVersionByFile,
    loadRuntimeVersionPreference,
} from './platform/runtime/runtime-utils.js';
import { createTauriBridgeController } from './platform/tauri-bridge.js';
import {
    createTimelineSeekHandler,
    createTimelineProgressController,
} from './rive/timeline-progress.js';

const APP_BUILD = '__APP_BUILD__';
const APP_BUILD_PLACEHOLDER = '__APP' + '_BUILD__';
const APP_CHANNEL = '__APP_CHANNEL__';
const APP_VERSION = '__APP_VERSION__';
const APP_VERSION_PLACEHOLDER = '__APP' + '_VERSION__';

// MCP acceptance must be able to prove that it reached the same packaged
// WebView as the explicitly selected sidecar. Keep this small, immutable, and
// free of local paths or device identity.
window.__RAV_BUILD_INFO__ = Object.freeze({
    build: APP_BUILD,
    channel: APP_CHANNEL,
    version: APP_VERSION,
});

const runtimePreferences = {
    runtimeVersionByFile: loadRuntimeVersionByFile(),
    runtimeVersionToken: loadRuntimeVersionPreference(),
};

const tauriController = createTauriBridgeController();
const {
    ensureTauriBridge,
    getTauriEventListener,
    getTauriInvoker,
    isTauriEnvironment,
} = tauriController;
const codeMirrorLoader = createCodeMirrorLoader({ isTauriEnvironment });

const runtimeState = {
    runtimeAssets: {},
    runtimeBlobUrls: {},
    runtimeMeta: loadRuntimeMeta(),
    runtimePromises: {},
    runtimeRegistry: {},
    runtimeResolvedUrls: {},
    runtimeSourceTexts: {},
    runtimeVersionByFile: runtimePreferences.runtimeVersionByFile,
    runtimeVersions: {},
    runtimeVersionOptionsState: {
        latest: FALLBACK_RUNTIME_VERSION_OPTIONS[0],
        versions: FALLBACK_RUNTIME_VERSION_OPTIONS.slice(0, RUNTIME_VERSION_OPTION_COUNT),
    },
    runtimeWarningsShown: new Set(),
    setRuntimeVersionToken: (nextToken) => {
        appState.runtimeVersionToken = nextToken;
    },
};

const appState = {
    canvasSizing: loadCanvasSizingPreference(),
    currentLayoutAlignment: DEFAULT_LAYOUT_ALIGNMENT,
    currentLayoutFit: DEFAULT_LAYOUT_FIT,
    currentMcpPort: Number(globalThis.window?._mcpBridge?.port) || 9274,
    currentRuntime: 'webgl2',
    runtimeVersionToken: runtimePreferences.runtimeVersionToken,
};

let demoExportController = null;
let fileSessionController = null;
let instanceController = null;
let instantiationControlsDialogController = null;
let shellController = null;
let statusController = null;
let refreshCurrentState = async () => false;

const getCurrentFileBuffer = () => fileSessionController?.getCurrentFileBuffer() ?? null;
const getCurrentFileMimeType = () => fileSessionController?.getCurrentFileMimeType() ?? 'application/octet-stream';
const getCurrentFileName = () => fileSessionController?.getCurrentFileName() ?? null;
const getCurrentFilePreferenceId = () => fileSessionController?.getCurrentFilePreferenceId() ?? null;
const getCurrentFileSourcePath = () => fileSessionController?.getCurrentFileSourcePath() ?? '';
const getCurrentFileSizeBytes = () => fileSessionController?.getCurrentFileSizeBytes() ?? 0;
const getCurrentFileUrl = () => fileSessionController?.getCurrentFileUrl() ?? null;
const getCurrentCanvasSizing = () => normalizeCanvasSizingState(appState.canvasSizing);
const getCurrentLayoutAlignment = () => appState.currentLayoutAlignment;
const getCurrentLayoutFit = () => appState.currentLayoutFit;
const getCurrentMcpPort = () => appState.currentMcpPort;
const getCurrentRuntime = () => appState.currentRuntime;
const getRuntimeVersionToken = () => appState.runtimeVersionToken;

const {
    hideError,
    refreshInfoStrip,
    resolveAppVersion,
    showError,
    updateInfo,
    updateVersionInfo,
} = createStatusHelpers({
    getStatusController: () => statusController,
});
const {
    cleanupInstance,
    createDemoBundle,
    getRiveInstance,
    handleResize,
    initLucideIcons,
    loadRiveAnimation,
    syncMcpPortFromDesktop,
} = createInstanceHooks({
    getCurrentMcpPort,
    getDemoExportController: () => demoExportController,
    getInstanceController: () => instanceController,
    getTauriInvoker,
    setCurrentMcpPort: (nextPort) => {
        appState.currentMcpPort = nextPort;
    },
});

const setCurrentMcpPort = async (nextPort) => {
    const invoke = getTauriInvoker();
    if (!invoke) {
        throw new Error('MCP port changes are available only in the desktop app');
    }
    const resolvedPort = await invoke('set_mcp_port', { port: nextPort });
    appState.currentMcpPort = Number(resolvedPort) || nextPort;
    try {
        window.localStorage?.setItem('rav-mcp-port', String(appState.currentMcpPort));
    } catch {
        /* noop */
    }
    window.__RAV_MCP_PORT__ = appState.currentMcpPort;
    window._mcpBridge?.setPort?.(appState.currentMcpPort);
    return appState.currentMcpPort;
};

installAppDialogs();
const elements = getElements();

const controllerStack = createControllerStack({
    elements,
    placeholders: {
        appBuild: APP_BUILD,
        appBuildPlaceholder: APP_BUILD_PLACEHOLDER,
        appChannel: APP_CHANNEL,
        appVersion: APP_VERSION,
        appVersionPlaceholder: APP_VERSION_PLACEHOLDER,
    },
    callbacks: {
        buildFileRuntimePreferenceId: createFileRuntimePreferenceId,
        cleanupInstance,
        createDemoBundle,
        ensureTauriBridge,
        getCurrentFileBuffer,
        getCurrentFileMimeType,
        getCurrentFileName,
        getCurrentFilePreferenceId,
        getCurrentFileSourcePath,
        getCurrentFileSizeBytes,
        getCurrentFileUrl,
        getCurrentCanvasSizing,
        getCurrentLayoutAlignment,
        getCurrentLayoutFit,
        getCurrentMcpPort,
        getCurrentRuntime,
        getRiveInstance,
        getRuntimeVersionToken,
        getTauriEventListener,
        getTauriInvoker,
        handleResize,
        hideError,
        initLucideIcons,
        isTauriEnvironment,
        loadRiveAnimation,
        normalizeOpenedFilePath,
        refreshInfoStrip,
        resolveAppVersion,
        setCurrentLayoutAlignment: (nextLayoutAlignment) => {
            appState.currentLayoutAlignment = nextLayoutAlignment;
        },
        setCurrentLayoutFit: (nextLayoutFit) => {
            appState.currentLayoutFit = nextLayoutFit;
        },
        setCurrentCanvasSizing: (nextCanvasSizing) => {
            appState.canvasSizing = normalizeCanvasSizingState(nextCanvasSizing, appState.canvasSizing);
            persistCanvasSizingPreference(appState.canvasSizing);
            return appState.canvasSizing;
        },
        setCurrentMcpPort,
        setCurrentRuntime: (nextRuntime) => {
            appState.currentRuntime = nextRuntime;
        },
        showError,
        updateInfo,
        updateVersionInfo,
    },
    refs: {
        codeMirrorModulesRef: () => codeMirrorLoader.getModules(),
        getRefreshCurrentState: () => refreshCurrentState,
        loadCodeMirror: () => codeMirrorLoader.loadCodeMirror(),
    },
    runtimeState,
});

demoExportController = controllerStack.demoExportController;
fileSessionController = controllerStack.fileSessionController;
instanceController = controllerStack.instanceController;
instantiationControlsDialogController = controllerStack.instantiationControlsDialogController;
shellController = controllerStack.shellController;
statusController = controllerStack.statusController;

createTimelineProgressController({
    onSeek: createTimelineSeekHandler({
        getPlaybackState: () => controllerStack.getArtboardStateSnapshot?.() || {},
        getRiveInstance,
        isAuthoritativeChildMode: isTauriEnvironment,
        requestAuthoritativeCommand: (...args) => (
            controllerStack.renderSurfaceController?.requestActiveCommand?.(...args)
            ?? Promise.resolve({ applied: false, status: 'unavailable' })
        ),
    }),
});

startApp({
    elements,
    callbacks: {
        ...controllerStack,
        ensureTauriBridge,
        getCurrentFileName,
        getCurrentFileSourcePath,
        getCurrentFileUrl,
        getCurrentCanvasSizing,
        getCurrentLayoutAlignment,
        getCurrentLayoutFit,
        getCurrentRuntime,
        getRiveInstance,
        getTauriInvoker,
        handleResize,
        initLucideIcons,
        loadRiveAnimation,
        refreshInfoStrip,
        resolveAppVersion,
        showError,
        syncMcpPortFromDesktop,
        updateInfo,
        updateVersionInfo,
    },
    globalBindingsController: controllerStack.globalBindingsController,
    setRefreshCurrentState: (nextRefreshCurrentState) => {
        refreshCurrentState = nextRefreshCurrentState;
    },
});
