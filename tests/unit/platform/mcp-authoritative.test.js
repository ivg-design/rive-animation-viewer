import { createStatusPlaybackCommands } from '../../../src/app/platform/mcp/commands/status-playback.js';
import { createViewModelCommands } from '../../../src/app/platform/mcp/commands/view-model.js';
import { createGlobalViewModelCommands } from '../../../src/app/platform/mcp/commands/global-view-model.js';
import { createVmInstanceCommands } from '../../../src/app/platform/mcp/commands/vm-instance.js';

function makeCanonical() {
    return {
        revision: 4,
        stateRevision: 4,
        topologyRevision: 2,
        artboard: 'Visible',
        playback: { type: 'animation', name: 'Timeline', isPlaying: true, isPaused: false },
        vmInstance: { key: 'Board' },
        controlsHierarchy: {
            label: 'Controls',
            path: '<controls>',
            inputs: [],
            children: [{
                label: 'Root VM',
                path: '<root>',
                kind: 'vm',
                inputs: [{
                    descriptor: { kind: 'number', name: 'speed', path: 'speed', source: 'view-model' },
                    kind: 'number',
                    name: 'speed',
                    path: 'speed',
                    source: 'view-model',
                    value: 3,
                }, {
                    descriptor: { kind: 'image', name: 'image1', path: 'image1', source: 'view-model' },
                    kind: 'image', metadata: null, name: 'image1', path: 'image1', present: false, source: 'view-model',
                }],
                children: [],
            }],
        },
    };
}

function makeHarness(requestCommand = vi.fn()) {
    const canonicalState = makeCanonical();
    const controller = {
        getCanonicalState: vi.fn(() => canonicalState),
        getState: vi.fn(() => ({ activeSessionId: 'session-1', isLoaded: true, surfaceCreated: true })),
        requestCommand,
    };
    const windowRef = {
        __TAURI__: {},
        _mcpGetRenderSurfaceController: () => controller,
        riveInst: { isPlaying: false, viewModelInstance: null },
    };
    return { canonicalState, controller, windowRef };
}

