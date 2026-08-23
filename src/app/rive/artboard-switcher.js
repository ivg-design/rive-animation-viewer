import {
    populateArtboardSwitcherUi,
    populatePlaybackSelectUi,
    populateVmInstanceSelectUi,
} from './artboards/ui-population.js';
import { parsePlaybackTarget } from './artboards/playback-target.js';
import { createLatestSelectionScheduler } from './artboards/selection-scheduler.js';
import {
    buildArtboardSelectionSummary,
    buildPlaybackContext,
    buildPlaybackStatusLabel,
} from './playback-status.js';
import { normalizeStateMachineSelection } from './default-state-machine.js';
import { dispatchPlaybackCommand } from './control-events.js';
import {
    AUTO_BOUND_VM_INSTANCE_KEY,
    buildViewModelInstanceLoadOverrides,
    loadAndBindViewModelInstance,
} from './view-model/instances.js';

export { parsePlaybackTarget } from './artboards/playback-target.js';

export function createArtboardSwitcherController({
    elements,
    callbacks = {},
    documentRef = globalThis.document,
    getCurrentFileName = () => null,
    getCurrentFileUrl = () => null,
    getRiveInstance = () => null,
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
} = {}) {
    const {
        initLucideIcons = () => {},
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        resetRiveInstance = () => false,
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    let currentArtboardName = null;
    let currentPlaybackType = null;
    let currentPlaybackName = null;
    let currentVmInstanceName = null;
    let defaultArtboardName = null;
    let defaultPlaybackKey = null;
    let fileContentsCache = null;
    const scheduleSelectionChange = createLatestSelectionScheduler(setTimeoutFn);

    function resetForNewFile() {
        currentArtboardName = null;
        currentPlaybackType = null;
        currentPlaybackName = null;
        currentVmInstanceName = null;
        defaultArtboardName = null;
        defaultPlaybackKey = null;
        fileContentsCache = null;
        updateSelectionSummary();
    }

    function syncStateFromConfig({
        artboard = null,
        configuredStateMachines = [],
        animations = null,
        hasConfiguredAnimation = false,
    } = {}) {
        if (artboard) {
            currentArtboardName = artboard;
        }
        if (configuredStateMachines.length) {
            currentPlaybackType = 'stateMachine';
            currentPlaybackName = configuredStateMachines[0];
        } else if (hasConfiguredAnimation) {
            currentPlaybackType = 'animation';
            currentPlaybackName = Array.isArray(animations) ? animations[0] : animations;
        }
    }

    function syncStateAfterLoad(riveInstance, config = {}) {
        currentArtboardName = riveInstance?.artboard?.name || currentArtboardName || config.artboard || null;
        const configuredStateMachines = normalizeStateMachineSelection(config.stateMachines);
        const configuredAnimations = normalizeStateMachineSelection(config.animations);
        const playingStateMachines = normalizeStateMachineSelection(riveInstance?.playingStateMachineNames);
        const playingAnimations = normalizeStateMachineSelection(riveInstance?.playingAnimationNames);
        if (playingStateMachines.length) {
            currentPlaybackType = 'stateMachine';
            currentPlaybackName = playingStateMachines[0];
        } else if (playingAnimations.length) {
            currentPlaybackType = 'animation';
            currentPlaybackName = playingAnimations[0];
        } else if (configuredStateMachines.length) {
            currentPlaybackType = 'stateMachine';
            currentPlaybackName = configuredStateMachines[0];
        } else if (configuredAnimations.length) {
            currentPlaybackType = 'animation';
            currentPlaybackName = configuredAnimations[0];
        } else {
            currentPlaybackType = null;
            currentPlaybackName = null;
        }
        updateSelectionSummary();
    }

    function getStatusContext() {
        return buildPlaybackContext({
            playbackState: {
                currentArtboard: currentArtboardName,
                currentPlaybackName,
                currentPlaybackType,
                currentVmInstanceName,
            },
            riveInstance: getRiveInstance(),
        });
    }

    function updateSelectionSummary() {
        const summaryElement = elements.artboardSelectionSummary;
        if (!summaryElement) {
            return;
        }

        const riveInstance = getRiveInstance();
        if (!riveInstance || !currentArtboardName) {
            summaryElement.textContent = '';
            summaryElement.hidden = true;
            return;
        }

        summaryElement.textContent = buildArtboardSelectionSummary(getStatusContext());
        summaryElement.hidden = false;
    }

    function populateArtboardSwitcher() {
        const nextState = populateArtboardSwitcherUi({
            currentArtboardName,
            defaultArtboardName,
            elements,
            fileContentsCache,
            getRiveInstance,
            initLucideIcons,
        });
        defaultArtboardName = nextState.defaultArtboardName;
        fileContentsCache = nextState.fileContentsCache;
        populatePlaybackSelect();
        populateVmInstanceSelect();
        updateSelectionSummary();
    }

    function populatePlaybackSelect() {
        ({ defaultPlaybackKey } = populatePlaybackSelectUi({
            currentArtboardName,
            currentPlaybackName,
            currentPlaybackType,
            defaultPlaybackKey,
            documentRef,
            elements,
            fileContentsCache,
        }));
    }

    function populateVmInstanceSelect() {
        populateVmInstanceSelectUi({
            documentRef,
            elements,
            getRiveInstance,
            selectedInstanceKey: currentVmInstanceName,
        });
        updateSelectionSummary();
    }

    async function switchArtboard(artboardName, playbackTarget) {
        if (!getCurrentFileUrl() || !getCurrentFileName()) {
            return;
        }

        const { type: playbackType, name: playbackName } = parsePlaybackTarget(playbackTarget);
        logEvent(
            'ui',
            'artboard-switch',
            `Switching to artboard "${artboardName}" ${playbackType ? `with ${playbackType} "${playbackName}"` : '(auto)'}.`,
        );
        updateInfo(`Switching to "${artboardName}"...`);

        const previousState = {
            artboardName: currentArtboardName,
            playbackType: currentPlaybackType,
            playbackName: currentPlaybackName,
            vmInstanceName: currentVmInstanceName,
        };

        currentArtboardName = artboardName;
        currentPlaybackType = playbackType;
        currentPlaybackName = playbackName;
        currentVmInstanceName = null;

        const overrides = { artboard: artboardName, autoplay: true, autoBind: true };
        if (playbackType === 'stateMachine' && playbackName) {
            overrides.stateMachines = playbackName;
            delete overrides.animations;
        } else if (playbackType === 'animation' && playbackName) {
            overrides.animations = playbackName;
            delete overrides.stateMachines;
        }

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
                        reject(error || new Error('Switch failed'));
                    }
                };

                loadRiveAnimation(getCurrentFileUrl(), getCurrentFileName(), {
                    forceAutoplay: true,
                    configOverrides: overrides,
                    onLoaded: resolveOnce,
                    onLoadError: rejectOnce,
                }).catch(rejectOnce);
            });
            updateSelectionSummary();
            updateInfo(buildPlaybackStatusLabel(getStatusContext(), 'Loaded'));
        } catch (error) {
            currentArtboardName = previousState.artboardName;
            currentPlaybackType = previousState.playbackType;
            currentPlaybackName = previousState.playbackName;
            currentVmInstanceName = previousState.vmInstanceName;
            updateSelectionSummary();
            showError(`Failed to switch artboard: ${error?.message || error}`);
        }
    }

    function resetToDefaultArtboard() {
        if (!defaultArtboardName) {
            showError('No default artboard. Reload the file.');
            return;
        }

        const playbackTarget = defaultPlaybackKey || null;
        const { type: playbackType, name: playbackName } = parsePlaybackTarget(playbackTarget);
        const resetParams = {
            artboard: defaultArtboardName,
            animations: playbackType === 'animation' ? playbackName || undefined : undefined,
            stateMachines: playbackType === 'stateMachine' ? playbackName || undefined : undefined,
            autoplay: true,
            autoBind: true,
        };
        logEvent('ui', 'artboard-reset', `Reset to default artboard "${defaultArtboardName}".`);
        try {
            if (resetRiveInstance(resetParams)) {
                currentArtboardName = defaultArtboardName;
                currentPlaybackType = playbackType;
                currentPlaybackName = playbackName;
                currentVmInstanceName = null;
                dispatchPlaybackCommand(documentRef, 'reset', {
                    params: resetParams,
                    snapshot: [],
                });
                updateSelectionSummary();
                updateInfo(buildPlaybackStatusLabel(getStatusContext(), 'Loaded'));
                return;
            }
        } catch (error) {
            showError(`Failed to reset default artboard: ${error?.message || error}`);
            return;
        }

        currentPlaybackType = null;
        currentPlaybackName = null;
        switchArtboard(defaultArtboardName, playbackTarget);
    }

    async function switchVmInstance(instanceKey) {
        if (!getCurrentFileUrl() || !getCurrentFileName() || !instanceKey) {
            return;
        }

        if (instanceKey === AUTO_BOUND_VM_INSTANCE_KEY) {
            const playbackTarget = currentPlaybackName
                ? `${currentPlaybackType === 'animation' ? 'anim' : 'sm'}:${currentPlaybackName}`
                : null;
            await switchArtboard(currentArtboardName, playbackTarget);
            return;
        }

        const previousVmInstanceName = currentVmInstanceName;

        const overrides = buildViewModelInstanceLoadOverrides({
            artboardName: currentArtboardName,
            playbackName: currentPlaybackName,
            playbackType: currentPlaybackType,
        });

        updateInfo(`Switching to ViewModel instance "${instanceKey}"...`);

        try {
            await loadAndBindViewModelInstance({
                configOverrides: overrides,
                fileName: getCurrentFileName(),
                fileUrl: getCurrentFileUrl(),
                getRiveInstance,
                instanceKey,
                loadRiveAnimation,
                onBound: (definition) => {
                    currentVmInstanceName = instanceKey;
                    logEvent(
                        'ui',
                        'vm-instance-switch',
                        `Bound instance "${instanceKey}" from ${definition?.name || 'ViewModel'}`,
                    );
                },
            });
            updateSelectionSummary();
            updateInfo(buildPlaybackStatusLabel(getStatusContext(), 'Loaded'));
        } catch (error) {
            currentVmInstanceName = previousVmInstanceName;
            populateVmInstanceSelect();
            showError(`Failed to switch ViewModel instance: ${error?.message || error}`);
        }
    }

    function setupArtboardSwitcher() {
        const artboardSelect = elements.artboardSelect;
        const playbackSelect = elements.playbackSelect;
        const viewModelSelect = elements.vmInstanceSelect;
        const resetButton = elements.artboardResetBtn;

        if (artboardSelect) {
            artboardSelect.addEventListener('change', () => {
                const nextArtboard = artboardSelect.value;
                scheduleSelectionChange(() => {
                    populatePlaybackSelect();
                    const playbackTarget = elements.playbackSelect?.value || null;
                    switchArtboard(nextArtboard, playbackTarget);
                });
            });
        }

        if (playbackSelect) {
            playbackSelect.addEventListener('change', () => {
                const nextPlayback = playbackSelect.value;
                scheduleSelectionChange(() => {
                    const artboard = elements.artboardSelect?.value || currentArtboardName;
                    switchArtboard(artboard, nextPlayback);
                });
            });
        }

        if (viewModelSelect) {
            viewModelSelect.addEventListener('change', () => {
                const nextInstance = viewModelSelect.value;
                scheduleSelectionChange(() => {
                    switchVmInstance(nextInstance);
                });
            });
        }

        if (resetButton) {
            resetButton.addEventListener('click', () => {
                resetToDefaultArtboard();
            });
        }
    }

    function getStateSnapshot() {
        return {
            contents: fileContentsCache,
            currentArtboard: currentArtboardName,
            currentPlaybackName,
            currentPlaybackType,
            currentVmInstanceName,
            defaultArtboard: defaultArtboardName,
            defaultPlaybackKey,
        };
    }

    return {
        getStateSnapshot,
        parsePlaybackTarget,
        populateArtboardSwitcher,
        populatePlaybackSelect,
        populateVmInstanceSelect,
        resetForNewFile,
        resetToDefaultArtboard,
        setupArtboardSwitcher,
        switchArtboard,
        switchVmInstance,
        syncStateAfterLoad,
        syncStateFromConfig,
    };
}
