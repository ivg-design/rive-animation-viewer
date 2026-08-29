import { dispatchPlaybackCommand } from '../control-events.js';
import { normalizeLoadErrorMessage } from '../instances/load-settlement.js';
import { buildPlaybackStatusLabel } from '../playback-status.js';
import { buildPlaybackResetContract, normalizeResetViewModelInstanceKey } from '../reset-contract.js';
import { parsePlaybackTarget } from './playback-target.js';
import { resolveImplicitVmInstanceKey } from './selection-state.js';

export function createDefaultArtboardReset({
    documentRef,
    getConfirmedSelection,
    getDefaultArtboardName,
    getDefaultPlaybackKey,
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
}) {
    return async function resetToDefaultArtboard() {
        const defaultArtboardName = getDefaultArtboardName();
        if (!defaultArtboardName) {
            showError('No default artboard. Reload the file.');
            return;
        }
        const playbackTarget = getDefaultPlaybackKey() || null;
        const { type: playbackType, name: playbackName } = parsePlaybackTarget(playbackTarget);
        const retainedVmInstanceKey = normalizeResetViewModelInstanceKey(
            resolveImplicitVmInstanceKey(defaultArtboardName, getSelection(), getConfirmedSelection()),
        );
        const resetParams = buildPlaybackResetContract({
            artboard: defaultArtboardName,
            playbackName,
            playbackType,
            viewModelInstanceKey: retainedVmInstanceKey,
        });
        const commitSelection = ({ syncControls = false } = {}) => {
            setSelection({ artboardName: defaultArtboardName, playbackType, playbackName,
                vmInstanceName: retainedVmInstanceKey });
            confirmSelection();
            if (syncControls) selectionInteractionGuard.request();
            updateSelectionSummary();
            updateInfo(buildPlaybackStatusLabel(getStatusContext(), 'Loaded'));
        };

        logEvent('ui', 'artboard-reset', `Reset to default artboard "${defaultArtboardName}".`);
        if (isAuthoritativeChildMode()) {
            try {
                const result = await requestAuthoritativeCommand('reset', { params: resetParams, snapshot: [] });
                if (!result?.applied) {
                    throw new Error(result?.message || result?.status || 'Playback surface rejected reset.');
                }
                commitSelection({ syncControls: true });
                return result;
            } catch (error) {
                showError(`Failed to reset default artboard: ${normalizeLoadErrorMessage(error)}`);
                return;
            }
        }
        try {
            if (resetRiveInstance(resetParams)) {
                commitSelection();
                dispatchPlaybackCommand(documentRef, 'reset', { params: resetParams, snapshot: [] });
                return;
            }
        } catch (error) {
            showError(`Failed to reset default artboard: ${normalizeLoadErrorMessage(error)}`);
            return;
        }
        setSelection({ ...getSelection(), playbackType: null, playbackName: null });
        await switchArtboard(defaultArtboardName, playbackTarget, {
            viewModelInstanceKey: retainedVmInstanceKey,
        });
    };
}
