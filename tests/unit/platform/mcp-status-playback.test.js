import { createStatusPlaybackCommands } from '../../../src/app/platform/mcp/commands/status-playback.js';
import { createViewModelCommands } from '../../../src/app/platform/mcp/commands/view-model.js';
import { setInspectionMetadata } from '../../../src/app/rive/runtime-compatibility.js';

describe('platform/mcp/status-playback', () => {
    it('routes anonymous usage changes through the installed preference controller', async () => {
        const setEnabled = vi.fn(async () => true);
        const commands = createStatusPlaybackCommands({
            documentRef: document,
            windowRef: { _mcpSetInstallCounterEnabled: setEnabled },
        });

        await expect(commands.rav_set_anonymous_usage({ enabled: false })).resolves.toEqual({
            applied: true,
            enabled: false,
            status: 'applied',
        });
        expect(setEnabled).toHaveBeenCalledWith(false);
    });

    it('reports a bounded render-surface identity for live regression checks', async () => {
        document.body.innerHTML = `
            <select id="runtime-select"><option value="webgl2" selected>WebGL2</option></select>
            <select id="layout-select"><option value="contain" selected>Contain</option></select>
            <select id="alignment-select"><option value="center" selected>Center</option></select>
            <input id="canvas-color-input" value="#0d1117">
        `;
        const windowRef = {
            __RAV_BUILD_INFO__: {
                build: 'b0217-20260827-TEST-645bfa9',
                channel: 'dev',
                version: '2.5.2',
            },
            __riveAnimationCache: {
                getBuffer: () => new ArrayBuffer(12),
                getName: () => 'demo.riv',
            },
            __riveRuntimeCache: { getRuntimeVersion: () => '2.40.1' },
            _mcpGetArtboardState: () => ({ currentArtboard: 'Main' }),
            _mcpGetCanvasSizing: () => ({ mode: 'fixed', width: 960, height: 540 }),
            _mcpGetLiveConfigState: () => ({ draftDirty: false, sourceMode: 'internal' }),
            _mcpGetRenderSurfaceState: () => ({
                isLoaded: true,
                isSetup: true,
                pendingCommands: 0,
                sessionId: 'surface-1',
                surfaceCreated: true,
            }),
            riveInst: { isPlaying: true, isStopped: false },
        };
        const commands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: true, paths: ['speed'] }),
            documentRef: document,
            windowRef,
        });

        await expect(commands.rav_status()).resolves.toEqual(expect.objectContaining({
            app: {
                build: 'b0217-20260827-TEST-645bfa9',
                channel: 'dev',
                version: '2.5.2',
            },
            renderSurface: {
                active: true,
                isLoaded: true,
                pendingCommands: 0,
                sessionId: 'surface-1',
                surfaceCreated: true,
            },
        }));
    });

    it('reports null when the dedicated surface is unavailable', async () => {
        const commands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: false, paths: [] }),
            documentRef: document,
            windowRef: {},
        });

        await expect(commands.rav_status()).resolves.toEqual(expect.objectContaining({
            renderSurface: null,
        }));
    });

    it('reports completed direct timeline authority without falling back to the residual state machine', async () => {
        const canonicalState = {
            artboard: 'TrackMap',
            playback: {
                currentFrame: 60,
                currentSeconds: 1,
                fps: 60,
                isPaused: true,
                isPlaying: false,
                name: 'Focus Fullscreen Mode',
                totalFrames: 60,
                totalSeconds: 1,
                type: 'animation',
            },
        };
        const renderSurfaceController = {
            getCanonicalState: () => canonicalState,
            getState: () => ({ activeSessionId: 'surface-1', isLoaded: true, surfaceCreated: true }),
            requestCommand: vi.fn(),
        };
        const commands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: false, paths: [] }),
            documentRef: document,
            renderSurfaceController,
            windowRef: {},
        });

        await expect(commands.rav_status()).resolves.toEqual(expect.objectContaining({
            artboard: expect.objectContaining({
                currentArtboard: 'TrackMap',
                currentPlaybackName: 'Focus Fullscreen Mode',
                currentPlaybackType: 'animation',
            }),
            playback: expect.objectContaining({
                currentFrame: 60,
                isPaused: true,
                name: 'Focus Fullscreen Mode',
                totalFrames: 60,
                type: 'animation',
            }),
        }));
    });

    it('uses inspected cross-WebView metadata to reject an unknown target before child staging', async () => {
        const hiddenParentInstance = { isPlaying: false };
        setInspectionMetadata(hiddenParentInstance, {
            artboards: [{
                name: 'LowerThird',
                animations: [{ name: 'LowerThids-In' }],
                stateMachines: [{ name: 'LowerThirdSM', inputs: [] }],
            }],
        });
        const canonicalState = {
            animationNames: ['LowerThids-In'],
            artboard: 'LowerThird',
            artboards: ['LowerThird'],
            playback: { type: 'animation', name: 'LowerThids-In', isPlaying: false, isPaused: true },
            stateMachines: ['LowerThirdSM'],
        };
        const renderSurfaceController = {
            getCanonicalState: () => canonicalState,
            getState: () => ({ activeSessionId: 'surface-1', isLoaded: true, surfaceCreated: true }),
            requestCommand: vi.fn(),
        };
        const windowRef = {
            __TAURI__: {},
            riveInst: hiddenParentInstance,
            _mcpSwitchArtboard: vi.fn(async (_artboard, target) => {
                canonicalState.playback = {
                    type: 'animation', name: String(target).slice(5), isPlaying: true, isPaused: false,
                };
            }),
        };
        const commands = createStatusPlaybackCommands({
            documentRef: document,
            renderSurfaceController,
            windowRef,
        });

        await expect(commands.rav_switch_artboard({
            artboard: 'LowerThird',
            playback: 'anim:Definitely Missing',
        })).rejects.toThrow('Animation "Definitely Missing" was not found on artboard "LowerThird"');
        expect(windowRef._mcpSwitchArtboard).not.toHaveBeenCalled();

        await expect(commands.rav_switch_artboard({
            artboard: 'LowerThird',
            playback: 'anim:LowerThids-In',
        })).resolves.toEqual(expect.objectContaining({ applied: true, status: 'applied' }));
        expect(windowRef._mcpSwitchArtboard).toHaveBeenCalledOnce();
    });

    it('rolls back MCP file identity when visible activation rejects the new file', async () => {
        const transaction = { commit: vi.fn(), rollback: vi.fn() };
        const createObjectUrl = vi.fn(() => 'blob:mcp-candidate');
        const revokeObjectUrl = vi.fn();
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
        const windowRef = {
            __TAURI__: {
                core: {
                    invoke: vi.fn(async (command) => {
                        if (command === 'read_riv_file') return 'AQI=';
                        return null;
                    }),
                },
            },
            _mcpLoadAnimation: vi.fn().mockRejectedValue(new Error('first frame failed')),
            _mcpStageCurrentFile: vi.fn(() => transaction),
        };
        const commands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: false, paths: [] }),
            documentRef: document,
            windowRef,
        });

        await expect(commands.rav_open_file({ path: '/tmp/new.riv' })).rejects.toThrow('first frame failed');

        expect(windowRef._mcpStageCurrentFile).toHaveBeenCalledWith(
            'blob:mcp-candidate',
            'new.riv',
            true,
            expect.any(ArrayBuffer),
            'application/octet-stream',
            2,
            { sourcePath: '/tmp/new.riv' },
        );
        expect(windowRef._mcpLoadAnimation).toHaveBeenCalledWith('blob:mcp-candidate', 'new.riv', {
            forceAutoplay: true,
            waitForActivation: true,
        });
        expect(transaction.rollback).toHaveBeenCalledOnce();
        expect(transaction.commit).not.toHaveBeenCalled();
        expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:mcp-candidate');
        delete URL.createObjectURL;
        delete URL.revokeObjectURL;
    });

    it('does not fall back to stale main-WebView paths while heavyweight topology is pending', async () => {
        const canonicalState = {
            artboard: 'TrackMap',
            stateRevision: 1,
            topologyRevision: 0,
        };
        const requestCommand = vi.fn(async (_type, _payload) => ({
            applied: true,
            canonicalState,
            status: 'applied',
        }));
        const controller = {
            getCanonicalState: () => canonicalState,
            getState: () => ({ activeSessionId: 'heavy-bootstrap', isLoaded: true, surfaceCreated: true }),
            requestCommand,
        };
        const commands = createViewModelCommands({
            buildViewModelSnapshot: vi.fn(() => ({ hasRoot: true, paths: ['stale/main/value'] })),
            renderSurfaceController: controller,
            // If the command ever reads this local runtime while a canonical
            // child is active, the test must fail rather than silently write
            // a stale hidden instance.
            windowRef: { __TAURI__: {}, riveInst: { viewModelInstance: { value: () => { throw new Error('stale main access'); } } } },
        });

        await expect(commands.rav_get_vm_tree()).resolves.toEqual(expect.objectContaining({
            hasRoot: false,
            paths: [],
        }));
        await expect(commands.rav_vm_set({ path: 'speed', value: 42 }))
            .rejects.toThrow('not found or not writable');
        expect(requestCommand).not.toHaveBeenCalled();

        canonicalState.controlsHierarchy = {
            children: [{
                children: [],
                inputs: [{
                    descriptor: { kind: 'number', name: 'speed', path: 'speed', source: 'view-model' },
                    kind: 'number',
                    name: 'speed',
                    path: 'speed',
                    source: 'view-model',
                    value: 12,
                }],
                kind: 'vm',
                label: 'TrackMapVM',
                path: '<root>',
            }],
            inputs: [],
            kind: 'controls',
            label: 'Controls',
            path: '<controls>',
        };
        canonicalState.topologyRevision = 1;
        canonicalState.stateRevision = 2;

        await expect(commands.rav_vm_set({ path: 'speed', value: 42 }))
            .resolves.toEqual(expect.objectContaining({ applied: true, kind: 'number', path: 'speed', value: 12 }));
        expect(requestCommand).toHaveBeenCalledWith('vm-set', expect.objectContaining({
            descriptor: expect.objectContaining({ kind: 'number', path: 'speed' }),
            value: 42,
        }), {});
    });
});
