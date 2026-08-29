import {
    createRenderSurfaceCommandBuffer,
    createRenderSurfaceCommandRelay,
} from '../../../src/app/platform/render-surface/command-buffer.js';
import {
    createRenderSurfaceProtocol,
    renderSurfaceCommandTimeoutMs,
} from '../../../src/app/platform/render-surface/protocol.js';

function controlHierarchy(value = 1) {
    return {
        children: [{
            children: [],
            inputs: [{
                descriptor: { kind: 'number', name: 'speed', path: 'speed', source: 'view-model' },
                kind: 'number',
                value,
            }],
            kind: 'vm',
            label: 'Root VM',
            path: '<root>',
        }],
        inputs: [],
        kind: 'controls',
        label: 'Controls',
        path: '<controls>',
    };
}

function imageControlHierarchy(metadata = null, present = false) {
    return {
        children: [{
            children: [],
            inputs: [{
                descriptor: { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' },
                kind: 'image',
                metadata,
                present,
            }],
            kind: 'vm',
            label: 'Root VM',
            path: '<root>',
        }],
        inputs: [],
        kind: 'controls',
        label: 'Controls',
        path: '<controls>',
    };
}

function globalControlHierarchy() {
    const globalInput = (globalViewModelName, value) => ({
        descriptor: {
            globalViewModelName,
            kind: 'number',
            name: 'shared',
            path: 'shared',
            source: 'global-view-model',
        },
        globalViewModelName,
        kind: 'number',
        name: 'shared',
        path: 'shared',
        source: 'global-view-model',
        value,
    });
    return {
        children: [{
            children: [{
                children: [],
                globalViewModelName: 'Theme',
                inputs: [globalInput('Theme', 1)],
                kind: 'global-view-model',
                label: 'Theme',
                path: '<root>',
                source: 'global-view-model',
            }, {
                children: [],
                globalViewModelName: 'Session',
                inputs: [globalInput('Session', 2)],
                kind: 'global-view-model',
                label: 'Session',
                path: '<root>',
                source: 'global-view-model',
            }],
            inputs: [],
            kind: 'global-view-models',
            label: 'Global ViewModels',
            path: '__global_view_models__',
        }],
        inputs: [],
        kind: 'controls',
        label: 'Controls',
        path: '<controls>',
    };
}

describe('platform/render-surface/protocol', () => {
    it('keeps global ViewModel command buffering and canonical deltas scope-specific', () => {
        const buffer = createRenderSurfaceCommandBuffer();
        buffer.enqueue('vm-set', {
            globalViewModelName: 'Theme', kind: 'number', path: 'shared', source: 'global-view-model', value: 1,
        });
        buffer.enqueue('vm-set', {
            globalViewModelName: 'Session', kind: 'number', path: 'shared', source: 'global-view-model', value: 2,
        });
        buffer.enqueue('vm-set', {
            globalViewModelName: 'Theme', kind: 'number', path: 'shared', source: 'global-view-model', value: 3,
        });
        expect(buffer.drain().map((entry) => entry.payload.value)).toEqual([2, 3]);

        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            windowRef: window,
        });
        protocol.beginSession('global-scope', 2);
        protocol.handleState({ payload: {
            controlsHierarchy: globalControlHierarchy(),
            sessionId: 'global-scope',
            stateRevision: 1,
            topologyRevision: 1,
        } });
        expect(protocol.activateSession('global-scope')).toBe(true);
        protocol.handleState({ payload: {
            controlChanges: [{ key: 'gvm:Theme:shared:number', kind: 'number', value: 10 }, {
                key: 'gvm:Session:shared:number', kind: 'number', value: 20,
            }],
            sessionId: 'global-scope',
            stateRevision: 2,
            stateType: 'delta',
            topologyRevision: 1,
        } });
        const globalTrees = protocol.getState().canonicalState.controlsHierarchy.children[0].children;
        expect(globalTrees.map((tree) => tree.inputs[0].value)).toEqual([10, 20]);
    });

    it.each([
        ['pause', 3_000],
        ['vm-set', 3_000],
        ['reset', 10_000],
        ['vm-image-set', 10_000],
        ['capture-canvas', 60_000],
    ])('uses the bounded %s acknowledgement timeout', (type, expectedTimeout) => {
        expect(renderSurfaceCommandTimeoutMs(type)).toBe(expectedTimeout);
    });

    it('applies the default and long acknowledgement timeouts to live requests', async () => {
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            windowRef: window,
        });
        protocol.beginSession('timeout-policy', 2);
        const ordinaryResult = vi.fn();
        const resetResult = vi.fn();
        protocol.requestCommand('pause').then(ordinaryResult);
        protocol.requestCommand('reset').then(resetResult);
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(3_001);
        expect(ordinaryResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'timeout' }));
        expect(resetResult).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(7_000);
        expect(resetResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'timeout' }));
    });

    it('serializes commands until child acknowledgements and treats rejection as recoverable', async () => {
        const invocations = [];
        const canonicalUpdates = [];
        const commandResults = [];
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async (_command, args) => {
                invocations.push(args.payload);
                return true;
            }),
            onCanonicalState: (state) => canonicalUpdates.push(state),
            onCommandResult: (result) => commandResults.push(result),
            windowRef: window,
        });
        protocol.beginSession('session-1');
        protocol.handleReady({ payload: { protocolVersion: 2, sessionId: 'session-1' } });
        const relay = createRenderSurfaceCommandRelay({ canSend: () => true, send: protocol.sendCommand });

        const first = relay.relay('vm-set', { path: 'enabled', kind: 'boolean', value: true });
        const second = relay.relay('pause');
        await Promise.resolve();
        await Promise.resolve();
        expect(invocations).toHaveLength(1);
        expect(invocations[0]).toEqual(expect.objectContaining({
            commandId: 'session-1:1',
            protocolVersion: 2,
            revision: 1,
            type: 'vm-set',
        }));

        protocol.handleAck({ payload: {
            applied: true,
            commandId: 'session-1:1',
            revision: 1,
            sessionId: 'session-1',
            status: 'applied',
        } });
        await first;
        await Promise.resolve();
        expect(invocations).toHaveLength(2);
        expect(invocations[1]).toEqual(expect.objectContaining({ revision: 2, type: 'pause' }));

        protocol.handleAck({ payload: {
            applied: false,
            commandId: 'session-1:2',
            message: 'not available',
            revision: 2,
            sessionId: 'session-1',
            status: 'rejected',
        } });
        await second;
        await relay.whenIdle();
        expect(relay.size()).toBe(0);
        expect(commandResults.map((result) => result.status)).toEqual(['applied', 'rejected']);

        const stateEvent = vi.fn();
        document.addEventListener('rav:render-surface-state', stateEvent);
        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(),
            revision: 4,
            sessionId: 'session-1',
            stateRevision: 4,
        } });
        expect(canonicalUpdates).toEqual([]);
        expect(protocol.activateSession('session-1')).toBe(true);
        protocol.handleState({ payload: { revision: 3, sessionId: 'session-1', stateRevision: 3 } });
        expect(canonicalUpdates).toEqual([expect.objectContaining({ revision: 4 })]);
        expect(stateEvent).toHaveBeenCalledOnce();
        expect(protocol.getState().canonicalState.revision).toBe(4);
    });

    it('keeps the active canonical state published while a replacement session stages', () => {
        const canonicalUpdates = [];
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            onCanonicalState: (state) => canonicalUpdates.push(state),
            windowRef: window,
        });

        protocol.beginSession('active', 2);
        protocol.handleState({ payload: {
            artboard: 'A', controlsHierarchy: controlHierarchy(), revision: 1, sessionId: 'active',
        } });
        protocol.activateSession('active');
        protocol.beginSession('staged', 2);
        protocol.handleState({ payload: {
            artboard: 'B', controlsHierarchy: controlHierarchy(), revision: 1, sessionId: 'staged',
        } });

        expect(protocol.getState().canonicalState.artboard).toBe('A');
        expect(canonicalUpdates.map((state) => state?.artboard)).toEqual(['A']);

        protocol.activateSession('staged');
        expect(protocol.getState().canonicalState.artboard).toBe('B');
        expect(protocol.getState().canonicalState.sessionId).toBe('staged');
        expect(canonicalUpdates.map((state) => state?.artboard)).toEqual(['A', 'B']);
        expect(canonicalUpdates.map((state) => state?.sessionId)).toEqual(['active', 'staged']);
    });

    it('can converge on an older native activation while a newer session remains staged', () => {
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            windowRef: window,
        });

        protocol.beginSession('previous', 2);
        protocol.activateSession('previous');
        protocol.beginSession('activating', 2);
        protocol.handleState({ payload: {
            artboard: 'Activating', controlsHierarchy: controlHierarchy(), revision: 1, sessionId: 'activating',
        } });
        protocol.beginSession('newer-staged', 2);
        protocol.handleState({ payload: {
            artboard: 'Newer', controlsHierarchy: controlHierarchy(), revision: 1, sessionId: 'newer-staged',
        } });

        expect(protocol.activateSession('activating')).toBe(true);
        expect(protocol.getState()).toEqual(expect.objectContaining({
            activeSessionId: 'activating',
            canonicalState: expect.objectContaining({ artboard: 'Activating' }),
        }));

        expect(protocol.activateSession('newer-staged')).toBe(true);
        expect(protocol.getState()).toEqual(expect.objectContaining({
            activeSessionId: 'newer-staged',
            canonicalState: expect.objectContaining({ artboard: 'Newer' }),
        }));
    });

    it('keeps independent ordered command streams for active and staged sessions', async () => {
        const sent = [];
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async (_command, args) => {
                sent.push(args.payload);
                return true;
            }),
            windowRef: window,
        });
        protocol.beginSession('active', 2);
        protocol.activateSession('active');
        protocol.beginSession('staged', 2);

        const activeCommand = protocol.requestCommand('pause', {}, { targetSessionId: 'active' });
        const stagedCommand = protocol.requestCommand('presentation', {}, { targetSessionId: 'staged' });
        await Promise.resolve();
        expect(sent.map(({ commandId, revision, sessionId }) => ({ commandId, revision, sessionId }))).toEqual([
            { commandId: 'active:1', revision: 1, sessionId: 'active' },
            { commandId: 'staged:1', revision: 1, sessionId: 'staged' },
        ]);
        sent.forEach((command) => protocol.handleAck({ payload: {
            applied: true,
            commandId: command.commandId,
            revision: command.revision,
            sessionId: command.sessionId,
            status: 'applied',
        } }));
        await expect(activeCommand).resolves.toEqual(expect.objectContaining({ applied: true }));
        await expect(stagedCommand).resolves.toEqual(expect.objectContaining({ applied: true }));

        const nextActive = protocol.requestCommand('play', {}, { targetSessionId: 'active' });
        await Promise.resolve();
        expect(sent.at(-1)).toEqual(expect.objectContaining({ commandId: 'active:2', revision: 2 }));
        protocol.handleAck({ payload: { applied: true, commandId: 'active:2', sessionId: 'active', status: 'applied' } });
        await expect(nextActive).resolves.toEqual(expect.objectContaining({ applied: true }));
    });

    it('continues accepting protocol-v2 complete state publications', () => {
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            windowRef: window,
        });
        protocol.beginSession('v2-full', 2);
        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(1),
            protocolVersion: 2,
            revision: 1,
            sessionId: 'v2-full',
            topologyRevision: 1,
        } });
        protocol.activateSession('v2-full');
        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(5),
            protocolVersion: 2,
            revision: 2,
            sessionId: 'v2-full',
            topologyRevision: 1,
        } });
        expect(protocol.getState().canonicalState.controlsHierarchy.children[0].inputs[0].value).toBe(5);
    });

    it('merges value-only deltas into the complete canonical hierarchy and ignores stale deltas', () => {
        const updates = [];
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            onCanonicalState: (state) => updates.push(state),
            windowRef: window,
        });
        protocol.beginSession('delta-session', 2);
        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(1),
            revision: 1,
            sessionId: 'delta-session',
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        protocol.activateSession('delta-session');
        protocol.handleState({ payload: {
            controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: 9 }],
            playback: { currentFrame: 12, type: 'animation' },
            revision: 2,
            sessionId: 'delta-session',
            stateRevision: 2,
            stateType: 'delta',
            topologyRevision: 1,
        } });

        expect(protocol.getState().canonicalState.controlsHierarchy.children[0].inputs[0].value).toBe(9);
        expect(protocol.getState().canonicalState.playback.currentFrame).toBe(12);
        protocol.handleState({ payload: {
            controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: -1 }],
            revision: 1,
            sessionId: 'delta-session',
            stateRevision: 1,
            stateType: 'delta',
            topologyRevision: 1,
        } });
        expect(protocol.getState().canonicalState.controlsHierarchy.children[0].inputs[0].value).toBe(9);
        expect(updates).toHaveLength(2);
    });

    it('clears canonical image metadata when an acknowledged clear delta carries null metadata', () => {
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            windowRef: window,
        });
        protocol.beginSession('image-clear-delta', 2);
        protocol.handleState({ payload: {
            controlsHierarchy: imageControlHierarchy({ kind: 'embedded', key: 'funkos_9', label: 'funkos_9' }, true),
            revision: 1,
            sessionId: 'image-clear-delta',
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        protocol.activateSession('image-clear-delta');
        protocol.handleState({ payload: {
            controlChanges: [{ key: 'vm:avatar:image', kind: 'image', metadata: null, present: false }],
            revision: 2,
            sessionId: 'image-clear-delta',
            stateRevision: 2,
            stateType: 'delta',
            topologyRevision: 1,
        } });

        expect(protocol.getState().canonicalState.controlsHierarchy.children[0].inputs[0]).toEqual(expect.objectContaining({
            metadata: null,
            present: false,
        }));
    });

    it('buffers reordered topology deltas and replays them after the matching snapshot', () => {
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            windowRef: window,
        });
        protocol.beginSession('topology-reorder', 2);
        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(1),
            sessionId: 'topology-reorder',
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        protocol.activateSession('topology-reorder');
        protocol.handleState({ payload: {
            controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: 10 }],
            sessionId: 'topology-reorder',
            stateRevision: 4,
            stateType: 'delta',
            topologyRevision: 2,
        } });
        protocol.handleState({ payload: {
            controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: 9 }],
            sessionId: 'topology-reorder',
            stateRevision: 3,
            stateType: 'delta',
            topologyRevision: 2,
        } });
        expect(protocol.getState().canonicalState.stateRevision).toBe(1);

        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(5),
            sessionId: 'topology-reorder',
            stateRevision: 2,
            stateType: 'snapshot',
            topologyRevision: 2,
        } });
        expect(protocol.getState().canonicalState.stateRevision).toBe(4);
        expect(protocol.getState().canonicalState.controlsHierarchy.children[0].inputs[0].value).toBe(10);
    });

    it('keeps a lightweight bootstrap staged until its large canonical topology is complete', async () => {
        const sent = [];
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async (_command, args) => {
                sent.push(args.payload);
                return true;
            }),
            windowRef: window,
        });
        protocol.beginSession('heavy-bootstrap', 2);
        // This is deliberately hierarchy-free. A child must be allowed to
        // acknowledge a first composited frame without synchronously reading
        // every accessor required to materialize the inspector.
        protocol.handleState({ payload: {
            artboard: 'TrackMap',
            playback: { isPlaying: true, name: 'TrackMapSM', type: 'stateMachine' },
            sessionId: 'heavy-bootstrap',
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 0,
            vmInstance: { key: 'Instance (auto)' },
        } });
        const baseline = protocol.waitForCanonicalBaseline('heavy-bootstrap', { timeoutMs: 100 });
        expect(protocol.activateSession('heavy-bootstrap')).toBe(false);
        expect(protocol.getState().canonicalState).toBeNull();

        // Playback/layout/reset paths must retain their normal ACK semantics
        // while the large ViewModel hierarchy is deferred.
        const presentation = protocol.requestCommand('presentation', { layoutAlignment: 'center' });
        await Promise.resolve();
        expect(sent).toHaveLength(1);
        protocol.handleAck({ payload: {
            applied: true,
            commandId: sent[0].commandId,
            sessionId: 'heavy-bootstrap',
            status: 'applied',
        } });
        await expect(presentation).resolves.toEqual(expect.objectContaining({ applied: true, status: 'applied' }));

        const reset = protocol.requestCommand('reset', { params: { artboard: 'TrackMap', autoplay: true } });
        await Promise.resolve();
        expect(sent).toHaveLength(2);
        protocol.handleAck({ payload: {
            applied: true,
            commandId: sent[1].commandId,
            sessionId: 'heavy-bootstrap',
            status: 'applied',
        } });
        await expect(reset).resolves.toEqual(expect.objectContaining({ applied: true, status: 'applied' }));

        // A command result can arrive before inspector topology. It must be
        // retained until the child publishes the eventual hierarchy rather
        // than forcing a synchronous scan into the acknowledgement path.
        const write = protocol.requestCommand('vm-set', { kind: 'number', path: 'speed', value: 42 });
        await Promise.resolve();
        expect(sent).toHaveLength(3);
        protocol.handleAck({ payload: {
            applied: true,
            canonicalDelta: {
                controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: 42 }],
                stateRevision: 2,
                stateType: 'delta',
                topologyRevision: 1,
            },
            commandId: sent[2].commandId,
            sessionId: 'heavy-bootstrap',
            status: 'applied',
        } });
        await expect(write).resolves.toEqual(expect.objectContaining({ applied: true, status: 'applied' }));
        expect(protocol.getState().canonicalState).toBeNull();

        protocol.handleState({ payload: {
            artboard: 'TrackMap',
            controlsHierarchy: controlHierarchy(42),
            playback: { isPlaying: true, name: 'TrackMapSM', type: 'stateMachine' },
            sessionId: 'heavy-bootstrap',
            stateRevision: 3,
            stateType: 'snapshot',
            topologyRevision: 1,
            vmInstance: { key: 'Instance (auto)' },
        } });
        await expect(baseline).resolves.toEqual(expect.objectContaining({
            canonicalState: expect.objectContaining({ artboard: 'TrackMap' }),
            ready: true,
            status: 'ready',
        }));
        expect(protocol.activateSession('heavy-bootstrap')).toBe(true);
        expect(protocol.getState().canonicalState).toEqual(expect.objectContaining({
            artboard: 'TrackMap',
            topologyRevision: 1,
        }));
        expect(protocol.getState().canonicalState.controlsHierarchy.children[0].inputs[0].value).toBe(42);
    });

    it('compacts an arbitrarily long reordered delta burst without losing an early changed key', () => {
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async () => true),
            windowRef: window,
        });
        protocol.beginSession('topology-burst', 2);
        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(1),
            sessionId: 'topology-burst',
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        protocol.activateSession('topology-burst');
        protocol.handleState({ payload: {
            controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: 77 }],
            sessionId: 'topology-burst',
            stateRevision: 3,
            stateType: 'delta',
            topologyRevision: 2,
        } });
        for (let revision = 4; revision <= 40; revision += 1) {
            protocol.handleState({ payload: {
                controlChanges: [{ key: `vm:unrelated-${revision}:number`, kind: 'number', value: revision }],
                sessionId: 'topology-burst',
                stateRevision: revision,
                stateType: 'delta',
                topologyRevision: 2,
            } });
        }
        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(5),
            sessionId: 'topology-burst',
            stateRevision: 2,
            stateType: 'snapshot',
            topologyRevision: 2,
        } });

        expect(protocol.getState().canonicalState.stateRevision).toBe(40);
        expect(protocol.getState().canonicalState.controlsHierarchy.children[0].inputs[0].value).toBe(77);
    });

    it('reconciles an ACK-carried delta before resolving when the state event is reordered', async () => {
        const sent = [];
        const updates = [];
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async (_command, args) => {
                sent.push(args.payload);
                return true;
            }),
            onCanonicalState: (state) => updates.push(state),
            windowRef: window,
        });
        protocol.beginSession('ack-session', 2);
        protocol.handleState({ payload: {
            controlsHierarchy: controlHierarchy(1),
            revision: 1,
            sessionId: 'ack-session',
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
        } });
        protocol.activateSession('ack-session');

        const pending = protocol.requestCommand('vm-set', { kind: 'number', path: 'speed', value: 7 });
        await Promise.resolve();
        protocol.handleAck({ payload: {
            applied: true,
            canonicalDelta: {
                controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: 7 }],
                revision: 2,
                stateRevision: 2,
                stateType: 'delta',
                topologyRevision: 1,
            },
            commandId: sent[0].commandId,
            sessionId: 'ack-session',
            status: 'applied',
        } });

        await expect(pending).resolves.toEqual(expect.objectContaining({
            canonicalState: expect.objectContaining({ stateRevision: 2 }),
        }));
        expect((await pending).canonicalState.controlsHierarchy.children[0].inputs[0].value).toBe(7);
        protocol.handleState({ payload: {
            controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: 7 }],
            revision: 2,
            sessionId: 'ack-session',
            stateRevision: 2,
            stateType: 'delta',
            topologyRevision: 1,
        } });
        expect(updates).toHaveLength(2);
    });

    it('times out an unacknowledged command, ignores its late ACK, and continues in order', async () => {
        const sent = [];
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async (_command, args) => {
                sent.push(args.payload);
                return true;
            }),
            windowRef: window,
        });
        protocol.beginSession('session-timeout', 2);
        const first = protocol.requestCommand('pause', {}, { timeoutMs: 25 });
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(26);
        await expect(first).resolves.toEqual(expect.objectContaining({ applied: false, status: 'timeout' }));

        protocol.handleAck({ payload: {
            applied: true,
            commandId: sent[0].commandId,
            revision: sent[0].revision,
            sessionId: 'session-timeout',
            status: 'applied',
        } });
        const second = protocol.requestCommand('play', {}, { timeoutMs: 25 });
        await Promise.resolve();
        protocol.handleAck({ payload: {
            applied: true,
            commandId: sent[1].commandId,
            revision: sent[1].revision,
            sessionId: 'session-timeout',
            status: 'applied',
        } });
        await expect(second).resolves.toEqual(expect.objectContaining({ applied: true, status: 'applied' }));
        expect(sent.map((command) => command.revision)).toEqual([1, 2]);
    });

    it('quarantines a failed active session against late state, ACKs, and new commands', async () => {
        const sent = [];
        const protocol = createRenderSurfaceProtocol({
            canSend: () => true,
            documentRef: document,
            invokeQuietly: vi.fn(async (_command, args) => {
                sent.push(args.payload);
                return true;
            }),
            windowRef: window,
        });
        protocol.beginSession('failed-active', 2);
        protocol.handleState({ payload: {
            artboard: 'Last Good', controlsHierarchy: controlHierarchy(), revision: 1, sessionId: 'failed-active',
        } });
        protocol.activateSession('failed-active');
        const pending = protocol.requestCommand('pause');
        await Promise.resolve();
        expect(protocol.quarantineSession('failed-active', 'GPU process failed')).toBe(true);
        await expect(pending).resolves.toEqual(expect.objectContaining({ applied: false, status: 'cancelled' }));

        protocol.handleAck({ payload: {
            applied: true,
            canonicalDelta: { artboard: 'Late ACK', revision: 2 },
            commandId: sent[0].commandId,
            sessionId: 'failed-active',
            status: 'applied',
        } });
        protocol.handleState({ payload: { artboard: 'Late State', revision: 3, sessionId: 'failed-active' } });
        expect(protocol.getState().canonicalState.artboard).toBe('Last Good');
        await expect(protocol.requestCommand('play')).resolves.toEqual(expect.objectContaining({
            applied: false,
            status: 'unavailable',
        }));
    });

    it('does not requeue a terminal rejection but preserves retryable commands', async () => {
        const responses = [
            { applied: false, message: 'invalid input', status: 'rejected' },
            { applied: false, status: 'transport-error' },
        ];
        const relay = createRenderSurfaceCommandRelay({
            canSend: () => true,
            send: vi.fn(async () => responses.shift()),
        });
        relay.relay('vm-set', { kind: 'number', path: 'speed', value: 4 });
        relay.relay('pause');
        await relay.whenIdle();
        expect(relay.size()).toBe(1);
        const result = await relay.flush();
        expect(result.failed).toBe(true);
        expect(result.retryable).toBe(true);
        expect(relay.size()).toBe(1);
    });

    it.each(['vm-fire', 'sm-fire'])('never retries an ambiguously timed-out %s command', async (type) => {
        const send = vi.fn(async () => ({ applied: false, status: 'timeout' }));
        const results = [];
        const relay = createRenderSurfaceCommandRelay({
            canSend: () => true,
            onResult: (result) => results.push(result),
            send,
        });

        await relay.relay(type, { path: 'fire', kind: 'trigger' });
        await relay.whenIdle();
        expect(send).toHaveBeenCalledOnce();
        expect(relay.size()).toBe(0);
        expect(results).toEqual([expect.objectContaining({
            metadata: expect.objectContaining({ requeued: false, retryable: false }),
            result: expect.objectContaining({ status: 'timeout' }),
            type,
        })]);

        await relay.flush();
        expect(send).toHaveBeenCalledOnce();
    });

    it('rejects trigger overflow explicitly without dropping an earlier trigger', async () => {
        let available = false;
        const sent = [];
        const overflows = [];
        const relay = createRenderSurfaceCommandRelay({
            canSend: () => available,
            onOverflow: (outcome) => overflows.push(outcome),
            send: vi.fn(async (type, payload) => {
                sent.push({ payload, type });
                return { applied: true, status: 'applied' };
            }),
        });

        const queued = [];
        for (let index = 0; index < 257; index += 1) {
            queued.push(await relay.relay('vm-fire', { index, kind: 'trigger', path: 'fire' }));
        }
        expect(relay.size()).toBe(256);
        expect(queued.at(-1)).toEqual(expect.objectContaining({ status: 'overflow' }));
        expect(overflows).toEqual([expect.objectContaining({ type: 'vm-fire' })]);

        available = true;
        await expect(relay.flush()).resolves.toEqual(expect.objectContaining({ failed: false }));
        expect(sent).toHaveLength(256);
        expect(sent[0].payload.index).toBe(0);
        expect(sent.at(-1).payload.index).toBe(255);
    });
});
