import {
    buildArtboardSelectionSummary,
    buildPlaybackContext,
} from '../playback-status.js';

export function createArtboardSelectionUi({
    elements,
    getRiveInstance,
    getSelection,
    populatePlaybackSelect,
    populateVmInstanceSelect,
} = {}) {
    function getStatusContext() {
        const selection = getSelection();
        return buildPlaybackContext({
            playbackState: {
                currentArtboard: selection.artboardName,
                currentPlaybackName: selection.playbackName,
                currentPlaybackType: selection.playbackType,
                currentVmInstanceName: selection.vmInstanceName,
            },
            riveInstance: getRiveInstance(),
        });
    }

    function updateSelectionSummary() {
        const summary = elements.artboardSelectionSummary;
        const selection = getSelection();
        if (!summary) return;
        if (!getRiveInstance() || !selection.artboardName) {
            summary.textContent = '';
            summary.hidden = true;
            return;
        }
        summary.textContent = buildArtboardSelectionSummary(getStatusContext());
        summary.hidden = false;
    }

    function syncSelectionControls() {
        const selection = getSelection();
        if (elements.artboardSelect && selection.artboardName) {
            elements.artboardSelect.value = selection.artboardName;
        }
        populatePlaybackSelect();
        const playbackKey = selection.playbackName
            ? `${selection.playbackType === 'animation' ? 'anim' : 'sm'}:${selection.playbackName}`
            : '';
        if (elements.playbackSelect && playbackKey) elements.playbackSelect.value = playbackKey;
        populateVmInstanceSelect();
    }

    return { getStatusContext, syncSelectionControls, updateSelectionSummary };
}
