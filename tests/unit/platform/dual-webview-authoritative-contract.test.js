import { createRenderSurfaceCommandRelay } from '../../../src/app/platform/render-surface/command-buffer.js';
import { createRenderSurfaceEventRelay } from '../../../src/app/platform/render-surface/event-relay.js';
import { createRenderSurfaceProtocol } from '../../../src/app/platform/render-surface/protocol.js';
import { createViewModelCommands } from '../../../src/app/platform/mcp/commands/view-model.js';
import {
    dispatchPresentationChanged,
    dispatchVmControlMutation,
} from '../../../src/app/rive/control-events.js';
import { createRemoteControlsAdapter } from '../../../src/app/rive/view-model/remote/controls.js';

const SESSION_ID = 'visible-child';
const STALE_SESSION_ID = 'retired-child';

function control(kind, name, valueOrExtra) {
    const descriptor = { kind, name, path: name, source: 'view-model' };
    const input = { ...descriptor, descriptor };
    if (kind === 'image') return { ...input, present: Boolean(valueOrExtra), metadata: null };
    if (kind === 'trigger') return { ...input, receipt: Number(valueOrExtra) || 0 };
    return { ...input, value: valueOrExtra };
}

function stateMachineControl(kind, name, valueOrExtra) {
    const descriptor = {
        kind,
        name,
        path: `MainSM/${name}`,
        source: 'state-machine',
        stateMachineName: 'MainSM',
    };
    const input = { ...descriptor, descriptor };
    if (kind === 'trigger') return { ...input, receipt: Number(valueOrExtra) || 0 };
    return { ...input, value: valueOrExtra };
}

function initialState(sessionId = SESSION_ID) {
    return {
        artboard: 'Dashboard',
        controlsHierarchy: {
            children: [{
                children: [],
                inputs: [
                    control('boolean', 'enabled', false),
                    control('number', 'speed', 12),
                    control('trigger', 'refresh', 0),
                    control('image', 'logo', false),
                    stateMachineControl('boolean', 'armed', false),
                    stateMachineControl('number', 'level', 1),
                    stateMachineControl('trigger', 'launch', 0),
                ],
                kind: 'vm',
                label: 'Dashboard VM',
                path: '<root>',
            }],
            inputs: [],
            kind: 'controls',
            label: 'Controls',
            path: '<controls>',
        },
        revision: 1,
        sessionId,
        stateRevision: 1,
        stateType: 'snapshot',
        topologyRevision: 1,
        vmInstance: { availableKeys: ['Dashboard-primary'], key: 'Dashboard-primary', name: 'Dashboard-primary' },
    };
}

function inputByPath(state, path) {
    return state.controlsHierarchy.children[0].inputs.find((input) => input.path === path);
}

function createAuthoritativeChild({ onAck } = {}) {
    let lastCommandRevision = 0;
    let state = initialState();

    function apply(command) {
        if (command.sessionId !== SESSION_ID) {
            return { applied: false, message: 'Wrong render-surface session.', status: 'rejected' };
        }
        if (command.revision <= lastCommandRevision) {
            return { applied: false, message: 'Stale render-surface command revision.', status: 'rejected' };
        }
        lastCommandRevision = command.revision;
        const payload = command.payload || {};
        if (command.type === 'presentation') {
            return { applied: true, status: 'applied' };
        }
        const descriptor = payload.descriptor || payload;
        const input = inputByPath(state, descriptor.path);
        if (!input) return { applied: false, message: 'Unknown child control.', status: 'rejected' };

        state = { ...state, revision: state.stateRevision + 1, stateRevision: state.stateRevision + 1 };
        const change = {
            key: input.source === 'state-machine'
                ? `sm:${input.stateMachineName}:${input.name}:${input.kind}`
                : `vm:${input.path}:${input.kind}`,
            kind: input.kind,
            ...(input.source === 'state-machine' ? {
                name: input.name,
                source: input.source,
                stateMachineName: input.stateMachineName,
            } : {}),
        };
        if (command.type === 'vm-fire' || command.type === 'sm-fire') {
            input.receipt += 1;
            change.receipt = input.receipt;
        } else if (command.type === 'vm-image-set') {
            input.present = payload.action !== 'clear';
            input.metadata = input.present ? { source: 'harness-image' } : null;
            change.present = input.present;
            change.metadata = input.metadata;
        } else {
            input.value = payload.value;
            change.value = input.value;
        }
        return {
            applied: true,
            canonicalDelta: {
                controlChanges: [change],
                revision: state.revision,
                sessionId: SESSION_ID,
                stateRevision: state.stateRevision,
                stateType: 'delta',
                topologyRevision: state.topologyRevision,
            },
            status: 'applied',
        };
    }

    return {
        getState: () => state,
        receive(command) {
            const result = apply(command);
            onAck?.({
                ...result,
                commandId: command.commandId,
                requestedRevision: command.revision,
                sessionId: command.sessionId,
            });
            return result;
        },
    };
}

