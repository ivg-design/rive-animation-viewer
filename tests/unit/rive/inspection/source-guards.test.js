import { createSourceScope, sourceScopesMatch, scopedControlSnapshot } from '../../../../src/app/rive/inspection/source-scope.js';
import { createVmControlAccessorResolver } from '../../../../src/app/rive/view-model/controller/accessor-resolver.js';
import { createRemoteControlsAdapter } from '../../../../src/app/rive/view-model/remote/controls.js';
import { createVmSnapshotController } from '../../../../src/app/rive/view-model/snapshot.js';
import { createRenderSurfaceActivationCoordinator } from '../../../../src/app/platform/render-surface/activation/coordinator.js';
import { prepareAndActivateRenderSurface } from '../../../../src/app/platform/render-surface/activation/transaction.js';

const scope = (overrides = {}) => createSourceScope({ sourceIdentity: 'file-A', runtimeKey: 'webgl2@2.42.0',
    artboardKey: 'Main', vmInstanceKey: 'VM', sessionId: 'A', ...overrides });
const descriptor = { source: 'view-model', path: 'svg', kind: 'string' };
const snapshot = [{ descriptor, kind: 'string', value: 'A-value' }];
const nextState = (sessionId, value) => ({ sessionId, stateRevision: 1, topologyRevision: 1, artboard: 'Main',
    vmInstance: { key: 'VM' }, controlsHierarchy: { inputs: [{ descriptor, kind: 'string', value }], children: [] } });

describe('source and session guards', () => {
    it.each([{ sourceIdentity: 'file-B' }, { runtimeKey: 'canvas@2.42.0' }, { artboardKey: 'Second' }, { vmInstanceKey: 'Other' }])
    ('does not replay controls across %j', async (changed) => {
        const sendCommand = vi.fn(async () => ({ applied: true }));
        await prepareAndActivateRenderSurface({ getControlSnapshot: () => scopedControlSnapshot(snapshot, scope()),
            targetScope: scope(changed), sendCommand, flushPendingCommands: async () => ({}), pendingCommandCount: () => 0,
            activate: async () => true });
        expect(sendCommand.mock.calls.some(([type]) => type === 'snapshot')).toBe(false);
    });
    it('allows same-source rebuild snapshots while requiring exact sessions for mutations', async () => {
        const before = scope(); const after = scope({ sessionId: 'B' });
        expect(sourceScopesMatch(before, after)).toBe(true);
        expect(sourceScopesMatch(before, after, { requireSession: true })).toBe(false);
        const sendCommand = vi.fn(async () => ({ applied: true }));
        await prepareAndActivateRenderSurface({ getControlSnapshot: () => scopedControlSnapshot(snapshot, before),
            targetScope: after, sendCommand, flushPendingCommands: async () => ({}), pendingCommandCount: () => 0,
            activate: async () => true });
        expect(sendCommand).toHaveBeenCalledWith('snapshot', { snapshot });
    });
    it('never replays an unscoped control snapshot', async () => {
        const sendCommand = vi.fn(async () => ({ applied: true }));
        await prepareAndActivateRenderSurface({ getControlSnapshot: () => snapshot, targetScope: scope(), sendCommand,
            flushPendingCommands: async () => ({}), pendingCommandCount: () => 0, activate: async () => true });
        expect(sendCommand.mock.calls.some(([type]) => type === 'snapshot')).toBe(false);
    });
    it('blocks old authoritative reads and invalidates retained accessor handles after A to B', () => {
        let current = scope(); let state = nextState('A', 'A-value');
        const remote = createRemoteControlsAdapter({ getCanonicalState: () => state });
        const resolver = createVmControlAccessorResolver({ isAuthoritativeChildMode: true, remoteControls: remote,
            getCurrentSourceScope: () => current, getControlSourceScope: () => scope() });
        const oldAccessor = resolver.resolveControlAccessor(descriptor);
        expect(oldAccessor.value).toBe('A-value');
        current = scope({ sourceIdentity: 'file-B' });
        expect(resolver.resolveControlAccessor(descriptor)).toBeNull();
        state = nextState('B', 'B-value');
        expect(oldAccessor.value).toBeUndefined();
        expect(remote.resolveAccessor(descriptor).value).toBe('B-value');
        remote.acceptCanonicalState(nextState('A', 'late-A'));
        expect(remote.resolveAccessor(descriptor).value).toBe('B-value');
    });
    it('discards pending local snapshots after source change but preserves same-source reset', () => {
        let current = scope(); let accessor = { value: 'A-value' };
        const controller = createVmSnapshotController({ getBindings: () => [{ descriptor, kind: 'string' }],
            getRiveInstance: () => ({ viewModelInstance: {} }), getCurrentSourceScope: () => current,
            resolveControlAccessor: () => accessor, syncVmControlBindings: vi.fn() });
        const captured = controller.captureVmControlSnapshot();
        accessor = null;
        expect(controller.applyVmControlSnapshot(captured)).toBe(0);
        current = scope({ sourceIdentity: 'file-B' }); accessor = { value: 'B-value' };
        expect(controller.retryPendingVmControlSnapshot()).toBe(0); expect(accessor.value).toBe('B-value');
        current = scope(); accessor.value = 'changed';
        expect(controller.applyVmControlSnapshot(captured)).toBe(1); expect(accessor.value).toBe('A-value');
    });
    it.each([false, true])('late queued commands respect source identity; same source=%s', async (sameSource) => {
        let active = 'A'; let resolve;
        const pending = new Promise((done) => { resolve = done; });
        const request = vi.fn((type, _payload, options) => options.targetSessionId === 'A' && type === 'vm-set'
            ? pending : Promise.resolve({ applied: true }));
        const coordinator = createRenderSurfaceActivationCoordinator({ getActiveSessionId: () => active,
            getStagedSessionId: () => 'B', isSessionAddressable: () => true, protocol: { requestCommand: request } });
        coordinator.setSourceScope('A', scope());
        coordinator.setSourceScope('B', scope({ sourceIdentity: sameSource ? 'file-A' : 'file-B', sessionId: 'B' }));
        coordinator.beginStage('B');
        const predecessor = coordinator.requestCommand('vm-set', { path: 'svg', value: 'A' });
        const barrier = coordinator.beginBarrier('B');
        await Promise.resolve();
        const queued = coordinator.requestCommand('vm-fire', { path: 'fire' });
        resolve({ applied: true }); await predecessor; await barrier;
        expect((await queued).applied).toBe(sameSource);
        active = 'B'; await coordinator.flushStage('B');
        expect(request.mock.calls.filter((call) => call[2].targetSessionId === 'B')).toHaveLength(sameSource ? 2 : 0);
    });
});
