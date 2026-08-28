import { bindUiActionHandlers } from '../ui/action-bindings.js';
import { buildEffectiveInstantiationDescriptor } from '../platform/export/web-instantiation.js';
import { runTelemetryAcceptanceAction } from '../platform/install-counter/acceptance-driver.js';

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
        getCanvasBackgroundStateSnapshot,
        handleResize,
        initLucideIcons,
        injectCodeSnippet,
        instantiationControlsDialogController,
        installCounterController,
        defaultRivAppController,
        operationsDiagnosticsController,
        loadRiveAnimation,
        logEvent,
        pause,
        play,
        refreshInfoStrip,
        renderSurfaceController,
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
            canvasBackgroundState: getCanvasBackgroundStateSnapshot(),
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
        const authoritativePlayback = renderSurfaceController?.getCanonicalState?.()?.playback || null;
        const wasPlaying = authoritativePlayback
            ? authoritativePlayback.isPlaying === true
            : Boolean(getRiveInstance()?.isPlaying);
        const configOverrides = { autoBind: true, autoplay: wasPlaying };

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
                    beforeUserOnLoad: () => {
                        restoredControls = applyVmControlSnapshot(viewModelSnapshot);
                    },
                    configOverrides,
                    onLoaded: () => {
                        const restoreVisiblePlayback = async () => {
                            if (authoritativePlayback && renderSurfaceController?.getState?.()?.activeSessionId) {
                                const result = await renderSurfaceController.requestCommand(
                                    wasPlaying ? 'play' : 'pause',
                                    wasPlaying && authoritativePlayback.name
                                        ? { name: authoritativePlayback.name }
                                        : {},
                                );
                                if (!result?.applied) {
                                    throw new Error(result?.message || result?.status || 'Visible playback state was not restored.');
                                }
                                return;
                            }
                            if (wasPlaying) {
                                if (currentArtboardState.currentPlaybackType === 'animation' && currentArtboardState.currentPlaybackName) {
                                    getRiveInstance()?.play?.(currentArtboardState.currentPlaybackName);
                                } else {
                                    getRiveInstance()?.play?.();
                                }
                            } else {
                                getRiveInstance()?.pause?.();
                            }
                        };
                        Promise.resolve(restoreVisiblePlayback()).then(resolveOnce, rejectOnce);
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
        await renderSurfaceController?.setup?.();
        await installCounterController?.setup?.();
        await runTelemetryAcceptanceAction({
            controller: installCounterController,
            getTauriInvoker,
            logEvent,
            windowRef,
        });
        await defaultRivAppController?.setup?.();
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
        elements.ravOperationsTab?.addEventListener('click', () => {
            consoleModeController.activateRavMode().catch(() => {
                /* setConsoleMode already reports errors */
            });
        });
        fileSessionController.setupFileInput();
        fileSessionController.updateFileTriggerButton('empty');
        setupCanvasColor();
        setupEventLog();
        await operationsDiagnosticsController?.setup?.();
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
        resetVmInputControls('No animation loaded.');
        resetEventLog();
        refreshInfoStrip();
        windowRef.addEventListener('resize', handleResize);
        const teardownAppShell = () => {
            scriptConsoleController.destroy();
            operationsDiagnosticsController?.dispose?.();
            shellController?.dispose();
            fileSessionController?.dispose();
            renderSurfaceController?.dispose?.();
            installCounterController?.dispose?.();
            defaultRivAppController?.dispose?.();
            windowChromeController?.dispose?.();
        };
        windowRef.addEventListener('beforeunload', () => {
            teardownAppShell();
        });
        console.log('[rive-viewer] setup complete, loading runtime...');
        if (windowRef.__RAV_ISOLATED_DEV__ !== true) {
            updaterController?.checkForUpdatesOnLaunch().catch((error) => {
                console.warn('[rive-viewer] updater check failed:', error);
            });
        }
        ensureRuntime(getCurrentRuntime())
            .then(async () => {
                updateVersionInfo();
                refreshInfoStrip();
                console.log('[rive-viewer] runtime ready:', getCurrentRuntime());
                const loadedFromPending = await fileSessionController.checkOpenedFile();
                await fileSessionController.setupTauriOpenFileListener();
                // Close the small gap between the startup drain and listener
                // registration. The serialized queue drain makes this idempotent.
                const loadedDuringListenerSetup = await fileSessionController.checkOpenedFile();
                if (!loadedFromPending) {
                    if (!loadedDuringListenerSetup) {
                        console.log('[rive-viewer] no pending file at startup; open-file polling enabled');
                    }
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