function createHarness() {
    const receivedCommands = [];
    let protocol;
    const child = createAuthoritativeChild({ onAck: (payload) => protocol.handleAck({ payload }) });
    protocol = createRenderSurfaceProtocol({
        canSend: (sessionId) => sessionId === SESSION_ID,
        documentRef: document,
        invokeQuietly: vi.fn(async (_command, args) => {
            receivedCommands.push(args.payload);
            child.receive(args.payload);
            return true;
        }),
        windowRef: window,
    });
    protocol.beginSession(SESSION_ID, 2);
    protocol.handleState({ payload: initialState() });
    protocol.activateSession(SESSION_ID);

    const remote = createRemoteControlsAdapter({
        getCanonicalState: () => protocol.getState().canonicalState,
    });
    const relay = createRenderSurfaceCommandRelay({ canSend: () => true, send: protocol.sendCommand });
    const eventRelay = createRenderSurfaceEventRelay({ commandRelay: relay, documentRef: document });
    eventRelay.setup();
    return { child, eventRelay, protocol, receivedCommands, relay, remote };
}

describe('dual-WebView authoritative child contract', () => {
    it('forwards each horizontal alignment token unchanged to the visible child', async () => {
        const harness = createHarness();
        const alignments = ['centerLeft', 'center', 'centerRight'];

        for (const layoutAlignment of alignments) {
            dispatchPresentationChanged(document, { layoutAlignment, layoutFit: 'contain' });
            await harness.relay.whenIdle();
        }

        const presentationCommands = harness.receivedCommands
            .filter((command) => command.type === 'presentation');
        expect(presentationCommands.map((command) => command.payload.layoutAlignment)).toEqual(alignments);
        expect(presentationCommands.map((command) => command.payload.layoutFit)).toEqual([
            'contain',
            'contain',
            'contain',
        ]);
        harness.eventRelay.dispose();
    });

    it('round-trips UI scalar, trigger, and image mutations through ACK canonical deltas without changing selection', async () => {
        const harness = createHarness();
        const descriptor = (kind, path) => ({ kind, name: path, path, source: 'view-model' });

        dispatchVmControlMutation(document, { descriptor: descriptor('boolean', 'enabled'), kind: 'boolean', value: true });
        dispatchVmControlMutation(document, { descriptor: descriptor('number', 'speed'), kind: 'number', value: 88 });
        dispatchVmControlMutation(document, { action: 'fire', descriptor: descriptor('trigger', 'refresh'), kind: 'trigger' });
        dispatchVmControlMutation(document, { action: 'set', descriptor: descriptor('image', 'logo'), kind: 'image', value: 'data:image/png;base64,AA==' });
        await harness.relay.whenIdle();

        expect(harness.receivedCommands.map((command) => command.type)).toEqual([
            'vm-set', 'vm-set', 'vm-fire', 'vm-image-set',
        ]);
        expect(harness.receivedCommands.map((command) => command.revision)).toEqual([1, 2, 3, 4]);
        expect(harness.receivedCommands[3].payload).toEqual(expect.objectContaining({
            action: 'set', kind: 'image', path: 'logo', value: 'data:image/png;base64,AA==',
        }));

        expect(harness.remote.resolveAccessor(descriptor('boolean', 'enabled')).value).toBe(true);
        expect(harness.remote.resolveAccessor(descriptor('number', 'speed')).value).toBe(88);
        expect(harness.remote.resolveAccessor(descriptor('trigger', 'refresh')).receipt).toBe(1);
        const image = harness.remote.getHierarchy().children[0].inputs.find((input) => input.path === 'logo');
        expect(image).toEqual(expect.objectContaining({ metadata: { source: 'harness-image' }, present: true }));

        expect(harness.protocol.getState().canonicalState).toEqual(expect.objectContaining({
            artboard: 'Dashboard',
            sessionId: SESSION_ID,
            vmInstance: expect.objectContaining({ key: 'Dashboard-primary' }),
        }));
        harness.eventRelay.dispose();
    });

    it('uses the same acknowledged canonical flow for MCP boolean, number, and trigger commands', async () => {
        const harness = createHarness();
        const controller = {
            getCanonicalState: () => harness.protocol.getState().canonicalState,
            getState: () => ({ activeSessionId: SESSION_ID, isLoaded: true }),
            requestCommand: harness.protocol.requestCommand,
        };
        const commands = createViewModelCommands({
            renderSurfaceController: controller,
            windowRef: { __TAURI__: {}, riveInst: { viewModelInstance: null } },
        });

        await expect(commands.rav_vm_set({ path: 'enabled', value: true }))
            .resolves.toEqual(expect.objectContaining({ applied: true, kind: 'boolean', value: true }));
        await expect(commands.rav_vm_set({ path: 'speed', value: 33 }))
            .resolves.toEqual(expect.objectContaining({ applied: true, kind: 'number', value: 33 }));
        await expect(commands.rav_vm_fire({ path: 'refresh' }))
            .resolves.toEqual(expect.objectContaining({ applied: true, kind: 'trigger' }));

        expect(harness.receivedCommands.map((command) => command.type)).toEqual(['vm-set', 'vm-set', 'vm-fire']);
        expect(harness.remote.resolveAccessor({ kind: 'number', path: 'speed', source: 'view-model' }).value).toBe(33);
        expect(harness.remote.resolveAccessor({ kind: 'trigger', path: 'refresh', source: 'view-model' }).receipt).toBe(1);
        harness.eventRelay.dispose();
    });

    it('round-trips state-machine boolean, number, and trigger writes only through authoritative ACK deltas', async () => {
        const harness = createHarness();
        const descriptor = (kind, name) => ({
            kind,
            name,
            path: `MainSM/${name}`,
            source: 'state-machine',
            stateMachineName: 'MainSM',
        });

        dispatchVmControlMutation(document, {
            descriptor: descriptor('boolean', 'armed'), kind: 'boolean', value: true,
        });
        dispatchVmControlMutation(document, {
            descriptor: descriptor('number', 'level'), kind: 'number', value: 7,
        });
        dispatchVmControlMutation(document, {
            action: 'fire', descriptor: descriptor('trigger', 'launch'), kind: 'trigger',
        });
        await harness.relay.whenIdle();

        expect(harness.receivedCommands.map((command) => command.type)).toEqual([
            'sm-set', 'sm-set', 'sm-fire',
        ]);
        expect(harness.remote.resolveAccessor(descriptor('boolean', 'armed')).value).toBe(true);
        expect(harness.remote.resolveAccessor(descriptor('number', 'level')).value).toBe(7);
        expect(harness.remote.resolveAccessor(descriptor('trigger', 'launch')).receipt).toBe(1);

        const acceptedRevision = harness.protocol.getState().canonicalState.stateRevision;
        harness.protocol.handleState({ payload: {
            controlChanges: [{
                key: 'sm:MainSM:level:number',
                kind: 'number',
                name: 'level',
                source: 'state-machine',
                stateMachineName: 'MainSM',
                value: -1,
            }],
            sessionId: SESSION_ID,
            stateRevision: acceptedRevision - 1,
            stateType: 'delta',
            topologyRevision: 1,
        } });
        expect(harness.remote.resolveAccessor(descriptor('number', 'level')).value).toBe(7);

        const before = harness.receivedCommands.length;
        const rejected = await harness.protocol.requestCommand('sm-fire', descriptor('trigger', 'launch'), {
            targetSessionId: STALE_SESSION_ID,
        });
        expect(rejected).toEqual(expect.objectContaining({ applied: false, status: 'unavailable' }));
        expect(harness.receivedCommands).toHaveLength(before);
        expect(harness.remote.resolveAccessor(descriptor('trigger', 'launch')).receipt).toBe(1);
        harness.eventRelay.dispose();
    });

    it('rejects stale child commands and ignores stale session or revision state without losing visible selection', async () => {
        const harness = createHarness();
        const fresh = harness.protocol.requestCommand('vm-set', {
            descriptor: { kind: 'number', name: 'speed', path: 'speed', source: 'view-model' },
            value: 20,
        });
        await expect(fresh).resolves.toEqual(expect.objectContaining({ applied: true, status: 'applied' }));
        const acceptedRevision = harness.protocol.getState().canonicalState.stateRevision;
        const duplicate = harness.child.receive(harness.receivedCommands[0]);
        expect(duplicate).toEqual(expect.objectContaining({
            applied: false,
            message: 'Stale render-surface command revision.',
            status: 'rejected',
        }));

        // Simulates a delayed publication from a retired child, then an older
        // revision from the active child. Neither may overwrite visible truth.
        harness.protocol.handleState({ payload: {
            ...initialState(STALE_SESSION_ID), artboard: 'Wrong artboard', revision: 99, stateRevision: 99,
        } });
        harness.protocol.handleState({ payload: {
            controlChanges: [{ key: 'vm:speed:number', kind: 'number', value: -1 }],
            sessionId: SESSION_ID,
            stateRevision: acceptedRevision - 1,
            stateType: 'delta',
            topologyRevision: 1,
        } });

        expect(harness.protocol.getState().canonicalState).toEqual(expect.objectContaining({
            artboard: 'Dashboard',
            stateRevision: acceptedRevision,
            vmInstance: expect.objectContaining({ key: 'Dashboard-primary' }),
        }));
        expect(harness.remote.resolveAccessor({ kind: 'number', path: 'speed', source: 'view-model' }).value).toBe(20);

        const before = harness.receivedCommands.length;
        const staleResult = await harness.protocol.requestCommand('vm-set', {
            descriptor: { kind: 'number', name: 'speed', path: 'speed', source: 'view-model' },
            value: 21,
        }, { targetSessionId: STALE_SESSION_ID });
        expect(staleResult).toEqual(expect.objectContaining({ applied: false, status: 'unavailable' }));
        expect(harness.receivedCommands).toHaveLength(before);
        harness.eventRelay.dispose();
    });
});
