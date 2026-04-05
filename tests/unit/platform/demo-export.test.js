import {
    arrayBufferToBase64,
    buildDemoBundlePayload,
    createDemoExportController,
    resolveExportStateMachines,
} from '../../../src/app/platform/export/demo-export.js';

describe('platform/demo-export', () => {
    it('builds export payloads and resolves state-machine fallbacks', () => {
        const buffer = Uint8Array.from([1, 2, 3]).buffer;

        expect(arrayBufferToBase64(buffer)).toBe('AQID');
        expect(arrayBufferToBase64(null)).toBe('');
        expect(resolveExportStateMachines('main-sm', ['fallback-sm'])).toEqual(['main-sm']);
        expect(resolveExportStateMachines(null, ['fallback-sm'])).toEqual(['fallback-sm']);

        expect(buildDemoBundlePayload({
            artboardState: {
                currentArtboard: 'Main',
                currentPlaybackName: 'idle',
                currentPlaybackType: 'animation',
            },
            currentCanvasSizing: {
                mode: 'fixed',
                width: 1600,
                height: 900,
                lockAspectRatio: true,
            },
            currentFileBuffer: buffer,
            currentFileName: 'demo.riv',
            currentLayoutAlignment: 'topLeft',
            currentLayoutFit: 'cover',
            editorConfig: { autoplay: false },
            layoutState: { rightPanelVisible: true },
            runtimeName: 'webgl2',
            runtimeScript: 'runtime();',
            runtimeVersion: '2.0.0',
            stateMachines: ['main-sm'],
            transparencyState: {
                canvasColor: '#112233',
                canvasTransparent: false,
            },
            vmHierarchy: { root: 'vm' },
        })).toEqual(expect.objectContaining({
            animation_base64: 'AQID',
            animations: ['idle'],
            autoplay: false,
            canvas_color: '#112233',
            canvas_sizing: '{"mode":"fixed","width":1600,"height":900,"lockAspectRatio":true}',
            control_snapshot: null,
            default_instantiation_package_source: 'cdn',
            file_name: 'demo.riv',
            instantiation_snippets: null,
            layout_alignment: 'topLeft',
            layout_fit: 'cover',
            runtime_name: 'webgl2',
            runtime_script: 'runtime();',
            runtime_version: '2.0.0',
            state_machines: ['main-sm'],
            vm_hierarchy: '{"root":"vm"}',
        }));
    });

    it('creates demo bundles and exports directly to a path', async () => {
        const buffer = Uint8Array.from([1, 2]).buffer;
        const fullSnapshot = [
            {
                descriptor: {
                    kind: 'number',
                    name: 'progress',
                    path: 'progress',
                },
                kind: 'number',
                value: 0.5,
            },
            {
                descriptor: {
                    kind: 'string',
                    name: 'title',
                    path: 'title',
                },
                kind: 'string',
                value: 'ignore me',
            },
        ];
        const invoke = vi.fn(async (command, payload) => {
            if (command === 'make_demo_bundle') {
                expect(payload.payload.file_name).toBe('demo.riv');
                expect(JSON.parse(payload.payload.control_snapshot)).toEqual([fullSnapshot[0]]);
                return '/tmp/demo-app';
            }
            if (command === 'make_demo_bundle_to_path') {
                expect(payload.outputPath).toBe('/tmp/out');
                return '/tmp/out';
            }
            return null;
        });
        const controller = createDemoExportController({
            callbacks: {
                ensureRuntime: vi.fn().mockResolvedValue(undefined),
                getTauriInvoker: () => invoke,
                logEvent: vi.fn(),
                showError: vi.fn(),
                updateInfo: vi.fn(),
            },
            getArtboardStateSnapshot: () => ({
                currentArtboard: 'Main',
                currentPlaybackName: 'idle',
                currentPlaybackType: 'animation',
            }),
            captureVmControlSnapshot: () => fullSnapshot,
            getCurrentFileBuffer: () => buffer,
            getCurrentFileName: () => 'demo.riv',
            getCurrentCanvasSizing: () => ({
                mode: 'fixed',
                width: 1440,
                height: 810,
                lockAspectRatio: true,
            }),
            getCurrentLayoutAlignment: () => 'center',
            getCurrentLayoutFit: () => 'contain',
            getCurrentRuntime: () => 'webgl2',
            getEditorConfig: () => ({ autoplay: true, stateMachines: 'main-sm' }),
            getEffectiveRuntimeVersionToken: () => '3.0.0',
            getLiveConfigState: () => ({
                appliedEditorCode: '',
                sourceMode: 'internal',
            }),
            getLayoutStateSnapshot: () => ({ rightPanelVisible: true }),
            getRiveInstance: () => ({ stateMachineNames: ['fallback-sm'] }),
            getRuntimeAsset: () => ({ text: 'runtime();', version: '2.0.0' }),
            getRuntimeVersionToken: () => 'latest',
            getSelectedControlKeys: () => ['vm:progress:number'],
            getTransparencyStateSnapshot: () => ({
                canvasColor: '#abcdef',
                canvasTransparent: false,
            }),
            getChangedVmControlSnapshot: () => [fullSnapshot[0]],
            serializeVmHierarchy: () => ({ root: 'vm' }),
        });

        await expect(controller.createDemoBundle()).resolves.toBe('/tmp/demo-app');
        await expect(controller.exportDemoToPath('/tmp/out')).resolves.toBe('/tmp/out');
        const instantiationResult = await controller.generateWebInstantiationCode({ packageSource: 'cdn' });
        expect(instantiationResult).toEqual(expect.objectContaining({
            helperApi: expect.objectContaining({
                global: 'window.ravRive',
            }),
            packageSource: 'cdn',
            runtimeName: 'webgl2',
            sourceMode: 'internal',
        }));
        expect(instantiationResult.code).toContain('<script src="https://unpkg.com/@rive-app/webgl2@2.0.0"></script>');
        expect(instantiationResult.code).toContain('canvas.width = 1440;');
        expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('reports validation and runtime preparation failures without invoking Tauri', async () => {
        const showError = vi.fn();
        const logEvent = vi.fn();
        const controller = createDemoExportController({
            callbacks: {
                ensureRuntime: vi.fn().mockRejectedValue(new Error('bad runtime')),
                getTauriInvoker: () => vi.fn(),
                logEvent,
                showError,
                updateInfo: vi.fn(),
            },
            getCurrentFileBuffer: () => Uint8Array.from([1]).buffer,
            getCurrentFileName: () => 'demo.riv',
            getCurrentRuntime: () => 'canvas',
        });
        const missingFileController = createDemoExportController({
            callbacks: {
                getTauriInvoker: () => null,
                showError,
            },
        });

        await expect(missingFileController.createDemoBundle()).resolves.toBeNull();
        await expect(controller.createDemoBundle()).resolves.toBeNull();

        expect(showError).toHaveBeenCalledWith('Demo bundles can only be created inside the desktop app.');
        expect(showError).toHaveBeenCalledWith('bad runtime');
        expect(logEvent).toHaveBeenCalledWith('ui', 'demo-build-runtime-error', 'Runtime prep failed for canvas.', expect.any(Error));
    });

    it('rejects direct-path export when the Tauri bridge is unavailable', async () => {
        const controller = createDemoExportController({
            callbacks: {
                getTauriInvoker: () => null,
            },
        });

        await expect(controller.exportDemoToPath('/tmp/out')).rejects.toThrow('Export requires the Tauri desktop app');
    });

    it('builds export context, falls back to detected state machines, and reports invoke failures', async () => {
        const showError = vi.fn();
        const updateInfo = vi.fn();
        const logEvent = vi.fn();
        const controller = createDemoExportController({
            callbacks: {
                ensureRuntime: vi.fn().mockResolvedValue(undefined),
                getTauriInvoker: () => vi.fn(async (_command) => {
                    throw new Error('cancelled by user');
                }),
                logEvent,
                showError,
                updateInfo,
            },
            getArtboardStateSnapshot: () => ({
                currentArtboard: 'HUD',
                currentPlaybackName: null,
                currentPlaybackType: 'stateMachine',
            }),
            getCurrentFileBuffer: () => Uint8Array.from([7, 8]).buffer,
            getCurrentFileName: () => 'hud.riv',
            getCurrentLayoutAlignment: () => 'centerRight',
            getCurrentLayoutFit: () => 'contain',
            getCurrentRuntime: () => 'canvas',
            getEditorConfig: () => ({ autoplay: true }),
            getEffectiveRuntimeVersionToken: () => '2.1.0',
            getLiveConfigState: () => ({
                appliedEditorCode: '',
                sourceMode: 'internal',
            }),
            getLayoutStateSnapshot: () => ({ rightPanelVisible: false }),
            getRiveInstance: () => ({ stateMachineNames: ['fallback-sm'] }),
            getRuntimeAsset: () => ({ text: 'runtime();', version: '' }),
            getRuntimeVersionToken: () => 'latest',
            getTransparencyStateSnapshot: () => ({
                canvasColor: '#000000',
                canvasTransparent: true,
            }),
            serializeVmHierarchy: () => null,
        });

        await expect(controller.buildExportContext()).resolves.toEqual(expect.objectContaining({
            currentFileName: 'hud.riv',
            runtimeName: 'canvas',
            runtimeVersion: '2.1.0',
        }));
        await expect(controller.createDemoBundle()).resolves.toBeNull();

        expect(updateInfo).toHaveBeenCalledWith('Building demo bundle...');
        expect(updateInfo).toHaveBeenCalledWith('Export cancelled.');
        expect(logEvent).toHaveBeenCalledWith('ui', 'demo-build-cancelled', 'Export cancelled by user.');
        expect(showError).not.toHaveBeenCalledWith(expect.stringContaining('Failed to create demo bundle'));
    });

    it('throws when runtime data is unavailable and reports non-cancel export failures', async () => {
        const showError = vi.fn();
        const logEvent = vi.fn();
        const missingRuntimeController = createDemoExportController({
            callbacks: {
                ensureRuntime: vi.fn().mockResolvedValue(undefined),
                getTauriInvoker: () => vi.fn(),
                showError,
                logEvent,
                updateInfo: vi.fn(),
            },
            getCurrentFileBuffer: () => Uint8Array.from([1, 2]).buffer,
            getCurrentFileName: () => 'demo.riv',
            getCurrentRuntime: () => 'webgl2',
            getRuntimeAsset: () => null,
        });
        const failingInvokeController = createDemoExportController({
            callbacks: {
                ensureRuntime: vi.fn().mockResolvedValue(undefined),
                getTauriInvoker: () => vi.fn(async () => {
                    throw new Error('disk full');
                }),
                showError,
                logEvent,
                updateInfo: vi.fn(),
            },
            getCurrentFileBuffer: () => Uint8Array.from([1, 2]).buffer,
            getCurrentFileName: () => 'demo.riv',
            getCurrentRuntime: () => 'webgl2',
            getRuntimeAsset: () => ({ text: 'runtime();', version: '2.0.0' }),
        });

        await expect(missingRuntimeController.buildExportContext()).rejects.toThrow(
            'Runtime data for webgl2 is not ready yet. Please wait for it to finish loading.',
        );
        await expect(failingInvokeController.createDemoBundle()).resolves.toBeNull();

        expect(showError).toHaveBeenCalledWith('Failed to create demo bundle: disk full');
        expect(logEvent).toHaveBeenCalledWith('ui', 'demo-build-failed', 'Failed to build demo bundle.', expect.any(Error));
    });

    it('executes default callback paths during export operations', async () => {
        const invoke = vi.fn(async (command, payload) => {
            if (command === 'make_demo_bundle') {
                return `/tmp/${payload.payload.file_name}`;
            }
            return '/tmp/out';
        });
        const controller = createDemoExportController({
            callbacks: {
                getTauriInvoker: () => invoke,
            },
            getCurrentFileBuffer: () => Uint8Array.from([3, 4]).buffer,
            getCurrentFileName: () => 'default.riv',
            getRuntimeAsset: () => ({ text: 'runtime();', version: '2.0.0' }),
        });
        const noInvokeController = createDemoExportController();

        await expect(controller.createDemoBundle()).resolves.toBe('/tmp/default.riv');
        await expect(controller.exportDemoToPath('/tmp/out')).resolves.toBe('/tmp/out');
        await expect(controller.generateWebInstantiationCode()).resolves.toEqual(
            expect.objectContaining({
                packageSource: 'cdn',
                runtimePackageName: '@rive-app/webgl2',
            }),
        );
        await expect(noInvokeController.createDemoBundle()).resolves.toBeNull();
    });
});
