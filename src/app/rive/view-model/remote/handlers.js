export function createVmRemoteEventHandlers({
    isAuthoritativeChildMode,
    remoteControls,
    getTopologySignature,
    getCurrentTopologySignature,
    renderVmInputControls,
    syncRemoteControlChanges,
    syncVmControlBindings,
    showError,
    setRemoteAuthority,
}) {
    function handleRemoteCanonicalState(event) {
        if (!isAuthoritativeChildMode) return;
        remoteControls.acceptCanonicalState(event?.detail);
        const nextSignature = getCurrentTopologySignature();
        if (nextSignature !== getTopologySignature()) {
            renderVmInputControls();
            return;
        }
        if (Array.isArray(event?.detail?.controlChanges)) {
            syncRemoteControlChanges(event.detail.controlChanges);
            return;
        }
        // Protocol-v2 compatibility: early children sent complete snapshots
        // without an explicit delta list.
        syncVmControlBindings(false);
    }
    function handleRemoteCommandResult(event) {
        if (!isAuthoritativeChildMode || event?.detail?.applied !== false) return;
        const commandType = String(event?.detail?.commandType || '');
        if (!commandType.startsWith('vm-') && !commandType.startsWith('sm-')) return;
        syncVmControlBindings(true);
        const reason = event?.detail?.message || event?.detail?.status || 'unknown error';
        showError(`Playback control change was not applied: ${reason}`);
    }
    function handleRemoteAuthorityChange(event) {
        if (!isAuthoritativeChildMode) return;
        setRemoteAuthority(event?.detail && typeof event.detail === 'object' ? event.detail : null);
        syncVmControlBindings(true);
    }
    return { handleRemoteAuthorityChange, handleRemoteCanonicalState, handleRemoteCommandResult };
}
