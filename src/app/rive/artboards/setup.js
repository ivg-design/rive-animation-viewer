export function setupArtboardSwitcher({ elements, documentRef, scheduleSelectionChange, populatePlaybackSelect,
    switchArtboard, switchVmInstance, resetToDefaultArtboard, getCurrentArtboardName,
    isAuthoritativeChildMode, shouldAttachCanonicalStateListener = () => true,
    markCanonicalStateListenerAttached = () => {}, syncStateFromCanonical }) {
    const artboardSelect = elements.artboardSelect;
    const playbackSelect = elements.playbackSelect;
    const viewModelSelect = elements.vmInstanceSelect;
    const resetButton = elements.artboardResetBtn;
    if (!shouldAttachCanonicalStateListener() && isAuthoritativeChildMode()) return;
    if (isAuthoritativeChildMode()) {
        documentRef.addEventListener('rav:render-surface-state', (event) => syncStateFromCanonical(event?.detail));
        markCanonicalStateListenerAttached();
    }
    artboardSelect?.addEventListener('change', () => {
        const nextArtboard = artboardSelect.value;
        scheduleSelectionChange(() => {
            populatePlaybackSelect();
            switchArtboard(nextArtboard, elements.playbackSelect?.value || null);
        });
    });
    playbackSelect?.addEventListener('change', () => {
        const nextPlayback = playbackSelect.value;
        scheduleSelectionChange(() => switchArtboard(elements.artboardSelect?.value || getCurrentArtboardName(), nextPlayback));
    });
    viewModelSelect?.addEventListener('change', () => {
        const nextInstance = viewModelSelect.value;
        scheduleSelectionChange(() => switchVmInstance(nextInstance));
    });
    resetButton?.addEventListener('click', () => resetToDefaultArtboard());
}
