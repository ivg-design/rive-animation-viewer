import {
    createRenderSurfaceLoadDeadline,
    isRenderSurfaceLoadDeadlineError,
} from '../../../src/app/platform/render-surface/controller/load-deadline.js';

describe('render-surface load deadline', () => {
    it('uses one absolute deadline across sequential load phases', async () => {
        let now = 1_000;
        const deadline = createRenderSurfaceLoadDeadline({
            now: () => now,
            timeoutMs: 100,
            windowRef: window,
        });

        await expect(deadline.waitFor(Promise.resolve('ready'), 'preflight')).resolves.toBe('ready');
        now += 70;
        const stalled = deadline.waitFor(new Promise(() => {}), 'native creation').catch((error) => error);
        await vi.advanceTimersByTimeAsync(29);
        expect(deadline.hasExpired()).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await stalled).toMatchObject({
            name: 'RenderSurfaceLoadDeadlineError',
            phase: 'native creation',
            timeoutMs: 100,
        });
        deadline.dispose();
    });

    it('handles a late phase rejection after timeout without an unhandled continuation', async () => {
        let rejectOperation;
        const operation = new Promise((resolve, reject) => { rejectOperation = reject; });
        const deadline = createRenderSurfaceLoadDeadline({ timeoutMs: 25, windowRef: window });
        const result = deadline.waitFor(operation, 'context preparation').catch((error) => error);

        await vi.advanceTimersByTimeAsync(25);
        const timeout = await result;
        expect(isRenderSurfaceLoadDeadlineError(timeout)).toBe(true);
        rejectOperation(new Error('late failure'));
        await Promise.resolve();
        deadline.dispose();
    });

    it('observes an operation rejected after the absolute deadline was already exhausted', async () => {
        let now = 1_000;
        let rejectOperation;
        const operation = new Promise((resolve, reject) => { rejectOperation = reject; });
        const deadline = createRenderSurfaceLoadDeadline({
            now: () => now,
            timeoutMs: 25,
            windowRef: window,
        });

        now += 25;
        await expect(deadline.waitFor(operation, 'late phase')).rejects.toMatchObject({
            name: 'RenderSurfaceLoadDeadlineError',
            phase: 'late phase',
        });
        rejectOperation(new Error('late rejection'));
        await Promise.resolve();
        deadline.dispose();
    });

    it('runs best-effort cleanup when an operation fulfills after timing out', async () => {
        let resolveOperation;
        const cleanup = vi.fn(() => Promise.reject(new Error('cleanup failed')));
        const operation = new Promise((resolve) => { resolveOperation = resolve; });
        const deadline = createRenderSurfaceLoadDeadline({ timeoutMs: 25, windowRef: window });
        const result = deadline.waitFor(operation, 'native creation', {
            onLateFulfilled: cleanup,
        }).catch((error) => error);

        await vi.advanceTimersByTimeAsync(25);
        expect(isRenderSurfaceLoadDeadlineError(await result)).toBe(true);
        resolveOperation('created');
        await Promise.resolve();
        expect(cleanup).toHaveBeenCalledWith('created');
        deadline.dispose();
    });
});
