import { createAppUpdaterController } from '../platform/app-updater.js';
import { createEventLogController } from '../ui/event-log.js';
import { createMcpSetupController } from '../ui/mcp-setup.js';
import { createAboutDialogController } from '../ui/about/about-dialog.js';
import { createCodeEditorController } from '../ui/code-editor.js';
import { createConsoleModeController } from '../ui/console/console-mode-controller.js';
import { createScriptConsoleController } from '../ui/script-console.js';
import { createStatusController } from '../ui/status-controller.js';

export function createUiStack({
    elements,
    placeholders,
    callbacks,
    refs,
} = {}) {
    const {
        getCurrentFileName,
        getCurrentFileSizeBytes,
        getCurrentRuntime,
        getCurrentRuntimeSource,
        getCurrentRuntimeVersion,
        getLoadedRuntime,
        getRuntimeVersionToken,
        getTauriEventListener,
        getTauriInvoker,
        initLucideIcons,
        isTauriEnvironment,
        refreshCurrentState,
        handleResize,
        loadRiveAnimation,
        logEvent: externalLogEvent,
        resolveAppVersion,
        showError,
        updateInfo,
    } = callbacks;
    const { codeMirrorModulesRef, loadCodeMirror, getCurrentFileUrl } = refs;

    let consoleModeController = null;

    const eventLogController = createEventLogController({
        callbacks: {
            onCollapsedChange: (collapsed) => consoleModeController?.handleEventLogCollapsedChange(collapsed),
        },
        elements,
        handleResize,
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
        getBridgeEnabled: () => window._mcpBridge?.enabled !== false,
        getBridgeConnected: () => window._mcpBridge?.connected,
        getTauriInvoker,
        initLucideIcons,
    });

    const scriptConsoleController = createScriptConsoleController({
        callbacks: {
            logEvent,
            onOpenChange: (isOpen) => consoleModeController?.handleScriptConsoleOpenChange(isOpen),
            onToggleRequested: () => consoleModeController?.handleScriptConsoleToggleRequest(),
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
        codeMirrorModulesRef,
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
        getVmExplorerSnippetState,
        injectCodeSnippet,
        setEditorCode,
        setLiveConfigSource,
        setVmExplorerSnippetEnabled,
        toggleLiveConfigSource,
    } = codeEditorController;

    const updaterController = createAppUpdaterController({
        callbacks: {
            logEvent,
            showError,
            updateInfo,
        },
        elements,
        getTauriInvoker,
        isTauriEnvironment,
    });

    const statusController = createStatusController({
        callbacks: {
            getCurrentFileName,
            getCurrentFileSizeBytes,
            getCurrentRuntime,
            getCurrentRuntimeSource,
            getCurrentRuntimeVersion,
            getLoadedRuntime,
            getRuntimeVersionToken,
            initLucideIcons,
        },
        elements,
        placeholders,
    });

    const aboutDialogController = createAboutDialogController({
        callbacks: {
            getAppBuildLabel: () => statusController?.getBuildIdLabel?.() || 'dev',
            getAppVersionLabel: () => statusController?.getResolvedAppVersion?.() || 'dev',
            getCurrentRuntime,
            getCurrentRuntimeVersion: () => getCurrentRuntimeVersion() || 'latest',
            getOpenExternalUrl: () => {
                const invoke = getTauriInvoker();
                return invoke ? (url) => invoke('open_external_url', { url }) : null;
            },
            getTauriEventListener,
            resolveAppVersion,
        },
        initLucideIcons,
    });

    consoleModeController = createConsoleModeController({
        callbacks: {
            logEvent: externalLogEvent || logEvent,
            showError,
        },
        elements,
        eventLogController,
        scriptConsoleController,
    });

    return {
        aboutDialogController,
        applyCodeAndReload,
        codeEditorController,
        consoleModeController,
        ensureEditorReady,
        eventLogController,
        getEditorCode,
        getEditorConfig,
        getEventLogEntries,
        getEventLogFilterState,
        getLiveConfig,
        getLiveConfigState,
        getVmExplorerSnippetState,
        injectCodeSnippet,
        logEvent,
        resetEventLog,
        scriptConsoleController,
        setEditorCode,
        setLiveConfigSource,
        setVmExplorerSnippetEnabled,
        setupEventLog,
        showMcpSetup,
        statusController,
        toggleLiveConfigSource,
        updaterController,
    };
}
