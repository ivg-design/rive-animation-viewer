import { createPlatformStack } from './platform-stack.js';
import { createRiveStack } from './rive-stack.js';
import { createRuntimeStack } from './runtime-stack.js';
import { createUiStack } from './ui-stack.js';
import { buildPlaybackContext, buildPlaybackStatusLabel } from '../../rive/playback-status.js';

export function createControllerStack({
    elements,
    placeholders,
    callbacks,
    refs,
    runtimeState,
} = {}) {
    const {
        codeMirrorModulesRef,
        getRefreshCurrentState,
        loadCodeMirror,
    } = refs;
    const {
        buildFileRuntimePreferenceId,
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
        resolveAppVersion,
        setCurrentCanvasSizing,
        setCurrentLayoutAlignment,
        setCurrentLayoutFit,
        setCurrentMcpPort,
        setCurrentRuntime,
        showError,
        updateInfo,
        updateVersionInfo,
    } = callbacks;
    let runtimeStack = null;
    let runtimeLoaderController = null;
    let platformStack = null;

    const uiStack = createUiStack({
        elements,
        placeholders,
        callbacks: {
            getCurrentFileName,
            getCurrentFileSourcePath,
            getCurrentFileSizeBytes,
            getCurrentCanvasSizing,
            getCurrentMcpPort,
            getCurrentRuntime,
            getCurrentRuntimeSource: () => runtimeLoaderController?.getCurrentRuntimeSource?.(),
            getCurrentRuntimeVersion: () => runtimeLoaderController?.getCurrentRuntimeVersion?.(),
            getLoadedRuntime: () => runtimeLoaderController?.getLoadedRuntime?.(),
            getRuntimeVersionToken,
            getTauriEventListener,
            getTauriInvoker,
            handleResize,
            initLucideIcons,
            isTauriEnvironment,
            loadRiveAnimation,
            refreshCurrentState: (...args) => getRefreshCurrentState()(...args),
            requestUiOverlay: (request) => platformStack?.shellController?.openUiOverlay?.(request) ?? false,
            resolveAppVersion,
            setCurrentCanvasSizing,
            showError,
            updateInfo,
        },
        refs: {
            codeMirrorModulesRef,
            getCurrentFileUrl,
            loadCodeMirror,
        },
    });

    runtimeStack = createRuntimeStack({
        elements,
        state: runtimeState,
        callbacks: {
            getCurrentFileBuffer,
            getCurrentFileName,
            getCurrentFilePreferenceId,
            getCurrentFileUrl,
            getCurrentRuntime,
            getCurrentRuntimeVersionToken: getRuntimeVersionToken,
            getRiveInstance,
            getTauriInvoker,
            isTauriEnvironment,
            loadRiveAnimation,
            logEvent: uiStack.logEvent,
            refreshCurrentState: (...args) => getRefreshCurrentState()(...args),
            refreshInfoStrip: callbacks.refreshInfoStrip,
            showError,
            updateVersionInfo,
        },
    });
    runtimeLoaderController = runtimeStack.runtimeLoaderController;
    const {
        applyRuntimeVersionToken,
        applyStoredRuntimeVersionForCurrentFile,
        ensureRuntime,
        getCurrentRuntimeSource,
        getCurrentRuntimeVersion,
        getEffectiveRuntimeVersionToken,
        getLoadedRuntime,
        getRuntimeAsset,
        getRuntimeSourceText,
        getRuntimeVersion,
        setupRuntimeVersionPicker,
    } = runtimeLoaderController;
    const canvasBackgroundController = runtimeStack.canvasBackgroundController;
    const {
        applyCanvasBackground,
        getStateSnapshot: getCanvasBackgroundStateSnapshot,
        isCanvasBackgroundTransparent,
        setupCanvasColor,
    } = canvasBackgroundController;

    const riveStack = createRiveStack({
        elements,
        callbacks: {
            activateAuthoritativeSurface: (options) => (
                platformStack?.renderSurfaceController?.loadCurrentAnimationForSelection?.(options)
                ?? platformStack?.renderSurfaceController?.loadCurrentAnimation?.(options) ?? false
            ),
            ensureRuntime,
            getCurrentFileBuffer,
            getCurrentFileName,
            getCurrentFileUrl,
            getCurrentCanvasSizing,
            getCurrentLayoutAlignment,
            getCurrentLayoutFit,
            getCurrentRuntime,
            getLoadedRuntime,
            getLiveConfig: uiStack.getLiveConfig,
            getCurrentRuntimeVersion,
            getRiveInstance,
            getRenderSurfaceAuthority: () => platformStack?.renderSurfaceController?.getState?.() || null,
            getRenderSurfaceCanonicalState: () => platformStack?.renderSurfaceController?.getCanonicalState?.() || null,
            getCanonicalSourceScope: () => platformStack?.renderSurfaceController?.getCanonicalSourceScope?.() || null,
            inspectFile: runtimeStack.inspectionController.inspect,
            getInspectionMetadata: runtimeStack.inspectionController.getMetadata,
            getControlSourceScope: () => isTauriEnvironment()
                ? platformStack?.renderSurfaceController?.getSourceScope?.() || null
                : runtimeStack.inspectionController.getSourceScope(riveStack.getArtboardStateSnapshot()),
            getCurrentSourceScope: () => runtimeStack.inspectionController.getSourceScope(
                riveStack.getArtboardStateSnapshot(),
            ),
            getTauriInvoker,
            hideError,
            initLucideIcons,
            applyCanvasBackground,
            isCanvasBackgroundTransparent,
            isAuthoritativeChildMode: isTauriEnvironment,
            loadRiveAnimation,
            logEvent: uiStack.logEvent,
            requestAuthoritativeCommand: (...args) => (
                platformStack?.renderSurfaceController?.requestCommand?.(...args)
                ?? Promise.resolve({ applied: false, status: 'unavailable' })
            ),
            refreshInfoStrip: callbacks.refreshInfoStrip,
            showError,
            updateInfo,
        },
    });

    platformStack = createPlatformStack({
        elements,
        callbacks: {
            applyCodeAndReload: uiStack.applyCodeAndReload,
            applyStoredRuntimeVersionForCurrentFile,
            buildFileRuntimePreferenceId: (fileName, fileSizeBytes, metadata = {}) => (
                buildFileRuntimePreferenceId(fileName, fileSizeBytes, metadata, normalizeOpenedFilePath)
            ),
            captureVmControlSnapshot: riveStack.captureVmControlSnapshot,
            cleanupInstance,
            consoleModeController: uiStack.consoleModeController,
            createDemoBundle,
            eventLogController: uiStack.eventLogController,
            ensureEditorReady: uiStack.ensureEditorReady,
            ensureRuntime,
            ensureTauriBridge,
            getArtboardStateSnapshot: riveStack.getArtboardStateSnapshot,
            getInspectionMetadata: runtimeStack.inspectionController.getMetadata,
            getCurrentSourceScope: () => runtimeStack.inspectionController.getSourceScope(riveStack.getArtboardStateSnapshot()),
            getChangedVmControlSnapshot: riveStack.getChangedVmControlSnapshot,
            getCurrentFileBuffer,
            getCurrentFileMimeType,
            getCurrentFileName,
            getCurrentFilePreferenceId,
            getCurrentFileUrl,
            getCurrentCanvasSizing,
            getCurrentLayoutAlignment,
            getCurrentLayoutFit,
            getCurrentMcpPort,
            getCurrentRuntime,
            getEffectiveRuntimeVersionToken,
            getEditorCode: uiStack.getEditorCode,
            getEventLogEntries: uiStack.getEventLogEntries,
            getEventLogFilterState: uiStack.getEventLogFilterState,
            getLiveConfig: uiStack.getLiveConfig,
            getLiveConfigState: uiStack.getLiveConfigState,
            getRiveInstance,
            getRuntimeAsset,
            getRuntimeSourceText,
            getRuntimeVersion,
            getRuntimeVersionToken,
            getSelectedControlKeys: () => platformStack.instantiationControlsDialogController?.getSelectedControlKeys() ?? null,
            getSidebarVisibility: () => platformStack.shellController?.getSidebarVisibility?.() ?? { left: false, right: true },
            getTauriEventListener,
            getTauriInvoker,
            getCanvasBackgroundStateSnapshot,
            getVmExplorerSnippetState: uiStack.getVmExplorerSnippetState,
            getVmSyncDiagnostics: riveStack.getVmSyncDiagnostics,
            handleFileButtonClick: () => platformStack.fileSessionController?.handleFileButtonClick(),
            handleResize,
            hideError,
            initLucideIcons,
            injectCodeSnippet: uiStack.injectCodeSnippet,
            isTauriEnvironment,
            loadRiveAnimation,
            logEvent: uiStack.logEvent,
            pause: riveStack.pause,
            play: riveStack.play,
            refreshCurrentState: (...args) => getRefreshCurrentState()(...args),
            refreshInfoStrip: callbacks.refreshInfoStrip,
            refreshVmInputControls: riveStack.renderVmInputControls,
            reset: riveStack.reset,
            resetArtboardSwitcherState: riveStack.resetArtboardSwitcherState,
            resetToDefaultArtboard: riveStack.resetToDefaultArtboard,
            resetVmInputControls: riveStack.resetVmInputControls,
            restoreFileSessionUi: () => {
                const canonicalState = platformStack?.renderSurfaceController?.getCanonicalState?.();
                if (canonicalState) {
                    riveStack.syncArtboardStateFromCanonical?.(canonicalState);
                }
                riveStack.populateArtboardSwitcher?.();
                riveStack.renderVmInputControls?.();
                // The hidden candidate reports its selection before the
                // visible child confirms a first frame. When that child is
                // rejected, restore the footer from the retained canonical
                // session rather than leaving the candidate's artboard/SM
                // label visible beside the restored file and properties.
                updateInfo(buildPlaybackStatusLabel(buildPlaybackContext({
                    playbackState: riveStack.getArtboardStateSnapshot?.() || {},
                    riveInstance: getRiveInstance(),
                })));
                callbacks.refreshInfoStrip?.();
            },
            serializeControlHierarchy: riveStack.serializeControlHierarchy,
            serializeVmHierarchy: riveStack.serializeVmHierarchy,
            setCurrentFile: (...args) => platformStack.fileSessionController?.setCurrentFile(...args),
            setCurrentCanvasSizing,
            setCurrentLayoutAlignment,
            setCurrentLayoutFit,
            setCurrentMcpPort,
            setCurrentRuntime,
            setEditorCode: uiStack.setEditorCode,
            setLiveConfigSource: uiStack.setLiveConfigSource,
            setSidebarVisibility: (visibility) => platformStack.shellController?.setSidebarVisibility?.(visibility) ?? { left: false, right: true },
            setVmExplorerSnippetEnabled: uiStack.setVmExplorerSnippetEnabled,
            showError,
            showMcpSetup: uiStack.showMcpSetup,
            switchArtboard: riveStack.switchArtboard,
            switchVmInstance: riveStack.switchVmInstance,
            toggleInstantiationControlsDialog: (action) => platformStack.instantiationControlsDialogController?.toggleDialog(action),
            toggleLiveConfigSource: uiStack.toggleLiveConfigSource,
            updateInfo,
            updateVersionInfo,
            scriptConsoleController: uiStack.scriptConsoleController,
        },
    });

    uiStack.scriptConsoleController.installCapture();

    return {
        ...uiStack,
        ...riveStack,
        ...platformStack,
        applyRuntimeVersionToken,
        ensureRuntime,
        getCurrentRuntimeSource,
        getCurrentRuntimeVersion,
        getEffectiveRuntimeVersionToken,
        getLoadedRuntime,
        getRuntimeAsset,
        getRuntimeSourceText,
        getRuntimeVersion,
        getCanvasBackgroundStateSnapshot,
        setupCanvasColor,
        setupRuntimeVersionPicker,
    };
}
