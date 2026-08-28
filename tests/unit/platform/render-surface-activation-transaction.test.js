import { prepareAndActivateRenderSurface } from '../../../src/app/platform/render-surface/activation/transaction.js';

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}

function baseOptions(overrides = {}) {
    return {
        activate: vi.fn(async () => true),
        flushPendingCommands: vi.fn(async () => ({ failed: false, outcomes: [] })),
        getControlSnapshot: () => [],
        getPresentationState: () => ({}),
        isCurrentSession: () => true,
        pendingCommandCount: () => 0,
        sendCommand: vi.fn(async () => ({ applied: true, status: 'applied' })),
        ...overrides,
    };
}

describe('platform/render-surface/activation/transaction', () => {
    it('runs applied callbacks before the prepare-frame paint fence and native reveal', async () => {
        const callbackReceipt = deferred();
        const order = [];
        const options = baseOptions({
            activate: vi.fn(async () => { order.push('native-reveal'); return true; }),
            sendCommand: vi.fn((type) => {
                order.push(type);
                if (type === 'activate-callbacks') return callbackReceipt.promise;
                return Promise.resolve({ applied: true, status: 'applied' });
            }),
        });

        const transaction = prepareAndActivateRenderSurface(options);
        for (let microtask = 0; microtask < 4; microtask += 1) await Promise.resolve();
        expect(order).toEqual(['presentation', 'activate-callbacks']);
        expect(options.activate).not.toHaveBeenCalled();

        callbackReceipt.resolve({ applied: true, status: 'applied' });
        await expect(transaction).resolves.toEqual({ activated: true });
        expect(order).toEqual([
            'presentation',
            'activate-callbacks',
            'prepare-frame',
            'prepare-frame',
            'native-reveal',
        ]);
    });

    it('retains the previous surface until a complete canonical baseline and a post-scan frame are ready', async () => {
        const baseline = deferred();
        const order = [];
        const options = baseOptions({
            activate: vi.fn(async () => { order.push('native-reveal'); return true; }),
            sealActivationBarrier: vi.fn(async () => { order.push('seal-barrier'); return true; }),
            sendCommand: vi.fn(async (type) => {
                order.push(type);
                return { applied: true, status: 'applied' };
            }),
            waitForCanonicalBaseline: vi.fn(() => {
                order.push('canonical-baseline');
                return baseline.promise;
            }),
        });

        const transaction = prepareAndActivateRenderSurface(options);
        await vi.waitFor(() => expect(order).toEqual([
            'presentation',
            'activate-callbacks',
            'prepare-frame',
            'canonical-baseline',
        ]));
        expect(options.activate).not.toHaveBeenCalled();

        baseline.resolve({ ready: true, status: 'ready' });
        await expect(transaction).resolves.toEqual({ activated: true });
        expect(order).toEqual([
            'presentation',
            'activate-callbacks',
            'prepare-frame',
            'canonical-baseline',
            'seal-barrier',
            'prepare-frame',
            'native-reveal',
        ]);
    });

    it('fails closed after canonical baseline when the replacement barrier cannot seal', async () => {
        const options = baseOptions({
            sealActivationBarrier: vi.fn(async () => false),
            waitForCanonicalBaseline: vi.fn(async () => ({ ready: true, status: 'ready' })),
        });

        await expect(prepareAndActivateRenderSurface(options)).resolves.toEqual(expect.objectContaining({
            activated: false,
            message: expect.stringContaining('Unable to seal'),
        }));
        expect(options.activate).not.toHaveBeenCalled();
        expect(options.sendCommand.mock.calls.map(([type]) => type)).toEqual([
            'presentation',
            'activate-callbacks',
            'prepare-frame',
        ]);
    });

    it('rejects activation when the canonical baseline is unavailable', async () => {
        const options = baseOptions({
            waitForCanonicalBaseline: vi.fn(async () => ({ ready: false, status: 'timeout' })),
        });

        await expect(prepareAndActivateRenderSurface(options)).resolves.toEqual(expect.objectContaining({
            activated: false,
            message: expect.stringContaining('Unable to confirm playback controls: timeout'),
        }));
        expect(options.activate).not.toHaveBeenCalled();
        expect(options.sendCommand.mock.calls.map(([type]) => type)).toEqual([
            'presentation',
            'activate-callbacks',
            'prepare-frame',
        ]);
    });

    it('does not transfer callbacks after the candidate is superseded during prepare', async () => {
        const presentationReceipt = deferred();
        let current = true;
        const options = baseOptions({
            isCurrentSession: () => current,
            sendCommand: vi.fn((type) => type === 'presentation'
                ? presentationReceipt.promise
                : Promise.resolve({ applied: true, status: 'applied' })),
        });

        const transaction = prepareAndActivateRenderSurface(options);
        await Promise.resolve();
        current = false;
        presentationReceipt.resolve({ applied: true, status: 'applied' });

        await expect(transaction).resolves.toEqual(expect.objectContaining({
            activated: false,
            message: expect.stringContaining('superseded before callbacks'),
        }));
        expect(options.sendCommand).toHaveBeenCalledTimes(1);
        expect(options.activate).not.toHaveBeenCalled();
    });

    it('skips stale and rejected image entries without poisoning activation or later valid replays', async () => {
        const recorded = [];
        const options = baseOptions({
            recordImageReplayOutcome: vi.fn((entry, result) => recorded.push({ entry, result })),
            replayImageCommands: [
                { entryId: 'stale', payload: { action: 'set-image', kind: 'image', path: 'stale', value: [1] } },
                { entryId: 'rejected', payload: { action: 'set-image', kind: 'image', path: 'rejected', value: [2] } },
                { entryId: 'valid', payload: { action: 'set-image', kind: 'image', path: 'valid', value: [3] } },
            ],
            sendCommand: vi.fn(async (type, payload) => {
                if (type === 'vm-image-set' && payload.path === 'rejected') {
                    return { applied: false, status: 'missing-property' };
                }
                return { applied: true, status: 'applied' };
            }),
            validateImageReplayEntry: vi.fn((entry) => entry.entryId === 'stale'
                ? { status: 'stale-entry', valid: false }
                : { valid: true }),
        });

        await expect(prepareAndActivateRenderSurface(options)).resolves.toEqual({
            activated: true,
            imageReplay: {
                applied: 1,
                attempted: 3,
                skipped: [
                    expect.objectContaining({ entryId: 'stale', path: 'stale', status: 'stale-entry' }),
                    expect.objectContaining({ entryId: 'rejected', path: 'rejected', status: 'missing-property' }),
                ],
            },
        });
        expect(options.sendCommand.mock.calls.filter(([type]) => type === 'vm-image-set')).toEqual([
            ['vm-image-set', expect.objectContaining({ path: 'rejected' })],
            ['vm-image-set', expect.objectContaining({ path: 'valid' })],
        ]);
        expect(recorded).toEqual([
            expect.objectContaining({ entry: expect.objectContaining({ entryId: 'rejected' }) }),
            expect.objectContaining({ entry: expect.objectContaining({ entryId: 'valid' }) }),
        ]);
        expect(options.activate).toHaveBeenCalledOnce();
    });
});
