import {
    populateArtboardSwitcherUi,
    populatePlaybackSelectUi,
    populateVmInstanceSelectUi,
} from './artboards/ui-population.js';
import {
    buildArtboardSelectionSummary,
    buildPlaybackContext,
    buildPlaybackStatusLabel,
} from './playback-status.js';

export function parsePlaybackTarget(target) {
    if (!target) {
        return { type: null, name: null };
    }
    if (target.startsWith('sm:')) {
        return { type: 'stateMachine', name: target.slice(3) };
    }
    if (target.startsWith('anim:')) {
        return { type: 'animation', name: target.slice(5) };
    }
    return { type: 'stateMachine', name: target };
}

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
        renderVmInputControls = () => {},
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
    let pendingSelectionTask = null;

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

    function scheduleSelectionChange(callback) {
        if (pendingSelectionTask) {
            pendingSelectionTask.cancelled = true;
        }
        const task = { cancelled: false };
        pendingSelectionTask = task;
        const run = () => {
            if (task.cancelled) {
                return;
            }
            pendingSelectionTask = null;
            callback();
        };
        if (typeof setTimeoutFn === 'function') {
            setTimeoutFn(run, 0);
            return;
        }
        run();
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
        });
        currentVmInstanceName = elements.vmInstanceSelect?.value || null;
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

        currentPlaybackType = null;
        currentPlaybackName = null;

        const playbackTarget = defaultPlaybackKey || null;
        logEvent('ui', 'artboard-reset', `Reset to default artboard "${defaultArtboardName}".`);
        switchArtboard(defaultArtboardName, playbackTarget);
    }

    function switchVmInstance(instanceKey) {
        const riveInstance = getRiveInstance();
        if (!riveInstance || !instanceKey) {
            return;
        }

        try {
            const viewModelDefinition = typeof riveInstance.defaultViewModel === 'function'
                ? riveInstance.defaultViewModel()
                : null;
            if (!viewModelDefinition) {
                console.warn('[rive-viewer] No ViewModel definition for current artboard');
                return;
            }

            let newInstance = null;
            if (typeof viewModelDefinition.instanceByName === 'function') {
                try {
                    newInstance = viewModelDefinition.instanceByName(instanceKey);
                } catch {
                    /* not found */
                }
            }
            if (!newInstance) {
                const index = Number.parseInt(instanceKey, 10);
                if (!Number.isNaN(index) && typeof viewModelDefinition.instanceByIndex === 'function') {
                    newInstance = viewModelDefinition.instanceByIndex(index);
                }
            }

            if (!newInstance) {
                console.warn('[rive-viewer] VM instance not found:', instanceKey);
                return;
            }

            if (typeof riveInstance.bindViewModelInstance === 'function') {
                riveInstance.bindViewModelInstance(newInstance);
                currentVmInstanceName = instanceKey;
                renderVmInputControls();
                updateSelectionSummary();
                updateInfo(buildPlaybackStatusLabel(getStatusContext(), 'Loaded'));
                logEvent(
                    'ui',
                    'vm-instance-switch',
                    `Bound instance "${instanceKey}" from ${viewModelDefinition.name || 'ViewModel'}`,
                );
                return;
            }

            console.warn('[rive-viewer] bindViewModelInstance not available on this runtime version');
        } catch (error) {
            console.warn('[rive-viewer] VM instance switch failed:', error);
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
