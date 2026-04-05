import { bindUiActionHandlers } from '../ui/action-bindings.js';
import { buildEffectiveInstantiationDescriptor } from '../platform/export/web-instantiation.js';

export function createAppLifecycle({
    callbacks,
    elements,
    windowRef = globalThis.window,
} = {}) {
    const {
        aboutDialogController,
        applyCodeAndReload,
        applyVmControlSnapshot,
        captureVmControlSnapshot,
        cleanupInstance,
        cleanupTransparencyRuntime,
        codeEditorController,
        consoleModeController,
        createDemoBundle,
        ensureEditorReady,
        ensureRuntime,
        ensureTauriBridge,
        fileSessionController,
        getArtboardStateSnapshot,
        getCurrentFileName,
        getCurrentCanvasSizing,
        getCurrentFileUrl,
        getCurrentLayoutAlignment,
        getCurrentLayoutFit,
        getCurrentRuntime,
        getCurrentRuntimeVersion,
        getLiveConfig,
        getLiveConfigState,
        getRiveInstance,
        getTauriInvoker,
        getTransparencyStateSnapshot,
        handleResize,
        initLucideIcons,
        injectCodeSnippet,
        instantiationControlsDialogController,
        loadRiveAnimation,
        logEvent,
        pause,
        play,
        refreshInfoStrip,
        resolveAppVersion,
        reset,
        resetEventLog,
        resetToDefaultArtboard,
        resetVmInputControls,
        scriptConsoleController,
        setupArtboardSwitcher,
        setupCanvasColor,
        setupEventLog,
        setupRuntimeVersionPicker,
        setupTransparencyControls,
        shellController,
        showError,
        showMcpSetup,
        syncMcpPortFromDesktop,
        updaterController,
        updateInfo,
        updateVersionInfo,
        windowChromeController,
    } = callbacks;

    function buildLiveInstantiationDescriptor() {
        const liveConfigState = getLiveConfigState();
        return buildEffectiveInstantiationDescriptor({
            artboardState: getArtboardStateSnapshot(),
            currentFileName: getCurrentFileName() || 'animation.riv',
            currentCanvasSizing: getCurrentCanvasSizing(),
            currentLayoutAlignment: getCurrentLayoutAlignment(),
            currentLayoutFit: getCurrentLayoutFit(),
            detectedStateMachines: Array.isArray(getRiveInstance()?.stateMachineNames)
                ? getRiveInstance().stateMachineNames
                : [],
            editorCode: liveConfigState.appliedEditorCode,
            editorConfig: getLiveConfig(),
            runtimeName: getCurrentRuntime(),
            runtimeVersion: getCurrentRuntimeVersion(),
            sourceMode: liveConfigState.sourceMode,
            transparencyState: getTransparencyStateSnapshot(),
        });
    }

    async function refreshCurrentState() {
        const currentFileUrl = getCurrentFileUrl();
        const currentFileName = getCurrentFileName();
        if (!currentFileUrl || !currentFileName) {
            showError('Please load a Rive file first');
            return false;
        }

        const currentArtboardState = getArtboardStateSnapshot();
        const viewModelSnapshot = captureVmControlSnapshot();
        const wasPlaying = Boolean(getRiveInstance()?.isPlaying);
        const configOverrides = { autoBind: true, autoplay: true };

        if (currentArtboardState.currentArtboard) {
            configOverrides.artboard = currentArtboardState.currentArtboard;
        }
        if (currentArtboardState.currentPlaybackType === 'stateMachine' && currentArtboardState.currentPlaybackName) {
            configOverrides.stateMachines = currentArtboardState.currentPlaybackName;
            delete configOverrides.animations;
        } else if (currentArtboardState.currentPlaybackType === 'animation' && currentArtboardState.currentPlaybackName) {
            configOverrides.animations = currentArtboardState.currentPlaybackName;
            delete configOverrides.stateMachines;
        }

        updateInfo(`Refreshing ${currentFileName}...`);
        logEvent('ui', 'refresh-start', `Refreshing ${currentFileName}.`, {
            artboard: currentArtboardState.currentArtboard || null,
            controls: viewModelSnapshot.length,
            playback: currentArtboardState.currentPlaybackName || null,
            wasPlaying,
        });

        let restoredControls = 0;
        try {
            await new Promise((resolve, reject) => {
                let settled = false;
                const resolveOnce = () => {
                    if (!settled) {
                        settled = true;
                        resolve();
                    }
                };
                const rejectOnce = (error) => {
                    if (!settled) {
                        settled = true;
                        reject(error || new Error('Animation refresh failed'));
                    }
                };

                loadRiveAnimation(currentFileUrl, currentFileName, {
                    configOverrides,
                    onLoaded: () => {
                        restoredControls = applyVmControlSnapshot(viewModelSnapshot);
                        if (!wasPlaying) {
                            getRiveInstance()?.pause?.();
                        }
                        resolveOnce();
                    },
                    onLoadError: rejectOnce,
                }).catch(rejectOnce);
            });

            updateInfo(`Refreshed ${currentFileName}`);
            logEvent('ui', 'refresh-complete', `Refreshed ${currentFileName}.`, {
                artboard: currentArtboardState.currentArtboard || null,
                playback: currentArtboardState.currentPlaybackName || null,
                restoredControls,
                wasPlaying,
            });
            return true;
        } catch (error) {
            showError(`Failed to refresh animation: ${error?.message || error}`);
            logEvent('ui', 'refresh-failed', 'Failed to refresh current animation state.', error);
            return false;
        }
    }

    async function initApp() {
        console.log('[rive-viewer] init start');
        await ensureTauriBridge();
        await syncMcpPortFromDesktop();
        windowRef._mcpBridge?.reconnect?.();
        windowRef.buildLiveInstantiationDescriptor = buildLiveInstantiationDescriptor;
        initLucideIcons();
        resolveAppVersion?.();
        updateVersionInfo('Loading runtime...');
        await windowChromeController?.setup?.();
        bindUiActionHandlers({
            elements,
            actions: {
                applyCodeAndReload,
                handleFileButtonClick: () => fileSessionController?.handleFileButtonClick(),
                injectCodeSnippet,
                pause,
                play,
                reset,
                showInstantiationControlsDialogForExport: () => instantiationControlsDialogController?.openDialog(),
                showMcpSetup,
            },
        });
        elements.consoleModeChip?.addEventListener('click', () => {
            consoleModeController.toggleConsoleOpen().catch(() => {
                /* setConsoleMode already reports errors */
            });
        });
        elements.eventConsoleTab?.addEventListener('click', () => {
            consoleModeController.activateEventsMode().catch(() => {
                /* setConsoleMode already reports errors */
            });
        });
        elements.scriptConsoleTab?.addEventListener('click', () => {
            consoleModeController.activateJsMode().catch(() => {
                /* setConsoleMode already reports errors */
            });
        });
        fileSessionController.setupFileInput();
        fileSessionController.updateFileTriggerButton('empty');
        setupCanvasColor();
        setupTransparencyControls();
        setupEventLog();
        instantiationControlsDialogController?.setup();
        scriptConsoleController.setup();
        await consoleModeController.setConsoleMode('closed');
        setupArtboardSwitcher();
        shellController?.setup();
        aboutDialogController.setup();
        updaterController?.setup();
        await ensureEditorReady();
        windowRef.setTimeout(() => {
            ensureEditorReady().catch(() => {
                /* noop */
            });
        }, 0);
        await setupRuntimeVersionPicker();
        fileSessionController.setupDragAndDrop();
        await fileSessionController.setupTauriOpenFileListener();
        resetVmInputControls('No animation loaded.');
        resetEventLog();
        refreshInfoStrip();
        windowRef.addEventListener('resize', handleResize);
        const teardownAppShell = () => {
            scriptConsoleController.destroy();
            shellController?.dispose();
            fileSessionController?.dispose();
            windowChromeController?.dispose?.();
        };
        const cleanupTransparency = () => {
            cleanupTransparencyRuntime().catch(() => {
                /* noop */
            });
        };
        windowRef.addEventListener('pagehide', cleanupTransparency);
        windowRef.addEventListener('beforeunload', () => {
            teardownAppShell();
            cleanupTransparency();
        });
        console.log('[rive-viewer] setup complete, loading runtime...');
        updaterController?.checkForUpdatesOnLaunch().catch((error) => {
            console.warn('[rive-viewer] updater check failed:', error);
        });
        ensureRuntime(getCurrentRuntime())
            .then(async () => {
                updateVersionInfo();
                refreshInfoStrip();
                console.log('[rive-viewer] runtime ready:', getCurrentRuntime());
                const loadedFromPending = await fileSessionController.checkOpenedFile();
                if (!loadedFromPending) {
                    console.log('[rive-viewer] no pending file at startup; open-file polling enabled');
                }
                fileSessionController.startOpenedFilePolling();
            })
            .catch((error) => {
                console.error('[rive-viewer] runtime load failed:', error);
                showError(`Failed to load runtime: ${error.message}`);
            });
    }

    return {
        buildLiveInstantiationDescriptor,
        initApp,
        refreshCurrentState,
    };
}
