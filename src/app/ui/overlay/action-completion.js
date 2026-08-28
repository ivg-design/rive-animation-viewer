export async function completeUiOverlayAction(getTauriInvoker, payload, ok, error = null) {
    if (!payload?.actionId) return true;
    const rawMessage = ok ? '' : (error?.message || String(error || 'RAV did not apply the requested change.'));
    try {
        await getTauriInvoker()?.('complete_ui_overlay_action', {
            actionId: String(payload.actionId),
            epoch: Number(payload.epoch),
            message: rawMessage.slice(0, 512),
            ok: Boolean(ok),
        });
        return true;
    } catch {
        return false;
    }
}
