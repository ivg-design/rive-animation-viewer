import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
    createUiStack,
    createRuntimeStack,
    createRiveStack,
    createPlatformStack,
} = vi.hoisted(() => ({
    createUiStack: vi.fn(),
    createRuntimeStack: vi.fn(),
    createRiveStack: vi.fn(),
    createPlatformStack: vi.fn(),
}));

vi.mock('../../../src/app/bootstrap/stacks/ui-stack.js', () => ({
    createUiStack,
}));

vi.mock('../../../src/app/bootstrap/stacks/runtime-stack.js', () => ({
    createRuntimeStack,
}));

vi.mock('../../../src/app/bootstrap/stacks/rive-stack.js', () => ({
    createRiveStack,
}));

vi.mock('../../../src/app/bootstrap/stacks/platform-stack.js', () => ({
    createPlatformStack,
}));

import { createControllerStack } from '../../../src/app/bootstrap/stacks/controller-stack.js';

function createDefaultRiveStack() {
    return {
        captureVmControlSnapshot: vi.fn(() => []),
        getArtboardStateSnapshot: vi.fn(() => ({})),
        getChangedVmControlSnapshot: vi.fn(() => []),
        pause: vi.fn(),
        play: vi.fn(),
        renderVmInputControls: vi.fn(),
        reset: vi.fn(),
        resetArtboardSwitcherState: vi.fn(),
        resetToDefaultArtboard: vi.fn(),
        resetVmInputControls: vi.fn(),
        serializeControlHierarchy: vi.fn(() => null),
        serializeVmHierarchy: vi.fn(() => null),
        switchArtboard: vi.fn(),
    };
}

