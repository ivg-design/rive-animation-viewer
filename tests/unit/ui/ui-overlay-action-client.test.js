import { createOverlayActionClient } from '../../../src/app/ui/overlay/action-client.js';

describe('native UI overlay action client', () => {
    it('reports a rejected action so the child can restore canonical state', async () => {
        const failure = new Error('stale overlay');
        const onFailure = vi.fn();
        const emitAction = createOverlayActionClient({
            epoch: 9,
            invoke: vi.fn().mockRejectedValue(failure),
            onFailure,
            purpose: 'export',
        });

        await expect(emitAction('selection-toggle', {
            key: 'vm:rows/*/value:number',
            selected: true,
        })).resolves.toBe(false);
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
            action: 'selection-toggle',
            error: failure,
        }));
    });

    it('acknowledges a delivered action without invoking rollback', async () => {
        const onFailure = vi.fn();
        const onSuccess = vi.fn();
        const invoke = vi.fn().mockResolvedValue(null);
        const emitAction = createOverlayActionClient({
            epoch: 4,
            invoke,
            onFailure,
            onSuccess,
            purpose: 'settings',
        });

        const applied = emitAction('canvas-mode', 'fixed');
        await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
        const request = invoke.mock.calls[0][1].request;
        expect(emitAction.handleResult({
            actionId: request.actionId,
            epoch: 4,
            ok: true,
        })).toBe(true);
        await expect(applied).resolves.toBe(true);
        expect(invoke).toHaveBeenCalledWith('submit_ui_overlay_action', {
            request: {
                action: 'canvas-mode',
                actionId: '4-1',
                epoch: 4,
                purpose: 'settings',
                value: 'fixed',
            },
        });
        expect(onFailure).not.toHaveBeenCalled();
        expect(onSuccess).toHaveBeenCalledOnce();
    });

    it('does not launch a duplicate exclusive action while the first is pending', async () => {
        const invoke = vi.fn().mockResolvedValue(null);
        const emitAction = createOverlayActionClient({
            epoch: 4,
            exclusiveActions: ['export'],
            invoke,
            purpose: 'export',
        });

        const first = emitAction('export');
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
        await expect(emitAction('export')).resolves.toBe(false);
        emitAction.handleResult({ actionId: '4-1', epoch: 4, ok: true });
        await expect(first).resolves.toBe(true);
        expect(invoke).toHaveBeenCalledOnce();
    });
});
