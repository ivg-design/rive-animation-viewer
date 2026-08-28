import { runTelemetryAcceptanceAction } from '../../../src/app/platform/install-counter/acceptance-driver.js';

describe('telemetry acceptance action driver', () => {
    it('does nothing outside telemetry acceptance', async () => {
        const setEnabled = vi.fn();
        const invoke = vi.fn();
        await expect(runTelemetryAcceptanceAction({
            controller: { setEnabled },
            getTauriInvoker: () => invoke,
            windowRef: {},
        })).resolves.toEqual({ ran: false });
        expect(setEnabled).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
    });

    it('uses the real Settings controller path exactly once and writes a receipt', async () => {
        const setEnabled = vi.fn(async () => true);
        const invoke = vi.fn(async () => undefined);
        const result = await runTelemetryAcceptanceAction({
            controller: {
                getStatusSnapshot: () => ({ enabled: true }),
                setEnabled,
            },
            getTauriInvoker: () => invoke,
            windowRef: {
                __RAV_TELEMETRY_ACCEPTANCE__: true,
                __RAV_TELEMETRY_ACCEPTANCE_ACTION__: 'enable',
            },
        });
        expect(setEnabled).toHaveBeenCalledTimes(1);
        expect(setEnabled).toHaveBeenCalledWith(true);
        expect(invoke).toHaveBeenCalledWith('complete_telemetry_acceptance_action', {
            action: 'enable',
            enabled: true,
            succeeded: true,
        });
        expect(result).toEqual({ action: 'enable', enabled: true, ran: true, succeeded: true });
    });

    it('acknowledges the real first-run notice without foregrounding the acceptance app', async () => {
        const acknowledgeNotice = vi.fn(async () => true);
        const setEnabled = vi.fn();
        const invoke = vi.fn(async () => undefined);
        const result = await runTelemetryAcceptanceAction({
            controller: {
                acknowledgeNotice,
                getStatusSnapshot: () => ({ enabled: true }),
                setEnabled,
            },
            getTauriInvoker: () => invoke,
            windowRef: {
                __RAV_TELEMETRY_ACCEPTANCE__: true,
                __RAV_TELEMETRY_ACCEPTANCE_ACTION__: 'acknowledge',
            },
        });
        expect(acknowledgeNotice).toHaveBeenCalledTimes(1);
        expect(setEnabled).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledWith('complete_telemetry_acceptance_action', {
            action: 'acknowledge',
            enabled: true,
            succeeded: true,
        });
        expect(result).toEqual({ action: 'acknowledge', enabled: true, ran: true, succeeded: true });
    });

    it('records a bounded failed result when the Settings path rejects', async () => {
        const setEnabled = vi.fn(async () => false);
        const invoke = vi.fn(async () => undefined);
        await expect(runTelemetryAcceptanceAction({
            controller: {
                getStatusSnapshot: () => ({ enabled: true }),
                setEnabled,
            },
            getTauriInvoker: () => invoke,
            windowRef: {
                __RAV_TELEMETRY_ACCEPTANCE__: true,
                __RAV_TELEMETRY_ACCEPTANCE_ACTION__: 'disable',
            },
        })).resolves.toEqual({ action: 'disable', enabled: true, ran: true, succeeded: false });
        expect(setEnabled).toHaveBeenCalledTimes(1);
        expect(setEnabled).toHaveBeenCalledWith(false);
        expect(invoke).toHaveBeenCalledWith('complete_telemetry_acceptance_action', {
            action: 'disable',
            enabled: true,
            succeeded: false,
        });
    });
});
