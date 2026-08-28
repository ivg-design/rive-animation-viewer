const COMPLETE_ACTION_COMMAND = 'complete_telemetry_acceptance_action';

function readAction(windowRef) {
    if (windowRef?.__RAV_TELEMETRY_ACCEPTANCE__ !== true) return null;
    const action = windowRef.__RAV_TELEMETRY_ACCEPTANCE_ACTION__;
    return ['acknowledge', 'enable', 'disable'].includes(action) ? action : null;
}

/**
 * This is deliberately called only after the real controller has completed
 * setup. It exercises the same `setEnabled` method that Settings uses and
 * then asks the native acceptance-only driver to write its bounded receipt.
 */
export async function runTelemetryAcceptanceAction({
    controller,
    getTauriInvoker = () => null,
    logEvent = () => {},
    windowRef = globalThis.window,
} = {}) {
    const action = readAction(windowRef);
    if (!action) return { ran: false };
    const enabled = action !== 'disable';
    let succeeded = false;
    try {
        succeeded = action === 'acknowledge'
            ? await controller?.acknowledgeNotice?.() === true
            : await controller?.setEnabled?.(enabled) === true;
    } catch (error) {
        logEvent('ui', 'telemetry-acceptance-action-failed', 'Telemetry acceptance action failed.', error);
    }

    const status = controller?.getStatusSnapshot?.() || {};
    const invoke = getTauriInvoker();
    if (typeof invoke !== 'function') {
        return { action, enabled: Boolean(status.enabled), ran: true, succeeded: false };
    }
    try {
        await invoke(COMPLETE_ACTION_COMMAND, {
            action,
            enabled: Boolean(status.enabled),
            succeeded,
        });
    } catch (error) {
        logEvent('ui', 'telemetry-acceptance-marker-failed', 'Telemetry acceptance completion marker failed.', error);
        return { action, enabled: Boolean(status.enabled), ran: true, succeeded: false };
    }
    return { action, enabled: Boolean(status.enabled), ran: true, succeeded };
}
