import { createArtboardSwitcherController } from '../../rive/artboard-switcher.js';
import { detectDefaultStateMachineName } from '../../rive/default-state-machine.js';
import { createRiveInstanceController } from '../../rive/instance-controller.js';
import { createPlaybackController } from '../../rive/playback-controls.js';
import { createVmControlsController } from '../../rive/vm-controls.js';
import { createEmbeddedImageAssetCatalog } from '../../rive/assets/embedded-image-assets.js';

export function createRiveStack({
    elements,
    callbacks,
} = {}) {
    const {
        activateAuthoritativeSurface,
        applyCanvasBackground,
        detectDefaultStateMachineNameOverride = detectDefaultStateMachineName,
        ensureRuntime,
        getCurrentFileBuffer,
        getCurrentFileName,
        getCurrentFileUrl,
        getCurrentCanvasSizing,
        getCurrentLayoutAlignment,
        getCurrentLayoutFit,
        getCurrentRuntime,
        getLoadedRuntime,
        getLiveConfig,
        getRiveInstance,
        getRenderSurfaceAuthority,
        getRenderSurfaceCanonicalState,
        getTauriInvoker,
        hideError,
        initLucideIcons,
        isCanvasBackgroundTransparent,
        isAuthoritativeChildMode,
        loadRiveAnimation,
        logEvent,
        populateArtboardSwitcher,
        requestAuthoritativeCommand,
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
    } = callbacks;

    let instanceController = null;
    const embeddedImageAssetCatalog = createEmbeddedImageAssetCatalog();
    const vmControlsController = createVmControlsController({
        elements,
        getEmbeddedImageAssets: () => embeddedImageAssetCatalog.list(),
        getCurrentRuntime,
        getLoadedRuntime,
        getRiveInstance,
        getRenderSurfaceAuthority,
        getRenderSurfaceCanonicalState,
        pickImageFile: async () => {
            const invoke = getTauriInvoker?.();
            if (typeof invoke !== 'function') return null;
            return invoke('pick_image_file');
        },
        callbacks: {
            initLucideIcons,
            logEvent,
            showError,
        },
        isAuthoritativeChildMode: Boolean(isAuthoritativeChildMode?.()),
    });
    const {
        applyVmControlSnapshot,
        captureVmControlSnapshot,
        getChangedVmControlSnapshot,
        getVmSyncDiagnostics,
        renderVmInputControls: renderVmInputs,
        resetVmInputControls: resetVmInputs,
        serializeControlHierarchy,
        serializeVmHierarchy,
        setVmControlBaselineSnapshot: setVmBaseline,
    } = vmControlsController;

    const artboardSwitcherController = createArtboardSwitcherController({
        elements,
        getCurrentFileName,
        getCurrentFileUrl,
        getRiveInstance,
        isAuthoritativeChildMode,
        callbacks: {
            initLucideIcons,
            loadRiveAnimation,
            logEvent,
            requestAuthoritativeCommand,
            resetRiveInstance: (...args) => instanceController?.resetRiveInstance?.(...args) ?? false,
            renderVmInputControls: renderVmInputs,
            showError,
            updateInfo,
        },
    });
    const {
        getStateSnapshot: getArtboardStateSnapshot,
        populateArtboardSwitcher: populateArtboards,
        resetForNewFile: resetArtboardSwitcherState,
        resetToDefaultArtboard,
        setupArtboardSwitcher,
        switchArtboard,
        switchVmInstance,
        syncStateAfterLoad: syncArtboardAfterLoad,
        syncStateFromCanonical: syncArtboardFromCanonical,
        syncStateFromConfig: syncArtboardFromConfig,
    } = artboardSwitcherController;

    const playbackController = createPlaybackController({
        getCurrentFileName,
        getCurrentFileUrl,
        getPlaybackState: () => getArtboardStateSnapshot(),
        getRiveInstance,
        isAuthoritativeChildMode,
        callbacks: {
            applyVmControlSnapshot,
            captureVmControlSnapshot,
            loadRiveAnimation,
            logEvent,
            requestAuthoritativeCommand,
            resetRiveInstance: (...args) => instanceController?.resetRiveInstance?.(...args) ?? false,
            showError,
            updateInfo,
        },
    });
    const {
        pause,
        play,
        reset,
        resetPlaybackChips: resetPlaybackIndicators,
        updatePlaybackChips: updatePlaybackIndicators,
    } = playbackController;

    instanceController = createRiveInstanceController({
        callbacks: {
            activateAuthoritativeSurface,
            applyCanvasBackground,
            detectDefaultStateMachineName: detectDefaultStateMachineNameOverride,
            ensureRuntime,
            hideError,
            isCanvasBackgroundTransparent,
            logEvent,
            populateArtboardSwitcher: populateArtboards,
            refreshInfoStrip,
            renderVmInputControls: renderVmInputs,
            resetPlaybackChips: resetPlaybackIndicators,
            resetVmInputControls: resetVmInputs,
            setVmControlBaselineSnapshot: setVmBaseline,
            showError,
            getPlaybackState: getArtboardStateSnapshot,
            syncArtboardStateAfterLoad: syncArtboardAfterLoad,
            syncArtboardStateFromConfig: syncArtboardFromConfig,
            updateInfo,
            updatePlaybackChips: updatePlaybackIndicators,
        },
        embeddedImageAssetCatalog,
        elements,
        getCurrentCanvasSizing,
        getCurrentLayoutAlignment,
        getCurrentFileBuffer,
        getCurrentLayoutFit,
        getCurrentRuntime,
        getEditorConfig: getLiveConfig,
        isAuthoritativeChildMode,
    });

    return {
        applyVmControlSnapshot,
        captureVmControlSnapshot,
        getArtboardStateSnapshot,
        getChangedVmControlSnapshot,
        getVmSyncDiagnostics,
        instanceController,
        pause,
        play,
        populateArtboardSwitcher: populateArtboards,
        renderVmInputControls: renderVmInputs,
        reset,
        resetArtboardSwitcherState,
        resetPlaybackChips: resetPlaybackIndicators,
        resetToDefaultArtboard,
        resetVmInputControls: resetVmInputs,
        serializeControlHierarchy,
        serializeVmHierarchy,
        setVmControlBaselineSnapshot: setVmBaseline,
        setupArtboardSwitcher,
        switchArtboard,
        switchVmInstance,
        syncArtboardStateAfterLoad: syncArtboardAfterLoad,
        syncArtboardStateFromCanonical: syncArtboardFromCanonical,
        syncArtboardStateFromConfig: syncArtboardFromConfig,
        updatePlaybackChips: updatePlaybackIndicators,
        vmControlsController,
    };
}
