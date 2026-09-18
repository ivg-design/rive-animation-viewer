import { normalizeCanvasSizingState } from '../core/canvas-sizing.js';
import { resolveGpuCanvasConfig } from '../core/gpu-canvas.js';
import { resolveRiveAlignment, resolveRiveFit } from '../core/rive-layout.js';
import { composeEmbeddedImageAssetLoader } from './assets/embedded-image-assets.js';
import { createRiveEventBridge } from './instance/event-bridge.js';
import { createInstanceCanvasPresentationController } from './instance/canvas-presentation.js';
import { bindViewModelInstanceByKey } from './view-model/instances.js';
import { normalizeResetViewModelInstanceKey } from './reset-contract.js';
import { getStateMachineNames, normalizePlaybackConfig } from './runtime-compatibility.js';
import {
    configureRiveLoadLifecycle,
} from './instances/load-lifecycle.js';
import { createLoadSettlement } from './instances/load-settlement.js';
import { loadAuthoritativeRiveSurface } from './instances/authoritative-load.js';
import { disableNativeFpsCounter } from './instances/native-fps.js';
export { safelyInvokeUserCallback } from './instances/load-lifecycle.js';
export function createRiveInstanceController({
    callbacks = {},
    embeddedImageAssetCatalog = null,
    elements,
    getCurrentCanvasSizing = () => normalizeCanvasSizingState(),
    getCurrentLayoutAlignment = () => 'center',
    getCurrentFileBuffer = () => null,
    getCurrentLayoutFit = () => 'contain',
    getCurrentRuntime = () => 'webgl2',
    getGpuCanvasEnabled = () => false,
    getCurrentRuntimeVersion = () => null,
    getEditorConfig = () => ({}),
    isAuthoritativeChildMode = () => false,
    windowRef = globalThis.window,
} = {}) {
    const {
        activateAuthoritativeSurface = async () => false,
        applyCanvasBackground = () => {},
        detectDefaultStateMachineName = async () => null,
        ensureRuntime = async () => null,
        inspectFile = async () => null,
        hideError = () => {},
        isCanvasBackgroundTransparent = () => false,
        logEvent = () => {},
        populateArtboardSwitcher = () => {},
        refreshInfoStrip = () => {},
        renderVmInputControls = () => {},
        resetPlaybackChips = () => {},
        resetVmInputControls = () => {},
        setVmControlBaselineSnapshot = () => {},
        showError = () => {},
        getPlaybackState = () => ({}),
        syncArtboardStateAfterLoad = () => {},
        syncArtboardStateFromConfig = () => {},
        updateInfo = () => {},
        updatePlaybackChips = () => {},
    } = callbacks;

    let riveInstance = null;
    let pendingInPlaceReset = null;
    let cancelPendingLoad = null;
    let loadGeneration = 0;
    const riveEventBridge = createRiveEventBridge({ isEnabled: () => !isAuthoritativeChildMode(), logEvent });

    function getRiveInstance() {
        return riveInstance;
    }

    function setRiveInstance(instance) {
        riveInstance = instance;
        windowRef.riveInst = instance;
    }

    const { handleResize, resizeCanvas } = createInstanceCanvasPresentationController({
        elements,
        getCurrentCanvasSizing,
        getEditorConfig,
        getRiveInstance,
        windowRef,
    });

    function cleanupRiveInstance(instance) {
        if (!instance) return;
        disableNativeFpsCounter(instance);
        if (!instance.cleanup) return;
        try {
            instance.cleanup();
        } catch (error) {
            console.warn('[rive-viewer] cleanup error (WebGL context loss):', error.message);
        }
    }

    function cleanupInstance({ preservePendingLoad = false } = {}) {
        if (!preservePendingLoad) {
            loadGeneration += 1;
            cancelPendingLoad?.(new Error('Animation load cancelled.'));
            cancelPendingLoad = null;
        }
        pendingInPlaceReset = null;
        riveEventBridge.clear();
        resetPlaybackChips();
        // Detach ViewModel observers while their native accessors are still valid.
        resetVmInputControls('No animation loaded.');
        if (elements.artboardSwitcher) {
            elements.artboardSwitcher.hidden = true;
        }
        cleanupRiveInstance(riveInstance);
        setRiveInstance(null);
    }

    function resetRiveInstance(params = {}, { beforeUserOnLoad = null } = {}) {
        if (!riveInstance || typeof riveInstance.reset !== 'function') {
            return false;
        }
        const vmInstanceKey = normalizeResetViewModelInstanceKey(params.viewModelInstanceName);
        pendingInPlaceReset = {
            beforeUserOnLoad: () => {
                if (vmInstanceKey !== null) {
                    bindViewModelInstanceByKey(riveInstance, vmInstanceKey);
                }
                beforeUserOnLoad?.();
            },
        };
        try {
            riveInstance.reset(normalizePlaybackConfig(isAuthoritativeChildMode()
                ? { ...params, autoplay: false }
                : params, getCurrentRuntimeVersion()));
            // `Rive.reset()` tears down the runtime's own canvas mouse/touch
            // listeners (inside `cleanupInstances()`) but, unlike `play()`,
            // never re-registers them. Without this call pointer/hover input
            // silently stops reaching the state machine after an in-place
            // reset until the next explicit `play()`.
            if (typeof riveInstance.setupRiveListeners === 'function') {
                riveInstance.setupRiveListeners();
            }
            return true;
        } catch (error) {
            pendingInPlaceReset = null;
            throw error;
        }
    }

    async function loadRiveAnimation(fileUrl, fileName, options = {}) {
        const {
            beforeUserOnLoad = null,
            forceAutoplay = false,
            configOverrides = null,
            onLoaded = null,
            onLoadError = null,
            waitForActivation = false,
        } = options || {};
        const previousPendingLoad = cancelPendingLoad;
        const generation = ++loadGeneration;
        previousPendingLoad?.(new Error('Animation load superseded.'));
        const isCurrentLoad = () => generation === loadGeneration;
        const loadSettlement = createLoadSettlement({
            onFailure: onLoadError,
            onSuccess: onLoaded,
            waitForActivation,
        });
        const notifyLoadSuccess = () => {
            if (!loadSettlement.success()) return;
            if (cancelPendingLoad === cancelThisLoad) cancelPendingLoad = null;
        };
        const notifyLoadFailure = (error) => {
            if (!loadSettlement.failure(error)) return;
            if (cancelPendingLoad === cancelThisLoad) cancelPendingLoad = null;
        };
        const cancelThisLoad = (error) => notifyLoadFailure(error);
        cancelPendingLoad = cancelThisLoad;

        if (!fileUrl) {
            showError('Please load a Rive file first');
            loadSettlement.failure(new Error('Animation file URL is unavailable.'));
            if (cancelPendingLoad === cancelThisLoad) cancelPendingLoad = null;
            return;
        }

        updateInfo(`Loading ${fileName}...`);
        resetVmInputControls('Loading ViewModel inputs...');
        logEvent('native', 'load-start', `Loading ${fileName} on ${getCurrentRuntime()}.`);

        try {
            const runtime = await ensureRuntime(getCurrentRuntime());
            if (!isCurrentLoad()) return;
            const inspectionMetadata = await inspectFile(runtime);
            if (!isCurrentLoad()) return;
            const container = elements.canvasContainer;
            if (!runtime || !container) {
                throw new Error('Runtime or canvas container is not available');
            }

            const authoritativeChildMode = Boolean(isAuthoritativeChildMode());
            if (authoritativeChildMode) {
                // Desktop has one Rive owner: the isolated visible child.
                // Retire any legacy parent player/canvas left by an older load,
                // then seed selection from the parse-once metadata before the
                // child export context is constructed.
                riveEventBridge.clear();
                cleanupRiveInstance(riveInstance);
                setRiveInstance(null);
                container.innerHTML = '';
                embeddedImageAssetCatalog?.reset?.();
                resetPlaybackChips();
                await loadAuthoritativeRiveSurface({
                    activateAuthoritativeSurface,
                    configOverrides,
                    detectDefaultStateMachineName,
                    fileBuffer: getCurrentFileBuffer(),
                    fileName,
                    fileUrl,
                    forceAutoplay,
                    getEditorConfig,
                    inspectionMetadata,
                    isCurrentLoad,
                    populateArtboardSwitcher,
                    runtimeAsset: runtime,
                    runtimeVersion: getCurrentRuntimeVersion(),
                    syncArtboardStateAfterLoad,
                    syncArtboardStateFromConfig,
                });
                if (!isCurrentLoad()) return;
                hideError();
                logEvent('native', 'load', `Loaded ${fileName} using isolated ${getCurrentRuntime()} playback.`);
                refreshInfoStrip();
                notifyLoadSuccess();
                if (loadSettlement.promise) return await loadSettlement.promise;
                return;
            }
            cleanupInstance({ preservePendingLoad: true });
            container.innerHTML = '';

            const canvas = windowRef.document.createElement('canvas');
            canvas.id = 'rive-canvas';
            container.appendChild(canvas);
            applyCanvasBackground(canvas);
            const userConfig = getEditorConfig();
            resizeCanvas(canvas, userConfig);

            const { canvasSize: _ignoredCanvasSize, ...sanitizedUserConfig } = userConfig || {};
            const effectiveUserConfig = forceAutoplay
                ? { ...sanitizedUserConfig, autoplay: true }
                : { ...sanitizedUserConfig };
            if (configOverrides && typeof configOverrides === 'object') {
                if (['stateMachine', 'stateMachines', 'animations'].some((key) => Object.hasOwn(configOverrides, key))) {
                    delete effectiveUserConfig.stateMachine;
                    delete effectiveUserConfig.stateMachines;
                    delete effectiveUserConfig.animations;
                }
                Object.assign(effectiveUserConfig, configOverrides);
            }
            const config = normalizePlaybackConfig(effectiveUserConfig, getCurrentRuntimeVersion());
            embeddedImageAssetCatalog?.reset?.();

            const userOnLoad = config.onLoad;
            const userOnLoadError = config.onLoadError;
            const userOnPlay = config.onPlay;
            const userOnPause = config.onPause;
            const userOnStop = config.onStop;
            const userOnLoop = config.onLoop || config.onloop;
            const userOnStateChange = config.onStateChange || config.onstatechange;
            delete config.onloop;
            delete config.onstatechange;
            const userOnAdvance = config.onAdvance;
            const userAssetLoader = config.assetLoader;
            const configuredStateMachines = getStateMachineNames(config);
            const hasConfiguredAnimation = Array.isArray(config.animations)
                ? config.animations.some((entry) => typeof entry === 'string' && entry.trim().length > 0)
                : (typeof config.animations === 'string' && config.animations.trim().length > 0);
            syncArtboardStateFromConfig({
                animations: config.animations,
                artboard: config.artboard,
                configuredStateMachines,
                hasConfiguredAnimation,
            });
            config.src = fileUrl;
            config.canvas = canvas;
            config.assetLoader = composeEmbeddedImageAssetLoader(
                embeddedImageAssetCatalog,
                userAssetLoader,
            );
            if (typeof config.autoBind === 'undefined') {
                config.autoBind = true;
            }
            const layoutFromConfig = config.layout && typeof config.layout === 'object' ? config.layout : {};
            const { alignment: _ignoredAlignment, fit: _ignoredFit, ...otherLayoutProps } = layoutFromConfig;
            config.layout = new runtime.Layout({
                fit: resolveRiveFit(runtime, getCurrentLayoutFit()),
                alignment: resolveRiveAlignment(runtime, getCurrentLayoutAlignment()),
                ...otherLayoutProps,
            });
            config.enableGPUCanvas = resolveGpuCanvasConfig(getCurrentRuntime(), getGpuCanvasEnabled());
            if (config.enableGPUCanvas) {
                config.useOffscreenRenderer = false;
            } else if (isCanvasBackgroundTransparent() && getCurrentRuntime() !== 'canvas' && typeof config.useOffscreenRenderer === 'undefined') {
                config.useOffscreenRenderer = true;
            }

            if (!configuredStateMachines.length && !hasConfiguredAnimation) {
                const detectedStateMachine = await detectDefaultStateMachineName(runtime, {
                    fileBuffer: getCurrentFileBuffer(),
                    fileUrl,
                    artboardName: config.artboard,
                });
                if (!isCurrentLoad()) return;
                if (detectedStateMachine) {
                    config.stateMachines = detectedStateMachine;
                    syncArtboardStateFromConfig({
                        animations: null,
                        artboard: config.artboard,
                        configuredStateMachines: [detectedStateMachine],
                        hasConfiguredAnimation: false,
                    });
                }
            }

            configureRiveLoadLifecycle({
                activateAuthoritativeSurface,
                authoritativeAutoplay: true,
                authoritativeChildMode,
                beforeUserOnLoad,
                config,
                documentRef: windowRef.document,
                fileName,
                getCurrentRuntime,
                getPlaybackState,
                getRiveInstance,
                inspectionMetadata,
                hideError,
                loadSettled: loadSettlement.isSettled,
                isCurrentLoad,
                logEvent,
                notifyLoadFailure,
                notifyLoadSuccess,
                onLoadError: userOnLoadError,
                populateArtboardSwitcher,
                refreshInfoStrip,
                renderVmInputControls,
                resizeCanvas,
                setVmControlBaselineSnapshot,
                showError,
                syncArtboardStateAfterLoad,
                takePendingInPlaceReset: () => {
                    const inPlaceReset = pendingInPlaceReset;
                    pendingInPlaceReset = null;
                    return inPlaceReset;
                },
                updateInfo,
                updatePlaybackChips,
                userConfig,
                userOnAdvance,
                userOnLoad,
                userOnLoop,
                userOnPause,
                userOnPlay,
                userOnStateChange,
                userOnStop,
            });

            Object.keys(config).forEach((key) => {
                if (config[key] === undefined) {
                    delete config[key];
                }
            });

            const candidateInstance = new runtime.Rive(normalizePlaybackConfig(config, getCurrentRuntimeVersion()));
            if (!isCurrentLoad()) {
                candidateInstance?.cleanup?.();
                return;
            }
            setRiveInstance(candidateInstance);
            riveEventBridge.attach(runtime, candidateInstance);
            if (loadSettlement.promise) {
                return await loadSettlement.promise;
            }
        } catch (error) {
            if (!isCurrentLoad()) return;
            showError(`Error initializing Rive: ${error.message}`);
            logEvent('native', 'init-error', 'Error initializing runtime instance.', error);
            notifyLoadFailure(error);
            throw error;
        }
    }
    return {
        cleanupInstance,
        getRiveInstance,
        handleResize,
        loadRiveAnimation,
        resetRiveInstance,
    };
}
