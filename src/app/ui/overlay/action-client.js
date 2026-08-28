export function createOverlayActionClient({
    epoch,
    exclusiveActions = [],
    invoke,
    onFailure = () => {},
    onPendingChange = () => {},
    onSuccess = () => {},
    purpose,
    resultTimeoutMs = 60_000,
    windowRef = globalThis.window,
} = {}) {
    const exclusive = new Set(exclusiveActions);
    const exclusiveInFlight = new Set();
    const pending = new Map();
    let nextActionId = 0;

    function settle(actionId, result) {
        const entry = pending.get(actionId);
        if (!entry) return false;
        pending.delete(actionId);
        windowRef?.clearTimeout?.(entry.timer);
        if (exclusive.has(entry.action)) exclusiveInFlight.delete(entry.action);
        onPendingChange({ action: entry.action, pending: false });
        if (result.ok) {
            onSuccess({ action: entry.action, value: entry.value });
            entry.resolve(true);
        } else {
            const error = new Error(result.message || 'RAV did not apply the requested change.');
            onFailure({ action: entry.action, error, value: entry.value });
            entry.resolve(false);
        }
        return true;
    }

    async function emitAction(action, value = null) {
        if (typeof invoke !== 'function' || !epoch || !purpose) return false;
        if (exclusive.has(action) && exclusiveInFlight.has(action)) return false;
        const actionId = `${epoch}-${++nextActionId}`;
        if (exclusive.has(action)) exclusiveInFlight.add(action);
        onPendingChange({ action, pending: true });
        const result = new Promise((resolve) => {
            const timer = windowRef?.setTimeout?.(() => {
                settle(actionId, { ok: false, message: 'RAV did not confirm the control update in time.' });
            }, resultTimeoutMs);
            pending.set(actionId, { action, resolve, timer, value });
        });
        try {
            await invoke('submit_ui_overlay_action', {
                request: { action, actionId, epoch, purpose, value },
            });
        } catch (error) {
            settle(actionId, { ok: false, message: error?.message || String(error) });
        }
        return result;
    }

    emitAction.handleResult = (payload = {}) => {
        if (Number(payload.epoch) !== Number(epoch)) return false;
        return settle(String(payload.actionId || ''), {
            message: payload.message,
            ok: payload.ok === true,
        });
    };
    emitAction.dispose = () => {
        Array.from(pending.keys()).forEach((actionId) => {
            settle(actionId, { ok: false, message: 'The UI overlay was closed.' });
        });
    };
    return emitAction;
}