describe('bootstrap/controller-stack', () => {
    beforeEach(() => {
        createUiStack.mockReset();
        createRuntimeStack.mockReset();
        createRiveStack.mockReset();
        createPlatformStack.mockReset();

        createUiStack.mockReturnValue({
            applyCodeAndReload: vi.fn(),
            consoleModeController: { setConsoleMode: vi.fn() },
            ensureEditorReady: vi.fn(),
            getEditorCode: vi.fn(),
            getEventLogEntries: vi.fn(),
            getEventLogFilterState: vi.fn(),
            getLiveConfig: vi.fn(() => ({})),
            getLiveConfigState: vi.fn(() => ({ sourceMode: 'internal', draftDirty: false })),
            getVmExplorerSnippetState: vi.fn(() => ({ injected: false })),
            injectCodeSnippet: vi.fn(),
            logEvent: vi.fn(),
            scriptConsoleController: { installCapture: vi.fn(), readCaptured: vi.fn(), isOpen: vi.fn() },
            setEditorCode: vi.fn(),
            setLiveConfigSource: vi.fn(),
            setVmExplorerSnippetEnabled: vi.fn(),
            showMcpSetup: vi.fn(),
            statusController: {},
            toggleLiveConfigSource: vi.fn(),
        });

        createRuntimeStack.mockReturnValue({
            runtimeLoaderController: {
                applyRuntimeVersionToken: vi.fn(),
                applyStoredRuntimeVersionForCurrentFile: vi.fn(),
                ensureRuntime: vi.fn(),
                getCurrentRuntimeSource: vi.fn(),
                getCurrentRuntimeVersion: vi.fn(),
                getEffectiveRuntimeVersionToken: vi.fn(),
                getLoadedRuntime: vi.fn(),
                getRuntimeAsset: vi.fn(),
                getRuntimeSourceText: vi.fn(),
                getRuntimeVersion: vi.fn(),
                setupRuntimeVersionPicker: vi.fn(),
            },
            inspectionController: { inspect: vi.fn(), getMetadata: vi.fn(), getSourceScope: vi.fn() },
            canvasBackgroundController: {
                getStateSnapshot: vi.fn(() => ({ canvasColor: '#000000', canvasTransparent: false })),
                isCanvasBackgroundTransparent: vi.fn(() => false),
                setupCanvasColor: vi.fn(),
            },
        });

        createRiveStack.mockReturnValue(createDefaultRiveStack());

        createPlatformStack.mockReturnValue({
            demoExportController: {},
            fileSessionController: {},
            globalBindingsController: {},
            instantiationControlsDialogController: {},
            shellController: {},
        });
    });

    it('passes canvas sizing setter into the UI stack for editor apply flows', () => {
        const setCurrentCanvasSizing = vi.fn();
        const getCurrentFilePreferenceId = vi.fn(() => 'path:/users/test/demo.riv');
        const loadCurrentAnimation = vi.fn(async () => true);
        const canonicalScope = { sourceIdentity: 'new-file', runtimeKey: 'webgl2@2.42.0', sessionId: 'new-session' };
        const getCanonicalSourceScope = vi.fn(() => canonicalScope);
        createPlatformStack.mockReturnValue({
            demoExportController: {},
            fileSessionController: {},
            globalBindingsController: {},
            instantiationControlsDialogController: {},
            renderSurfaceController: { loadCurrentAnimation, getCanonicalSourceScope },
            shellController: {},
        });

        createControllerStack({
            elements: {},
            placeholders: {},
            runtimeState: {},
            refs: {
                codeMirrorModulesRef: vi.fn(() => null),
                getRefreshCurrentState: () => vi.fn(),
                loadCodeMirror: vi.fn(),
            },
            callbacks: {
                buildFileRuntimePreferenceId: vi.fn(),
                cleanupInstance: vi.fn(),
                createDemoBundle: vi.fn(),
                ensureTauriBridge: vi.fn(),
                getCurrentFileBuffer: vi.fn(() => null),
                getCurrentFileMimeType: vi.fn(() => 'application/octet-stream'),
                getCurrentFileName: vi.fn(() => null),
                getCurrentFilePreferenceId,
                getCurrentFileSourcePath: vi.fn(() => ''),
                getCurrentFileSizeBytes: vi.fn(() => 0),
                getCurrentFileUrl: vi.fn(() => null),
                getCurrentCanvasSizing: vi.fn(() => null),
                getCurrentLayoutAlignment: vi.fn(() => 'center'),
                getCurrentLayoutFit: vi.fn(() => 'contain'),
                getCurrentMcpPort: vi.fn(() => 9274),
                getCurrentRuntime: vi.fn(() => 'webgl2'),
                getRiveInstance: vi.fn(() => null),
                getRuntimeVersionToken: vi.fn(() => 'latest'),
                getTauriEventListener: vi.fn(() => null),
                getTauriInvoker: vi.fn(() => null),
                handleResize: vi.fn(),
                hideError: vi.fn(),
                initLucideIcons: vi.fn(),
                isTauriEnvironment: vi.fn(() => true),
                loadRiveAnimation: vi.fn(),
                normalizeOpenedFilePath: vi.fn((value) => value),
                refreshInfoStrip: vi.fn(),
                resolveAppVersion: vi.fn(),
                setCurrentCanvasSizing,
                setCurrentLayoutAlignment: vi.fn(),
                setCurrentLayoutFit: vi.fn(),
                setCurrentMcpPort: vi.fn(),
                setCurrentRuntime: vi.fn(),
                showError: vi.fn(),
                updateInfo: vi.fn(),
                updateVersionInfo: vi.fn(),
            },
        });

        const uiStackArgs = createUiStack.mock.calls[0]?.[0];
        expect(uiStackArgs?.callbacks?.setCurrentCanvasSizing).toBe(setCurrentCanvasSizing);
        const platformStackArgs = createPlatformStack.mock.calls[0]?.[0];
        expect(platformStackArgs?.callbacks?.getCurrentFilePreferenceId).toBe(getCurrentFilePreferenceId);
        const riveStackArgs = createRiveStack.mock.calls[0]?.[0];
        expect(riveStackArgs?.callbacks?.getCanonicalSourceScope()).toBe(canonicalScope);
        expect(riveStackArgs?.callbacks?.getCurrentRuntimeVersion).toBe(
            createRuntimeStack.mock.results[0].value.runtimeLoaderController.getCurrentRuntimeVersion,
        );
        expect(riveStackArgs?.callbacks?.activateAuthoritativeSurface({ autoplay: true })).toEqual(
            loadCurrentAnimation.mock.results[0].value,
        );
        expect(loadCurrentAnimation).toHaveBeenCalledOnce();
        expect(loadCurrentAnimation).toHaveBeenCalledWith({ autoplay: true });
    });

    it('restores canonical selection, properties, file metadata, and footer status after a failed replacement', () => {
        const refreshInfoStrip = vi.fn();
        const updateInfo = vi.fn();
        const syncArtboardStateFromCanonical = vi.fn();
        const populateArtboardSwitcher = vi.fn();
        const renderVmInputControls = vi.fn();
        const canonicalState = {
            artboard: 'Old Artboard',
            playback: { name: 'Old State Machine', type: 'stateMachine' },
            vmInstance: { key: 'old-instance' },
        };
        const getArtboardStateSnapshot = vi.fn(() => ({
            currentArtboard: 'Old Artboard',
            currentPlaybackName: 'Old State Machine',
            currentPlaybackType: 'stateMachine',
            currentVmInstanceName: 'old-instance',
        }));
        const getRiveInstance = vi.fn(() => ({
            artboard: { name: 'Old Artboard' },
            defaultViewModel: () => ({ name: 'Old ViewModel' }),
        }));
        createRiveStack.mockReturnValue({
            ...createDefaultRiveStack(),
            getArtboardStateSnapshot,
            populateArtboardSwitcher,
            renderVmInputControls,
            syncArtboardStateFromCanonical,
        });
        createPlatformStack.mockReturnValue({
            demoExportController: {},
            fileSessionController: {},
            globalBindingsController: {},
            instantiationControlsDialogController: {},
            renderSurfaceController: { getCanonicalState: () => canonicalState },
            shellController: {},
        });

        createControllerStack({
            elements: {},
            placeholders: {},
            runtimeState: {},
            refs: {
                codeMirrorModulesRef: vi.fn(() => null),
                getRefreshCurrentState: () => vi.fn(),
                loadCodeMirror: vi.fn(),
            },
            callbacks: {
                buildFileRuntimePreferenceId: vi.fn(), cleanupInstance: vi.fn(), createDemoBundle: vi.fn(),
                ensureTauriBridge: vi.fn(), getCurrentFileBuffer: vi.fn(() => null),
                getCurrentFileMimeType: vi.fn(() => 'application/octet-stream'), getCurrentFileName: vi.fn(() => 'old.riv'),
                getCurrentFilePreferenceId: vi.fn(() => 'old'), getCurrentFileSourcePath: vi.fn(() => '/tmp/old.riv'),
                getCurrentFileSizeBytes: vi.fn(() => 1), getCurrentFileUrl: vi.fn(() => 'blob:old'),
                getCurrentCanvasSizing: vi.fn(() => null), getCurrentLayoutAlignment: vi.fn(() => 'center'),
                getCurrentLayoutFit: vi.fn(() => 'contain'), getCurrentMcpPort: vi.fn(() => 9278),
                getCurrentRuntime: vi.fn(() => 'webgl2'), getRiveInstance, getRuntimeVersionToken: vi.fn(() => 'latest'),
                getTauriEventListener: vi.fn(() => null), getTauriInvoker: vi.fn(() => null), handleResize: vi.fn(),
                hideError: vi.fn(), initLucideIcons: vi.fn(), isTauriEnvironment: vi.fn(() => true),
                loadRiveAnimation: vi.fn(), normalizeOpenedFilePath: vi.fn((value) => value), refreshInfoStrip,
                resolveAppVersion: vi.fn(), setCurrentCanvasSizing: vi.fn(), setCurrentLayoutAlignment: vi.fn(),
                setCurrentLayoutFit: vi.fn(), setCurrentMcpPort: vi.fn(), setCurrentRuntime: vi.fn(), showError: vi.fn(),
                updateInfo, updateVersionInfo: vi.fn(),
            },
        });

        const platformStackArgs = createPlatformStack.mock.calls[0][0];
        platformStackArgs.callbacks.restoreFileSessionUi();

        expect(syncArtboardStateFromCanonical).toHaveBeenCalledWith(canonicalState);
        expect(populateArtboardSwitcher).toHaveBeenCalledOnce();
        expect(renderVmInputControls).toHaveBeenCalledOnce();
        expect(updateInfo).toHaveBeenCalledWith(
            'Loaded: [AB] Old Artboard · [SM] Old State Machine · [VM] Old ViewModel · [INST] old-instance',
        );
        expect(refreshInfoStrip).toHaveBeenCalledOnce();
    });
});
