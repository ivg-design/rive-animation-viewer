import { createArtboardSwitcherController } from '../../rive/artboard-switcher.js';
import { detectDefaultStateMachineName } from '../../rive/default-state-machine.js';
import { createRiveInstanceController } from '../../rive/instance-controller.js';
import { createPlaybackController } from '../../rive/playback-controls.js';
import { createVmControlsController } from '../../rive/vm-controls.js';

export function createRiveStack({
    elements,
    callbacks,
} = {}) {
    const {
        cleanupTransparencyRuntime,
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
        hideError,
        initLucideIcons,
        isCanvasEffectivelyTransparent,
        loadRiveAnimation,
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
    } = callbacks;

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
        callbacks: {
            initLucideIcons,
            loadRiveAnimation,
            logEvent,
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
        syncStateFromConfig: syncArtboardFromConfig,
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
        resetPlaybackChips: resetPlaybackIndicators,
        updatePlaybackChips: updatePlaybackIndicators,
    } = playbackController;

    const instanceController = createRiveInstanceController({
        callbacks: {
            cleanupTransparencyRuntime,
            detectDefaultStateMachineName: detectDefaultStateMachineNameOverride,
            ensureRuntime,
            hideError,
            isCanvasEffectivelyTransparent,
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
        elements,
        getCurrentCanvasSizing,
        getCurrentLayoutAlignment,
        getCurrentFileBuffer,
        getCurrentLayoutFit,
        getCurrentRuntime,
        getEditorConfig: getLiveConfig,
    });

    return {
        applyVmControlSnapshot,
        captureVmControlSnapshot,
        getArtboardStateSnapshot,
        getChangedVmControlSnapshot,
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
        syncArtboardStateFromConfig: syncArtboardFromConfig,
        updatePlaybackChips: updatePlaybackIndicators,
        vmControlsController,
    };
}
