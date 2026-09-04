import { populateArtboardSwitcherUi, populatePlaybackSelectUi, populateVmInstanceSelectUi } from './artboards/ui-population.js';
import { createDefaultArtboardReset } from './artboards/default-reset.js';
import { buildPlaybackResetParams, parsePlaybackTarget } from './artboards/playback-target.js';
import { createLatestLoadTransition, waitForRiveLoad } from './artboards/load-transition.js';
import { createLatestSelectionScheduler } from './artboards/selection-scheduler.js';
import { createSelectionInteractionGuard } from './artboards/selection-interaction.js';
import { createArtboardSelectionUi } from './artboards/selection-ui.js';
import { setupArtboardSwitcher as setupArtboardSwitcherUi } from './artboards/setup.js';
import { buildArtboardStateSnapshot, canonicalSelectionMatchesSource, resolveImplicitVmInstanceKey, selectionAfterLoad, selectionFromCanonical,
    selectionFromConfig } from './artboards/selection-state.js';
import { buildPlaybackStatusLabel } from './playback-status.js';
import { normalizeStateMachineSelection } from './default-state-machine.js';
import { normalizeResetViewModelInstanceKey } from './reset-contract.js';
import { normalizeLoadErrorMessage } from './instances/load-settlement.js';
import { AUTO_BOUND_VM_INSTANCE_KEY, buildViewModelInstanceLoadOverrides, loadAndBindViewModelInstance } from './view-model/instances.js';
export { parsePlaybackTarget } from './artboards/playback-target.js';
export function createArtboardSwitcherController({
    elements,
    callbacks = {},
    documentRef = globalThis.document,
    getCurrentFileName = () => null,
    getCurrentFileUrl = () => null,
    getCurrentSourceScope = null,
    getCanonicalSourceScope = null,
    getRiveInstance = () => null,
    isAuthoritativeChildMode = () => false,
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
} = {}) {
    const {
        initLucideIcons = () => {},
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        requestAuthoritativeCommand = async () => ({ applied: false, status: 'unavailable' }),
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
    let canonicalStateListenerAttached = false;
    const scheduleSelectionChange = createLatestSelectionScheduler(setTimeoutFn);
    const loadTransition = createLatestLoadTransition();
    // A staged child is built asynchronously while the old child can still
    // publish canonical ticks. Keep the requested selection authoritative
    // until its load either commits or rolls back; otherwise an old tick can
    // leak back into the export context used to build the replacement child.
    let requestedSelectionTransitionId = null;
    let confirmedSelection = getSelection();

    function hasRequestedSelectionInFlight() {
        return requestedSelectionTransitionId !== null;
    }

    function beginRequestedSelection() {
        const transitionId = loadTransition.begin();
        requestedSelectionTransitionId = transitionId;
        return transitionId;
    }
    function settleRequestedSelection(transitionId) {
        if (requestedSelectionTransitionId === transitionId) {
            requestedSelectionTransitionId = null;
            return true;
        }
        return false;
    }
    function getSelection() {
        return {
            artboardName: currentArtboardName,
            playbackType: currentPlaybackType,
            playbackName: currentPlaybackName,
            vmInstanceName: currentVmInstanceName,
        };
    }
    function setSelection(selection) {
        currentArtboardName = selection.artboardName;
        currentPlaybackType = selection.playbackType;
        currentPlaybackName = selection.playbackName;
        currentVmInstanceName = selection.vmInstanceName;
    }
    function confirmSelection() {
        confirmedSelection = getSelection();
    }
    function restoreConfirmedSelection() {
        setSelection(confirmedSelection);
        selectionInteractionGuard.request();
    }
    const { getStatusContext, syncSelectionControls, updateSelectionSummary } = createArtboardSelectionUi({
        elements,
        getRiveInstance,
        getSelection,
        populatePlaybackSelect,
        populateVmInstanceSelect,
    });
    const selectionInteractionGuard = createSelectionInteractionGuard({
        documentRef,
        elements,
        onSyncRequested: syncSelectionControls,
        scheduleFn: setTimeoutFn,
    });
    function resetForNewFile() {
        requestedSelectionTransitionId = null;
        currentArtboardName = null;
        currentPlaybackType = null;
        currentPlaybackName = null;
        currentVmInstanceName = null;
        defaultArtboardName = null;
        defaultPlaybackKey = null;
        fileContentsCache = null;
        if (!hasRequestedSelectionInFlight()) confirmSelection();
        updateSelectionSummary();
    }

    function syncStateFromConfig({
        artboard = null,
        configuredStateMachines = [],
        animations = null,
        hasConfiguredAnimation = false,
    } = {}) {
        const selection = selectionFromConfig({ artboard, configuredStateMachines, animations, hasConfiguredAnimation });
        currentArtboardName = selection.artboardName || currentArtboardName;
        currentPlaybackType = selection.playbackType || currentPlaybackType;
        currentPlaybackName = selection.playbackName || currentPlaybackName;
        if (!hasRequestedSelectionInFlight()) confirmSelection();
    }

    function syncStateAfterLoad(riveInstance, config = {}) {
        const selection = selectionAfterLoad(riveInstance, config);
        currentArtboardName = selection.artboardName || currentArtboardName;
        currentPlaybackType = selection.playbackType;
        currentPlaybackName = selection.playbackName;
        // A candidate hidden instance reports its configured selection before
        // the visible child confirms activation. Do not promote that staged
        // selection to the rollback baseline: a later binding/activation
        // rejection must restore the last visible child, not the candidate.
        if (!hasRequestedSelectionInFlight()) confirmSelection();
        updateSelectionSummary();
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

    function syncStateFromCanonical(state) {
        if (!state || !isAuthoritativeChildMode()) return false;
        // A file load resets requestedSelectionTransitionId while the old child
        // is still active. Reject its ticks both before inspection is ready and
        // after it resolves the replacement file's identity.
        if ((getCurrentSourceScope || getCanonicalSourceScope) && !canonicalSelectionMatchesSource(
            state, getCurrentSourceScope?.(), getCanonicalSourceScope?.(),
        )) return false;
        // The active child stays authoritative only until a replacement has
        // been requested. Its ticks must not replace the target artboard,
        // playback, or explicit ViewModel selection while the new render
        // context is being constructed.
        if (hasRequestedSelectionInFlight()) return false;
        const selection = selectionFromCanonical(state, getSelection());
        const selectionChanged = selection.artboardName !== currentArtboardName
            || selection.playbackType !== currentPlaybackType
            || selection.playbackName !== currentPlaybackName
            || selection.vmInstanceName !== currentVmInstanceName;
        currentArtboardName = selection.artboardName;
        currentPlaybackType = selection.playbackType;
        currentPlaybackName = selection.playbackName;
        currentVmInstanceName = selection.vmInstanceName;
        confirmSelection();
        // Canonical value deltas arrive continuously from the visible child.
        // Rebuilding native <select> options for an unchanged selection closes
        // its open popup in WebKit, so only reconcile selection controls when
        // the selection itself actually changed.
        if (selectionChanged) selectionInteractionGuard.request();
        updateSelectionSummary();
        return true;
    }

    async function switchArtboard(artboardName, playbackTarget, options = {}) {
        if (!getCurrentFileUrl() || !getCurrentFileName()) {
            return;
        }
        // An explicit instance key belongs to the current artboard's default
        // ViewModel definition. Retain it for playback changes on that same
        // artboard, but never carry it implicitly into a different artboard:
        // the same name or runtime-list index can be absent or mean something
        // else there. Callers may still provide an explicit target-artboard
        // override; null deliberately selects the runtime auto-bound instance.
        const hasVmInstanceOverride = Object.prototype.hasOwnProperty.call(
            options || {},
            'viewModelInstanceKey',
        );
        const viewModelInstanceKey = hasVmInstanceOverride
            ? options.viewModelInstanceKey
            : resolveImplicitVmInstanceKey(artboardName, getSelection(), confirmedSelection);
        const { type: playbackType, name: playbackName } = parsePlaybackTarget(playbackTarget);
        logEvent(
            'ui',
            'artboard-switch',
            `Switching to artboard "${artboardName}" ${playbackType ? `with ${playbackType} "${playbackName}"` : '(auto)'}.`,
        );
        updateInfo(`Switching to "${artboardName}"...`);
        const transitionId = beginRequestedSelection();
        currentArtboardName = artboardName;
        currentPlaybackType = playbackType;
        currentPlaybackName = playbackName;
        currentVmInstanceName = normalizeResetViewModelInstanceKey(viewModelInstanceKey);

        const overrides = buildPlaybackResetParams(artboardName, playbackType, playbackName);
        if (currentVmInstanceName !== null) {
            overrides.autoBind = false;
        }
        try {
            await waitForRiveLoad(loadRiveAnimation, getCurrentFileUrl(), getCurrentFileName(), {
                forceAutoplay: true,
                configOverrides: overrides,
            });
            if (!loadTransition.isCurrent(transitionId)) return;
            settleRequestedSelection(transitionId);
            confirmSelection();
            updateSelectionSummary();
            updateInfo(buildPlaybackStatusLabel(getStatusContext(), 'Loaded'));
        } catch (error) {
            if (!loadTransition.isCurrent(transitionId)) return;
            settleRequestedSelection(transitionId);
            restoreConfirmedSelection();
            updateSelectionSummary();
            showError(`Failed to switch artboard: ${normalizeLoadErrorMessage(error)}`);
        }
    }

    async function switchVmInstance(instanceKey) {
        if (!getCurrentFileUrl() || !getCurrentFileName()
            || instanceKey === null || typeof instanceKey === 'undefined' || instanceKey === '') {
            return;
        }
        if (instanceKey === AUTO_BOUND_VM_INSTANCE_KEY) {
            const playbackTarget = currentPlaybackName
                ? `${currentPlaybackType === 'animation' ? 'anim' : 'sm'}:${currentPlaybackName}`
                : null;
            await switchArtboard(currentArtboardName, playbackTarget, { viewModelInstanceKey: null });
            return;
        }

        const transitionId = beginRequestedSelection();

        // Retain the explicit request while a replacement child is being
        // prepared. This includes the valid numeric key 0; only the separate
        // Auto option maps to null.
        currentVmInstanceName = instanceKey;

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
                    if (!loadTransition.isCurrent(transitionId)) return;
                    currentVmInstanceName = instanceKey;
                    logEvent(
                        'ui',
                        'vm-instance-switch',
                        `Bound instance "${instanceKey}" from ${definition?.name || 'ViewModel'}`,
                    );
                },
            });
            if (!loadTransition.isCurrent(transitionId)) return;
            settleRequestedSelection(transitionId);
            confirmSelection();
            updateSelectionSummary();
            updateInfo(buildPlaybackStatusLabel(getStatusContext(), 'Loaded'));
        } catch (error) {
            if (!loadTransition.isCurrent(transitionId)) return;
            settleRequestedSelection(transitionId);
            restoreConfirmedSelection();
            showError(`Failed to switch ViewModel instance: ${normalizeLoadErrorMessage(error)}`);
        }
    }

    function setupArtboardSwitcher() {
        selectionInteractionGuard.setup();
        setupArtboardSwitcherUi({ documentRef, elements, getCurrentArtboardName: () => currentArtboardName,
            isAuthoritativeChildMode, populatePlaybackSelect, resetToDefaultArtboard,
            scheduleSelectionChange, shouldAttachCanonicalStateListener: () => !canonicalStateListenerAttached,
            markCanonicalStateListenerAttached: () => { canonicalStateListenerAttached = true; },
            switchArtboard, switchVmInstance, syncStateFromCanonical });
    }
    function getStateSnapshot() {
        return buildArtboardStateSnapshot({
            contents: fileContentsCache,
            currentArtboard: currentArtboardName,
            currentPlaybackName,
            currentPlaybackType,
            currentVmInstanceName,
            defaultArtboard: defaultArtboardName,
            defaultPlaybackKey,
        });
    }

    const resetToDefaultArtboard = createDefaultArtboardReset({
        documentRef,
        getConfirmedSelection: () => confirmedSelection,
        getDefaultArtboardName: () => defaultArtboardName,
        getDefaultPlaybackKey: () => defaultPlaybackKey,
        getSelection,
        getStatusContext,
        isAuthoritativeChildMode,
        logEvent,
        requestAuthoritativeCommand,
        resetRiveInstance,
        selectionInteractionGuard,
        setSelection,
        showError,
        switchArtboard,
        updateInfo,
        updateSelectionSummary,
        confirmSelection,
    });

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
        syncStateFromCanonical,
        syncStateFromConfig,
    };
}
