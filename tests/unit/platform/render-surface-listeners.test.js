import { createRenderSurfaceActivationLifecycle } from '../../../src/app/platform/render-surface/controller/listeners.js';

describe('render-surface activation receipt attempts', () => {
    it('rejects the discarded child until the retry first frame commits, then restores normal receipts', async () => {
        const lifecycle = createRenderSurfaceActivationLifecycle({
            getProtocolVersion: () => 2,
            matches: () => true,
            protocolVersion: 2,
        });
        const sessionId = 'watchdog-session';
        lifecycle.markCreated(sessionId);
        expect(lifecycle.requireActivationAttempt(sessionId, 1)).toBe(true);
        expect(lifecycle.acceptsActivationAttempt({ payload: { sessionId } })).toBe(false);

        const activate = vi.fn(async () => true);
        await expect(lifecycle.handleLoaded({
            payload: { activationAttempt: 1, firstFrame: true, sessionId },
        }, activate)).resolves.toBe(true);
        expect(activate).toHaveBeenCalledOnce();

        expect(lifecycle.acceptsActivationAttempt({ payload: { sessionId } })).toBe(true);
        lifecycle.dispose();
    });
});
