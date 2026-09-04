import { createRenderSurfaceActivationCoordinator as createCoordinator } from '../../../src/app/platform/render-surface/activation/coordinator.js';

function createRenderSurfaceActivationCoordinator(options) {
    const coordinator = createCoordinator(options);
    const scope = { sourceIdentity: 'same-file', runtimeKey: 'webgl2@2.42.0', artboardKey: 'Main', vmInstanceKey: null };
    coordinator.setSourceScope(options.getActiveSessionId?.() || 'active', scope);
    coordinator.setSourceScope(options.getStagedSessionId?.() || 'staged', scope);
    return coordinator;
}

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}

async function withRealTimers(callback) {
    vi.useRealTimers();
    try {
        return await callback();
    } finally {
        vi.useFakeTimers();
    }
}

describe('platform/render-surface/activation/coordinator', () => {
    it('drains a delayed direct active-surface acknowledgement before activation and replays it', async () => {
        let activeSessionId = 'active';
        const activeAcknowledgement = deferred();
        const requests = [];
        const protocol = {
            requestCommand: vi.fn((type, payload, { targetSessionId }) => {
                requests.push({ payload, targetSessionId, type });
                if (targetSessionId === 'active' && type === 'vm-set') {
                    return activeAcknowledgement.promise;
                }
                return Promise.resolve({ applied: true, status: 'applied' });
            }),
        };
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => activeSessionId,
            getStagedSessionId: () => 'staged',
            isSessionAddressable: () => true,
            protocol,
        });
        coordinator.beginStage('staged');

        const direct = coordinator.requestCommand('vm-set', {
            kind: 'boolean', path: 'enabled', value: true,
        });
        await Promise.resolve();
        expect(requests).toEqual([expect.objectContaining({ targetSessionId: 'active', type: 'vm-set' })]);

        let barrierSettled = false;
        const barrier = coordinator.beginBarrier('staged').then((result) => {
            barrierSettled = true;
            return result;
        });
        await Promise.resolve();
        expect(barrierSettled).toBe(false);

        activeAcknowledgement.resolve({ applied: true, status: 'applied' });
        await expect(direct).resolves.toEqual(expect.objectContaining({ applied: true }));
        await expect(barrier).resolves.toBe(true);
        expect(coordinator.pendingStage()).toBe(1);

        activeSessionId = 'staged';
        await expect(coordinator.flushStage('staged')).resolves.toEqual(expect.objectContaining({ failed: false }));
        expect(requests).toEqual([
            expect.objectContaining({ targetSessionId: 'active', type: 'vm-set' }),
            expect.objectContaining({ targetSessionId: 'staged', type: 'vm-set' }),
        ]);
    });

    it('honors an exact active-session target and never journals eval for replay', async () => {
        let activeSessionId = 'active';
        const requests = [];
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => activeSessionId,
            getStagedSessionId: () => 'staged',
            isSessionAddressable: () => true,
            protocol: {
                requestCommand: vi.fn(async (type, payload, { targetSessionId }) => {
                    requests.push({ payload, targetSessionId, type });
                    return { applied: true, status: 'applied' };
                }),
            },
        });
        coordinator.beginStage('staged');
        await expect(coordinator.beginBarrier('staged')).resolves.toBe(true);

        await expect(coordinator.requestCommand('eval', { expression: 'riveInstance' }, {
            targetSessionId: 'active',
        })).resolves.toEqual(expect.objectContaining({ applied: true }));
        expect(requests).toEqual([
            expect.objectContaining({ targetSessionId: 'active', type: 'eval' }),
        ]);
        expect(coordinator.pendingStage()).toBe(0);

        activeSessionId = 'staged';
        await expect(coordinator.flushStage('staged')).resolves.toEqual({ failed: false, outcomes: [] });
        expect(requests).toHaveLength(1);
    });

    it('flushes scalar and image relay mutations queued during a delayed predecessor drain to B before barrier completion', async () => {
        const predecessorAcknowledgement = deferred();
        const candidateImageAcknowledgement = deferred();
        const requests = [];
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => 'active',
            getStagedSessionId: () => 'staged',
            isSessionAddressable: () => true,
            protocol: {
                requestCommand: vi.fn((type, payload, { targetSessionId }) => {
                    requests.push({ payload, targetSessionId, type });
                    if (targetSessionId === 'active' && payload.path === 'predecessor') {
                        return predecessorAcknowledgement.promise;
                    }
                    if (targetSessionId === 'staged' && type === 'vm-image-set') {
                        return candidateImageAcknowledgement.promise;
                    }
                    return Promise.resolve({ applied: true, status: 'applied' });
                }),
            },
        });
        coordinator.beginStage('staged');
        const predecessor = coordinator.requestCommand('vm-set', {
            kind: 'boolean', path: 'predecessor', value: true,
        });
        await Promise.resolve();

        let barrierResolved = false;
        const barrier = coordinator.beginBarrier('staged').then((result) => {
            barrierResolved = true;
            return result;
        });
        const scalarPayload = { kind: 'boolean', path: 'enabled', value: true };
        const imagePayload = { path: 'avatar', value: [1] };
        await expect(coordinator.relay.relay('vm-set', scalarPayload)).resolves.toEqual(expect.objectContaining({ queued: true }));
        await expect(coordinator.relay.relay('vm-image-set', imagePayload)).resolves.toEqual(expect.objectContaining({ queued: true }));

        predecessorAcknowledgement.resolve({ applied: true, status: 'applied' });
        await expect(predecessor).resolves.toEqual(expect.objectContaining({ applied: true }));
        await vi.waitFor(() => expect(requests).toEqual(expect.arrayContaining([
            expect.objectContaining({ targetSessionId: 'staged', type: 'vm-set', payload: scalarPayload }),
            expect.objectContaining({ targetSessionId: 'staged', type: 'vm-image-set', payload: imagePayload }),
        ])));
        expect(barrierResolved).toBe(false);

        candidateImageAcknowledgement.resolve({ applied: true, status: 'applied' });
        await expect(barrier).resolves.toBe(true);
        await expect(coordinator.sealBarrier('staged')).resolves.toBe(true);
        expect(requests.filter(({ targetSessionId }) => targetSessionId === 'staged')).toEqual([
            expect.objectContaining({ type: 'vm-set', payload: scalarPayload }),
            expect.objectContaining({ type: 'vm-image-set', payload: imagePayload }),
        ]);
    });

    it('routes direct commands to the staged candidate after the activation drain, then holds post-seal commands', async () => {
        let activeSessionId = 'active';
        const requests = [];
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => activeSessionId,
            getStagedSessionId: () => 'staged',
            isSessionAddressable: () => true,
            protocol: {
                requestCommand: vi.fn(async (type, payload, { targetSessionId }) => {
                    requests.push({ payload, targetSessionId, type });
                    return { applied: true, status: 'applied' };
                }),
            },
        });
        coordinator.beginStage('staged');
        await expect(coordinator.beginBarrier('staged')).resolves.toBe(true);

        const direct = coordinator.requestCommand('trigger', { path: 'go' });
        await expect(direct).resolves.toEqual(expect.objectContaining({ applied: true }));
        expect(requests).toEqual([expect.objectContaining({ targetSessionId: 'staged', type: 'trigger' })]);

        await expect(coordinator.sealBarrier('staged')).resolves.toBe(true);
        const postSeal = coordinator.requestCommand('trigger', { path: 'after-seal' });
        await Promise.resolve();
        expect(requests).toHaveLength(1);

        activeSessionId = 'staged';
        coordinator.endStage('staged', true);
        await expect(postSeal).resolves.toEqual(expect.objectContaining({ applied: true }));
        expect(requests).toEqual([
            expect.objectContaining({ targetSessionId: 'staged', type: 'trigger', payload: { path: 'go' } }),
            expect.objectContaining({ targetSessionId: 'staged', type: 'trigger', payload: { path: 'after-seal' } }),
        ]);
    });

    it('reports the staged target for relay commands accepted during candidate preparation', async () => {
        const outcomes = [];
        const requests = [];
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => 'active-a',
            getStagedSessionId: () => 'staged-b',
            isSessionAddressable: () => true,
            onCommandResult: (outcome) => outcomes.push(outcome),
            protocol: {
                requestCommand: vi.fn(async (type, payload, { targetSessionId }) => {
                    requests.push({ payload, targetSessionId, type });
                    return { applied: true, status: 'applied' };
                }),
            },
        });
        coordinator.beginStage('staged-b');
        await expect(coordinator.beginBarrier('staged-b')).resolves.toBe(true);

        const payload = { action: 'set-image', kind: 'image', path: 'avatar', value: [1] };
        await expect(coordinator.relay.relay('vm-image-set', payload)).resolves.toEqual(expect.objectContaining({
            delivered: true,
        }));
        coordinator.endStage('staged-b', false);

        expect(requests).toEqual([
            expect.objectContaining({ targetSessionId: 'staged-b', type: 'vm-image-set' }),
        ]);
        expect(outcomes).toEqual([
            expect.objectContaining({ payload, targetSessionId: 'staged-b' }),
        ]);
    });

    it('keeps a preflight fence pending for a delayed relay acknowledgement without starving a real timer', () => withRealTimers(async () => {
        const acknowledgement = deferred();
        const requests = [];
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => 'active',
            getStagedSessionId: () => 'staged',
            isSessionAddressable: () => true,
            protocol: {
                requestCommand: vi.fn((type, payload, { targetSessionId }) => {
                    requests.push({ payload, targetSessionId, type });
                    return type === 'vm-image-set' ? acknowledgement.promise : Promise.resolve({ applied: true, status: 'applied' });
                }),
            },
        });

        const image = coordinator.relay.relay('vm-image-set', { path: 'avatar', value: [1] });
        await Promise.resolve();

        let preflightSettled = false;
        const preflight = coordinator.prepareStage('staged').then((result) => {
            preflightSettled = true;
            return result;
        });
        let heartbeat = false;
        await new Promise((resolve) => setTimeout(() => {
            heartbeat = true;
            resolve();
        }, 0));

        expect(heartbeat).toBe(true);
        expect(preflightSettled).toBe(false);
        acknowledgement.resolve({ applied: true, status: 'applied' });

        await expect(image).resolves.toEqual(expect.objectContaining({ delivered: true }));
        await expect(preflight).resolves.toBe(true);
        expect(requests).toEqual([
            expect.objectContaining({ targetSessionId: 'active', type: 'vm-image-set' }),
        ]);
    }));

    it('delivers fence-time mutations exactly once to the predecessor and stages only replayable state', async () => {
        let activeSessionId = 'active';
        const acknowledgement = deferred();
        const requests = [];
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => activeSessionId,
            getStagedSessionId: () => 'staged',
            isSessionAddressable: () => true,
            protocol: {
                requestCommand: vi.fn((type, payload, { targetSessionId }) => {
                    requests.push({ payload, targetSessionId, type });
                    if (type === 'vm-image-set' && payload.path === 'existing-image') return acknowledgement.promise;
                    return Promise.resolve({ applied: true, status: 'applied' });
                }),
            },
        });
        const existingImage = coordinator.relay.relay('vm-image-set', {
            path: 'existing-image', value: [1],
        });
        await Promise.resolve();

        const preflight = coordinator.prepareStage('staged');
        const statePayload = { kind: 'boolean', path: 'enabled', value: true };
        const imagePayload = { path: 'avatar', value: [2] };
        await expect(coordinator.relay.relay('vm-set', statePayload)).resolves.toEqual(expect.objectContaining({ queued: true }));
        await expect(coordinator.relay.relay('vm-image-set', imagePayload)).resolves.toEqual(expect.objectContaining({ queued: true }));

        acknowledgement.resolve({ applied: true, status: 'applied' });
        await expect(existingImage).resolves.toEqual(expect.objectContaining({ delivered: true }));
        await expect(preflight).resolves.toBe(true);

        expect(requests).toEqual([
            expect.objectContaining({ targetSessionId: 'active', type: 'vm-image-set', payload: expect.objectContaining({ path: 'existing-image' }) }),
            expect.objectContaining({ targetSessionId: 'active', type: 'vm-set', payload: statePayload }),
            expect.objectContaining({ targetSessionId: 'active', type: 'vm-image-set', payload: imagePayload }),
        ]);
        expect(coordinator.pendingStage()).toBe(1);

        activeSessionId = 'staged';
        await expect(coordinator.flushStage('staged')).resolves.toEqual(expect.objectContaining({ failed: false }));
        expect(requests.filter(({ targetSessionId }) => targetSessionId === 'staged')).toEqual([
            expect.objectContaining({ type: 'vm-set', payload: statePayload }),
        ]);
    });

    it('settles superseded and cleared preflight barriers without chaining waiters indefinitely', () => withRealTimers(async () => {
        const acknowledgement = deferred();
        const requests = [];
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => 'active',
            getStagedSessionId: () => null,
            isSessionAddressable: () => true,
            protocol: {
                requestCommand: vi.fn((type, payload, { targetSessionId }) => {
                    requests.push({ payload, targetSessionId, type });
                    return type === 'vm-image-set' ? acknowledgement.promise : Promise.resolve({ applied: true, status: 'applied' });
                }),
            },
        });
        const inFlightImage = coordinator.relay.relay('vm-image-set', { path: 'avatar', value: [1] });
        await Promise.resolve();

        const first = coordinator.prepareStage('staged-one');
        const waiter = coordinator.requestCommand('vm-set', { kind: 'boolean', path: 'enabled', value: true });
        const second = coordinator.prepareStage('staged-two');
        // Let the first waiter observe the replacement fence before it is
        // cleared; it must fail once rather than walk a mutable barrier chain.
        await Promise.resolve();
        coordinator.clear();

        let heartbeat = false;
        await new Promise((resolve) => setTimeout(() => {
            heartbeat = true;
            resolve();
        }, 0));
        expect(heartbeat).toBe(true);

        acknowledgement.resolve({ applied: true, status: 'applied' });
        await expect(inFlightImage).resolves.toEqual(expect.objectContaining({ delivered: true }));
        await expect(first).resolves.toBe(false);
        await expect(second).resolves.toBe(false);
        await expect(waiter).resolves.toEqual({ applied: false, status: 'replacement-busy' });
        expect(requests).toEqual([
            expect.objectContaining({ targetSessionId: 'active', type: 'vm-image-set' }),
        ]);
    }));

    it('reports terminal cancellation for relay commands buffered after a sealed candidate fence', async () => {
        const outcomes = [];
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => 'active',
            getStagedSessionId: () => 'staged',
            isSessionAddressable: () => true,
            onCommandResult: (outcome) => outcomes.push(outcome),
            protocol: { requestCommand: vi.fn(async () => ({ applied: true, status: 'applied' })) },
        });
        coordinator.beginStage('staged');
        const predecessorPayload = { kind: 'boolean', path: 'predecessor', value: true };
        await expect(coordinator.requestCommand('vm-set', predecessorPayload)).resolves.toEqual(expect.objectContaining({ applied: true }));
        expect(coordinator.pendingStage()).toBe(1);
        await expect(coordinator.beginBarrier('staged')).resolves.toBe(true);
        await expect(coordinator.sealBarrier('staged')).resolves.toBe(true);

        const payload = { kind: 'boolean', path: 'enabled', value: true };
        await expect(coordinator.relay.relay('vm-set', payload)).resolves.toEqual(expect.objectContaining({ queued: true }));
        coordinator.clear();

        expect(coordinator.pendingQueued()).toBe(0);
        expect(outcomes).toContainEqual(expect.objectContaining({
            metadata: expect.objectContaining({ cancelled: true, stage: true }),
            payload: predecessorPayload,
            result: expect.objectContaining({ applied: false, status: 'cancelled' }),
        }));
        expect(outcomes).toContainEqual(expect.objectContaining({
            metadata: expect.objectContaining({ cancelled: true }),
            payload,
            result: expect.objectContaining({ applied: false, status: 'cancelled' }),
        }));
    });

    it('terminally cancels a retry-exhausted preflight relay buffer instead of carrying it into a later stage', async () => {
        const outcomes = [];
        const payload = { kind: 'boolean', path: 'enabled', value: true };
        const coordinator = createRenderSurfaceActivationCoordinator({
            getActiveSessionId: () => 'active',
            getStagedSessionId: () => 'staged',
            isSessionAddressable: () => true,
            onCommandResult: (outcome) => outcomes.push(outcome),
            protocol: {
                requestCommand: vi.fn(async () => ({ applied: false, status: 'unavailable' })),
            },
        });

        const preflight = coordinator.prepareStage('staged');
        await expect(coordinator.relay.relay('vm-set', payload)).resolves.toEqual(expect.objectContaining({ queued: true }));

        await expect(preflight).resolves.toBe(false);
        expect(coordinator.pendingQueued()).toBe(0);
        expect(outcomes).toContainEqual(expect.objectContaining({
            metadata: expect.objectContaining({ cancelled: true }),
            payload,
            result: expect.objectContaining({ applied: false, status: 'cancelled' }),
        }));
    });
});