describe('platform/mcp authoritative render-surface contract', () => {
    it('scopes named global ViewModel reads and writes to the acknowledged child hierarchy', async () => {
        const requestCommand = vi.fn(async () => ({ applied: true, status: 'applied' }));
        const harness = makeHarness(requestCommand);
        harness.canonicalState.controlsHierarchy.children.unshift({
            kind: 'global-view-models', label: 'Global VM', path: '__global_view_models__', inputs: [],
            children: [{
                kind: 'vm', label: 'GlobalLabels', globalViewModelName: 'GlobalLabels', path: '', children: [],
                inputs: [{
                    kind: 'string', name: 'label', path: 'label', source: 'global-view-model',
                    globalViewModelName: 'GlobalLabels', value: 'Live',
                    descriptor: {
                        kind: 'string', name: 'label', path: 'label', source: 'global-view-model',
                        globalViewModelName: 'GlobalLabels',
                    },
                }, {
                    kind: 'image', name: 'avatar', path: 'avatar', source: 'global-view-model',
                    globalViewModelName: 'GlobalLabels', metadata: null, present: false,
                    descriptor: {
                        kind: 'image', name: 'avatar', path: 'avatar', source: 'global-view-model',
                        globalViewModelName: 'GlobalLabels',
                    },
                }],
            }],
        });
        const commands = {
            ...createViewModelCommands({ windowRef: harness.windowRef }),
            ...createGlobalViewModelCommands({ windowRef: harness.windowRef }),
        };

        await expect(commands.rav_get_global_vm_tree()).resolves.toEqual(expect.objectContaining({
            count: 1, names: ['GlobalLabels'],
        }));
        await expect(commands.rav_global_vm_get({ name: 'GlobalLabels', path: 'label' })).resolves.toEqual({
            name: 'GlobalLabels', path: 'label', kind: 'string', value: 'Live',
        });
        await commands.rav_global_vm_set({ name: 'GlobalLabels', path: 'label', value: 'Changed' });
        expect(requestCommand).toHaveBeenCalledWith('vm-set', {
            descriptor: expect.objectContaining({
                source: 'global-view-model', globalViewModelName: 'GlobalLabels', path: 'label',
            }),
            value: 'Changed',
        }, {});
        await expect(commands.rav_global_vm_set_image({
            name: 'GlobalLabels', path: 'avatar', bytes: [137, 80, 78, 71], label: 'Avatar',
        })).resolves.toEqual(expect.objectContaining({
            applied: true, name: 'GlobalLabels', path: 'avatar', present: false, status: 'applied',
        }));
        expect(requestCommand).toHaveBeenCalledWith('vm-image-set', expect.objectContaining({
            action: 'set-image',
            descriptor: expect.objectContaining({
                kind: 'image', source: 'global-view-model', globalViewModelName: 'GlobalLabels', path: 'avatar',
            }),
            imageSelection: { kind: 'file', label: 'Avatar' },
            value: [137, 80, 78, 71],
        }), {});
        await commands.rav_global_vm_clear_image({ name: 'GlobalLabels', path: 'avatar' });
        expect(requestCommand).toHaveBeenCalledWith('vm-image-set', expect.objectContaining({
            action: 'clear-image',
            descriptor: expect.objectContaining({
                source: 'global-view-model', globalViewModelName: 'GlobalLabels', path: 'avatar',
            }),
            imageSelection: null,
            value: null,
        }), {});
        await expect(commands.rav_vm_get({ path: 'label' })).rejects.toThrow('not found or not readable');
    });

    it('reads visible canonical values instead of the hidden parent runtime', async () => {
        const harness = makeHarness();
        const commands = createViewModelCommands({ windowRef: harness.windowRef });

        await expect(commands.rav_vm_get({ path: 'speed' })).resolves.toEqual({
            path: 'speed',
            kind: 'number',
            value: 3,
        });
        await expect(commands.rav_get_vm_tree()).resolves.toEqual(expect.objectContaining({
            paths: ['speed', 'image1'],
        }));
    });

    it.each([
        ['rejected', { applied: false, status: 'rejected', message: 'stale topology' }],
        ['timeout', { applied: false, status: 'timeout' }],
    ])('returns %s without optimistic success', async (_label, commandResult) => {
        const requestCommand = vi.fn(async () => commandResult);
        const harness = makeHarness(requestCommand);
        const commands = createViewModelCommands({ windowRef: harness.windowRef });

        await expect(commands.rav_vm_set({ path: 'speed', value: 9 })).resolves.toEqual(expect.objectContaining({
            applied: false,
            path: 'speed',
            status: commandResult.status,
        }));
        expect(requestCommand).toHaveBeenCalledWith('vm-set', expect.objectContaining({
            descriptor: expect.objectContaining({ path: 'speed', kind: 'number' }),
            value: 9,
        }), {});
    });

    it.each([
        ['signed int32', -16777216, 4278190080],
        ['unsigned uint32', 4278190080, 4278190080],
    ])('normalizes %s ViewModel colors for the remote command and preserves signed canonical readback', async (
        _label, value, expectedCommandValue,
    ) => {
        const requestCommand = vi.fn(async () => ({ applied: true, status: 'applied' }));
        const harness = makeHarness(requestCommand);
        harness.canonicalState.controlsHierarchy.children[0].inputs.push({
            kind: 'color', name: 'color', path: 'color', source: 'view-model', value: -16777216,
        });
        const commands = createViewModelCommands({ windowRef: harness.windowRef });

        await expect(commands.rav_vm_set({ path: 'color', value })).resolves.toEqual(expect.objectContaining({
            applied: true, kind: 'color', path: 'color', value: -16777216,
        }));
        expect(requestCommand).toHaveBeenCalledWith('vm-set', expect.objectContaining({
            descriptor: expect.objectContaining({ kind: 'color', path: 'color' }),
            value: expectedCommandValue,
        }), {});
    });

    it.each([Number.NaN, 1.5, -(2 ** 31) - 1, 2 ** 32])(
        'rejects invalid color value %s before sending a remote command',
        async (value) => {
            const requestCommand = vi.fn();
            const harness = makeHarness(requestCommand);
            harness.canonicalState.controlsHierarchy.children[0].inputs.push({
                kind: 'color', name: 'color', path: 'color', source: 'view-model', value: -16777216,
            });
            const commands = createViewModelCommands({ windowRef: harness.windowRef });

            await expect(commands.rav_vm_set({ path: 'color', value }))
                .rejects.toThrow('Color value must be an integer from -2147483648 through 4294967295');
            expect(requestCommand).not.toHaveBeenCalled();
        },
    );

    it('sets and clears image properties through acknowledged authoritative commands', async () => {
        const requestCommand = vi.fn(async (_type, payload) => ({
            applied: true,
            status: 'applied',
            canonicalState: {
                ...makeCanonical(),
                controlsHierarchy: {
                    ...makeCanonical().controlsHierarchy,
                    children: [{
                        ...makeCanonical().controlsHierarchy.children[0],
                        inputs: [{
                            kind: 'image', metadata: payload.action === 'clear-image' ? null : payload.imageSelection,
                            name: 'image1', path: 'image1', present: payload.action !== 'clear-image', source: 'view-model',
                        }],
                    }],
                },
            },
        }));
        const harness = makeHarness(requestCommand);
        const requestImageCommand = vi.fn((payload) => requestCommand('vm-image-set', payload));
        harness.controller.requestImageCommand = requestImageCommand;
        const commands = createViewModelCommands({ windowRef: harness.windowRef });

        await expect(commands.rav_vm_set_image({ path: 'image1', bytes: [137, 80, 78, 71], label: 'pixel.png' }))
            .resolves.toEqual({ applied: true, metadata: { kind: 'file', label: 'pixel.png' }, path: 'image1', present: true, status: 'applied' });
        expect(requestImageCommand).toHaveBeenLastCalledWith(expect.objectContaining({
            action: 'set-image', kind: 'image', path: 'image1', value: [137, 80, 78, 71],
            descriptor: expect.objectContaining({ kind: 'image', path: 'image1' }),
        }), {});
        expect(requestCommand.mock.calls.at(-1)[1]).toBe(requestImageCommand.mock.calls.at(-1)[0]);

        await expect(commands.rav_vm_clear_image({ path: 'image1' }))
            .resolves.toEqual({ applied: true, metadata: null, path: 'image1', present: false, status: 'applied' });
        expect(requestImageCommand).toHaveBeenLastCalledWith(expect.objectContaining({
            action: 'clear-image', kind: 'image', value: null,
        }), {});
        expect(requestCommand.mock.calls.at(-1)[1]).toBe(requestImageCommand.mock.calls.at(-1)[0]);
    });

    it.each([
        [[], 'non-empty byte array'],
        [[-1], 'integers from 0 through 255'],
        [[256], 'integers from 0 through 255'],
        [[1.5], 'integers from 0 through 255'],
    ])('rejects invalid MCP image bytes before transport: %j', async (bytes, message) => {
        const requestCommand = vi.fn();
        const harness = makeHarness(requestCommand);
        const commands = createViewModelCommands({ windowRef: harness.windowRef });
        await expect(commands.rav_vm_set_image({ path: 'image1', bytes })).rejects.toThrow(message);
        expect(requestCommand).not.toHaveBeenCalled();
    });

    it('reports canonical playback state and does not report the hidden parent as playing', async () => {
        const harness = makeHarness();
        const commands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: false, paths: [] }),
            documentRef: document,
            windowRef: harness.windowRef,
        });

        await expect(commands.rav_status()).resolves.toEqual(expect.objectContaining({
            playback: expect.objectContaining({ isPlaying: true, name: 'Timeline' }),
            artboard: expect.objectContaining({ currentArtboard: 'Visible' }),
            viewModel: expect.objectContaining({
                availableInstanceKeys: expect.any(Array),
                instanceKey: 'Board',
                pathCount: 2,
            }),
        }));
    });

    it.each(['auto', '__rav_auto_bound__'])(
        'switches %s back to authoritative auto-bound instance selection',
        async (requestedInstance) => {
        const harness = makeHarness();
        harness.windowRef._mcpSwitchVmInstance = vi.fn(async (key) => {
            expect(key).toBe('__rav_auto_bound__');
            harness.canonicalState.vmInstance.key = null;
        });
        const commands = createVmInstanceCommands({ windowRef: harness.windowRef });

        await expect(commands.rav_switch_vm_instance({ instance: requestedInstance })).resolves.toEqual({
            applied: true,
            instanceKey: null,
            status: 'applied',
        });
        },
    );

    it.each([
        ['named instance', 'Board 2'],
        ['zero-based runtime instance', 0],
    ])('switches and verifies the authoritative %s key', async (_label, requestedKey) => {
        const harness = makeHarness();
        harness.windowRef._mcpSwitchVmInstance = vi.fn(async (key) => {
            harness.canonicalState.vmInstance.key = key;
        });
        const commands = createVmInstanceCommands({ windowRef: harness.windowRef });

        await expect(commands.rav_switch_vm_instance({ instance: requestedKey })).resolves.toEqual({
            applied: true,
            instanceKey: String(requestedKey),
            status: 'applied',
        });
        expect(harness.windowRef._mcpSwitchVmInstance).toHaveBeenCalledWith(String(requestedKey));
    });

    it('fails closed when the visible child does not confirm the requested instance', async () => {
        const harness = makeHarness();
        harness.windowRef._mcpSwitchVmInstance = vi.fn(async () => {});
        const commands = createVmInstanceCommands({ windowRef: harness.windowRef });

        await expect(commands.rav_switch_vm_instance({ instance: 'Missing' })).resolves.toEqual({
            applied: false,
            instanceKey: 'Board',
            status: 'rejected',
        });
    });

    it('rejects an artboard switch when the child does not confirm the requested playback target', async () => {
        const harness = makeHarness();
        harness.canonicalState.animationNames = ['Missing'];
        harness.canonicalState.artboards = ['Visible'];
        harness.windowRef._mcpSwitchArtboard = vi.fn(async () => {});
        const commands = createStatusPlaybackCommands({ documentRef: document, windowRef: harness.windowRef });

        await expect(commands.rav_switch_artboard({ artboard: 'Visible', playback: 'anim:Missing' }))
            .resolves.toEqual(expect.objectContaining({ applied: false, status: 'rejected' }));
    });

    it('rejects an unknown playback before dispatch even when the child would echo it', async () => {
        const harness = makeHarness();
        harness.canonicalState.animationNames = ['Timeline'];
        harness.canonicalState.artboards = ['Visible'];
        harness.windowRef._mcpSwitchArtboard = vi.fn(async (_artboard, playback) => {
            harness.canonicalState.playback = {
                type: 'animation', name: String(playback).slice(5), isPlaying: true, isPaused: false,
            };
        });
        const commands = createStatusPlaybackCommands({ documentRef: document, windowRef: harness.windowRef });

        await expect(commands.rav_switch_artboard({ artboard: 'Visible', playback: 'anim:Definitely Missing' }))
            .rejects.toThrow('Animation "Definitely Missing" was not found on artboard "Visible"');
        expect(harness.windowRef._mcpSwitchArtboard).not.toHaveBeenCalled();
    });

    it('rejects a playback type mismatch before dispatch', async () => {
        const harness = makeHarness();
        harness.canonicalState.animationNames = ['Shared'];
        harness.canonicalState.stateMachines = ['Machine'];
        harness.canonicalState.artboards = ['Visible'];
        harness.windowRef._mcpSwitchArtboard = vi.fn();
        const commands = createStatusPlaybackCommands({ documentRef: document, windowRef: harness.windowRef });

        await expect(commands.rav_switch_artboard({ artboard: 'Visible', playback: 'sm:Shared' }))
            .rejects.toThrow('State machine "Shared" was not found on artboard "Visible"');
        expect(harness.windowRef._mcpSwitchArtboard).not.toHaveBeenCalled();
    });

    it('includes canonical timeline totals in status for the timecode panel', async () => {
        const harness = makeHarness();
        harness.canonicalState.playback = {
            currentFrame: 18,
            currentSeconds: 0.6,
            durationSeconds: 2,
            fps: 30,
            isPaused: false,
            isPlaying: true,
            name: 'Timeline',
            totalFrames: 60,
            totalSeconds: 2,
            type: 'animation',
        };
        const commands = createStatusPlaybackCommands({ documentRef: document, windowRef: harness.windowRef });

        await expect(commands.rav_status()).resolves.toEqual(expect.objectContaining({
            playback: expect.objectContaining({
                currentFrame: 18,
                currentSeconds: 0.6,
                durationSeconds: 2,
                fps: 30,
                totalFrames: 60,
                totalSeconds: 2,
            }),
        }));
    });

    it('reports the live transparent canvas state instead of the color input history', async () => {
        const harness = makeHarness();
        document.body.innerHTML = '<input id="canvas-color-input" value="#123456">';
        const commands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: false, paths: [] }),
            documentRef: document,
            getCanvasBackgroundStateSnapshot: () => ({ canvasColor: 'transparent', canvasTransparent: true }),
            windowRef: harness.windowRef,
        });

        await expect(commands.rav_status()).resolves.toEqual(expect.objectContaining({
            layout: expect.objectContaining({ canvasColor: 'transparent', canvasTransparent: true }),
        }));
    });

    it.each([
        ['named', 'Board', 'Board', false],
        ['runtime list index', 0, 0, false],
        ['auto', null, null, true],
    ])('resets the visible child with %s instance selection and a canonical scalar snapshot', async (
        _label,
        instanceKey,
        expectedKey,
        expectedAutoBind,
    ) => {
        const requestCommand = vi.fn(async (_type, _payload) => ({ applied: true, status: 'applied' }));
        const harness = makeHarness(requestCommand);
        harness.canonicalState.vmInstance.key = instanceKey;
        const commands = createStatusPlaybackCommands({ documentRef: document, windowRef: harness.windowRef });

        await expect(commands.rav_reset()).resolves.toEqual(expect.objectContaining({ applied: true }));
        expect(requestCommand).toHaveBeenCalledWith('reset', {
            params: expect.objectContaining({
                animations: 'Timeline',
                artboard: 'Visible',
                autoBind: expectedAutoBind,
                autoplay: true,
                stateMachines: undefined,
                viewModelInstanceName: expectedKey,
            }),
            snapshot: [{
                descriptor: expect.objectContaining({ kind: 'number', path: 'speed' }),
                kind: 'number',
                value: 3,
            }],
        }, {});
    });

    it('fails closed in Tauri when no acknowledged visible-surface controller exists', async () => {
        const commands = createViewModelCommands({
            windowRef: { __TAURI__: {}, riveInst: { viewModelInstance: {} } },
        });
        await expect(commands.rav_vm_get({ path: 'speed' }))
            .rejects.toThrow('Visible render surface canonical controller is unavailable');
    });

    it('keeps rav_status read-only and reports staged surface health while authority is unavailable', async () => {
        const canonicalState = makeCanonical();
        const controller = {
            getCanonicalState: vi.fn(() => canonicalState),
            getState: vi.fn(() => ({
                activeSessionId: null,
                activatingSessionId: 'staged-2',
                canonicalState: null,
                isLoaded: false,
                pendingCommands: 2,
                sessionId: 'staged-2',
                stagedReady: true,
                surfaceCreated: true,
            })),
            requestCommand: vi.fn(),
        };
        const windowRef = {
            __TAURI__: {},
            _mcpGetRenderSurfaceController: () => controller,
            __riveAnimationCache: { getBuffer: () => new ArrayBuffer(8), getName: () => 'staged.riv' },
            riveInst: { isPlaying: true, viewModelInstance: {} },
        };
        const statusCommands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: true, paths: ['hidden-parent-value'] }),
            documentRef: document,
            windowRef,
        });
        const viewModelCommands = createViewModelCommands({
            buildViewModelSnapshot: () => ({ hasRoot: true, paths: ['hidden-parent-value'] }),
            documentRef: document,
            windowRef,
        });

        await expect(statusCommands.rav_status()).resolves.toEqual(expect.objectContaining({
            file: expect.objectContaining({ loaded: false }),
            playback: expect.objectContaining({ isPlaying: false, isPaused: true }),
            viewModel: { availableInstanceKeys: [], hasRoot: false, instanceKey: null, pathCount: 0 },
            artboard: null,
            renderSurface: expect.objectContaining({
                active: false,
                activeSessionId: null,
                activatingSessionId: 'staged-2',
                health: 'staged',
                sessionId: 'staged-2',
                stagedReady: true,
                stagedSessionId: 'staged-2',
            }),
        }));
        await expect(statusCommands.rav_play()).rejects.toThrow('Visible render surface canonical controller is unavailable');
        await expect(viewModelCommands.rav_vm_set({ path: 'speed', value: 9 }))
            .rejects.toThrow('Visible render surface canonical controller is unavailable');
        expect(controller.requestCommand).not.toHaveBeenCalled();
    });
});
