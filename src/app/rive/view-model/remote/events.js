const STATE_EVENT = 'rav:render-surface-state';
const COMMAND_RESULT_EVENT = 'rav:render-surface-command-result';
export const RENDER_SURFACE_AUTHORITY_EVENT = 'rav:render-surface-authority-change';

export function attachRemoteControlListeners(documentRef, {
    onAuthorityChange,
    onCanonicalState,
    onCommandResult,
} = {}) {
    if (typeof documentRef?.addEventListener !== 'function') return () => {};
    if (typeof onCanonicalState === 'function') documentRef.addEventListener(STATE_EVENT, onCanonicalState);
    if (typeof onCommandResult === 'function') documentRef.addEventListener(COMMAND_RESULT_EVENT, onCommandResult);
    if (typeof onAuthorityChange === 'function') documentRef.addEventListener(RENDER_SURFACE_AUTHORITY_EVENT, onAuthorityChange);
    return () => {
        if (typeof onCanonicalState === 'function') documentRef.removeEventListener(STATE_EVENT, onCanonicalState);
        if (typeof onCommandResult === 'function') documentRef.removeEventListener(COMMAND_RESULT_EVENT, onCommandResult);
        if (typeof onAuthorityChange === 'function') documentRef.removeEventListener(RENDER_SURFACE_AUTHORITY_EVENT, onAuthorityChange);
    };
}
