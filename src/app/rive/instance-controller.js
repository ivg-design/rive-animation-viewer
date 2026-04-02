export function safelyInvokeUserCallback(callback, event, callbackName) {
    if (typeof callback !== 'function') {
        return;
    }
    try {
        callback(event);
    } catch (error) {
        console.warn(`Error in user ${callbackName}:`, error);
    }
}

export function createRiveInstanceController({
    callbacks = {},
    elements,
    getCurrentLayoutAlignment = () => 'center',
    getCurrentFileBuffer = () => null,
    getCurrentLayoutFit = () => 'contain',
    getCurrentRuntime = () => 'webgl2',
    getEditorConfig = () => ({}),
    windowRef = globalThis.window,
} = {}) {
    const {
        cleanupTransparencyRuntime = async () => {},
        detectDefaultStateMachineName = async () => null,
        ensureRuntime = async () => null,
        hideError = () => {},
        isCanvasEffectivelyTransparent = () => false,
        logEvent = () => {},
        populateArtboardSwitcher = () => {},
        refreshInfoStrip = () => {},
        renderVmInputControls = () => {},
        resetPlaybackChips = () => {},
        resetVmInputControls = () => {},
        showError = () => {},
        syncArtboardStateAfterLoad = () => {},
        syncArtboardStateFromConfig = () => {},
        updateInfo = () => {},
        updatePlaybackChips = () => {},
    } = callbacks;

    let riveEventUnsubscribers = [];
    let riveInstance = null;

    function getRiveInstance() {
        return riveInstance;
    }

    function clearRiveEventListeners() {
        riveEventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch {
                /* noop */
            }
        });
        riveEventUnsubscribers = [];
    }

    function attachRiveUserEventListeners(runtime, instance) {
        clearRiveEventListeners();
        if (!runtime?.EventType || !instance || typeof instance.on !== 'function') {
            console.warn('[rive-viewer] cannot attach event listeners: missing EventType or .on() method');
            return;
        }

        const eventType = runtime.EventType.RiveEvent;
        if (!eventType) {
            console.warn('[rive-viewer] runtime.EventType.RiveEvent is falsy');
            return;
        }

        const listener = (event) => {
            const payload = event?.data ?? event;
            const eventName = payload?.name || event?.name || 'unknown';
            logEvent('rive-user', eventName, '', payload);
        };

        instance.on(eventType, listener);
        riveEventUnsubscribers.push(() => {
            if (typeof instance.off === 'function') {
                instance.off(eventType, listener);
            }
        });
    }

    function resizeCanvas(canvas) {
        const container = elements.canvasContainer;
        if (!container || !canvas) {
            return;
        }
        const { clientWidth, clientHeight } = container;
        canvas.width = clientWidth;
        canvas.height = clientHeight;
    }

    function handleResize() {
        const canvas = windowRef.document?.getElementById('rive-canvas');
        if (!canvas) {
            return;
        }
        resizeCanvas(canvas);
        riveInstance?.resizeDrawingSurfaceToCanvas?.();
    }

    function cleanupInstance() {
        clearRiveEventListeners();
        resetPlaybackChips();
        if (elements.artboardSwitcher) {
            elements.artboardSwitcher.hidden = true;
        }
        cleanupTransparencyRuntime().catch(() => {
            /* noop */
        });
        if (riveInstance?.cleanup) {
            try {
                riveInstance.cleanup();
            } catch (error) {
                console.warn('[rive-viewer] cleanup error (WebGL context loss):', error.message);
            }
        }
        riveInstance = null;
        windowRef.riveInst = null;
        resetVmInputControls('No animation loaded.');
    }

    async function loadRiveAnimation(fileUrl, fileName, options = {}) {
        const {
            forceAutoplay = false,
            configOverrides = null,
            onLoaded = null,
            onLoadError = null,
        } = options || {};
        let loadSettled = false;
        const notifyLoadSuccess = () => {
            if (loadSettled) {
                return;
            }
            loadSettled = true;
            if (typeof onLoaded === 'function') {
                try {
                    onLoaded();
                } catch (error) {
                    console.warn('[rive-viewer] onLoaded callback failed:', error);
                }
            }
        };
        const notifyLoadFailure = (error) => {
            if (loadSettled) {
                return;
            }
            loadSettled = true;
            if (typeof onLoadError === 'function') {
                try {
                    onLoadError(error);
                } catch (callbackError) {
                    console.warn('[rive-viewer] onLoadError callback failed:', callbackError);
                }
            }
        };

        if (!fileUrl) {
            showError('Please load a Rive file first');
            return;
        }

        updateInfo(`Loading ${fileName} (${getCurrentRuntime()})...`);
        resetVmInputControls('Loading ViewModel inputs...');
        logEvent('native', 'load-start', `Loading ${fileName} on ${getCurrentRuntime()}.`);

        try {
            const runtime = await ensureRuntime(getCurrentRuntime());
            const container = elements.canvasContainer;
            if (!runtime || !container) {
                throw new Error('Runtime or canvas container is not available');
            }

            cleanupInstance();
            container.innerHTML = '';

            const canvas = windowRef.document.createElement('canvas');
            canvas.id = 'rive-canvas';
            container.appendChild(canvas);
            resizeCanvas(canvas);

            const userConfig = getEditorConfig();
            const effectiveUserConfig = forceAutoplay ? { ...userConfig, autoplay: true } : { ...userConfig };
            if (configOverrides && typeof configOverrides === 'object') {
                Object.assign(effectiveUserConfig, configOverrides);
            }
            const config = { ...effectiveUserConfig };

            const userOnLoad = config.onLoad;
            const userOnLoadError = config.onLoadError;
            const userOnPlay = config.onPlay;
            const userOnPause = config.onPause;
            const userOnStop = config.onStop;
            const userOnLoop = config.onLoop;
            const userOnStateChange = config.onStateChange;
            const userOnAdvance = config.onAdvance;
            const configuredStateMachines = Array.isArray(config.stateMachines)
                ? config.stateMachines.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
                : (typeof config.stateMachines === 'string' && config.stateMachines.trim().length > 0 ? [config.stateMachines] : []);
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
            if (typeof config.autoBind === 'undefined') {
                config.autoBind = true;
            }
            const layoutFromConfig = config.layout && typeof config.layout === 'object' ? config.layout : {};
            const { fit: _ignoredFit, ...otherLayoutProps } = layoutFromConfig;
            config.layout = new runtime.Layout({
                fit: getCurrentLayoutFit(),
                alignment: getCurrentLayoutAlignment(),
                ...otherLayoutProps,
            });
            if (isCanvasEffectivelyTransparent() && getCurrentRuntime() !== 'canvas' && typeof config.useOffscreenRenderer === 'undefined') {
                config.useOffscreenRenderer = true;
            }

            if (!configuredStateMachines.length && !hasConfiguredAnimation) {
                const detectedStateMachine = await detectDefaultStateMachineName(runtime, {
                    fileBuffer: getCurrentFileBuffer(),
                    fileUrl,
                    artboardName: config.artboard,
                });
                if (detectedStateMachine) {
                    config.stateMachines = detectedStateMachine;
                }
            }

            config.onLoad = () => {
                hideError();
                resizeCanvas(config.canvas);
                riveInstance?.resizeDrawingSurfaceToCanvas?.();
                logEvent('native', 'load', `Loaded ${fileName} using ${getCurrentRuntime()}.`);

                const names = Array.isArray(riveInstance?.stateMachineNames) ? riveInstance.stateMachineNames : [];
                let activeStateMachine = 'none';
                if (config.stateMachines) {
                    activeStateMachine = Array.isArray(config.stateMachines)
                        ? config.stateMachines[0]
                        : config.stateMachines;
                } else if (names.length > 0) {
                    activeStateMachine = names[0];
                }

                updateInfo(
                    names.length > 0
                        ? `Loaded: ${fileName} (${getCurrentRuntime()}) - state machine "${activeStateMachine}" active`
                        : `Loaded: ${fileName} (${getCurrentRuntime()}) - no state machines`,
                );
                syncArtboardStateAfterLoad(riveInstance, config);
                refreshInfoStrip();

                if (typeof userOnLoad === 'function') {
                    try {
                        userOnLoad();
                    } catch (error) {
                        console.warn('Error in user onLoad:', error);
                    }
                }

                renderVmInputControls();
                populateArtboardSwitcher();
                notifyLoadSuccess();
            };

            config.onLoadError = (error) => {
                const errorMsg = error?.message || error?.toString() || String(error);
                showError(`Error loading animation: ${errorMsg}`);
                logEvent('native', 'loaderror', `Load error for ${fileName}.`, error);
                safelyInvokeUserCallback(userOnLoadError, error, 'onLoadError');
                notifyLoadFailure(error);
            };
            config.onPlay = (event) => {
                logEvent('native', 'play', 'Playback started by runtime.', event);
                safelyInvokeUserCallback(userOnPlay, event, 'onPlay');
            };
            config.onPause = (event) => {
                logEvent('native', 'pause', 'Playback paused by runtime.', event);
                safelyInvokeUserCallback(userOnPause, event, 'onPause');
            };
            config.onStop = (event) => {
                logEvent('native', 'stop', 'Playback stopped by runtime.', event);
                safelyInvokeUserCallback(userOnStop, event, 'onStop');
            };
            config.onLoop = (event) => {
                logEvent('native', 'loop', 'Loop event emitted by runtime.', event);
                safelyInvokeUserCallback(userOnLoop, event, 'onLoop');
            };
            config.onStateChange = (event) => {
                logEvent('native', 'statechange', 'State machine changed state.', event);
                safelyInvokeUserCallback(userOnStateChange, event, 'onStateChange');
            };
            config.onAdvance = (event) => {
                updatePlaybackChips();
                safelyInvokeUserCallback(userOnAdvance, event, 'onAdvance');
            };

            Object.keys(config).forEach((key) => {
                if (config[key] === undefined) {
                    delete config[key];
                }
            });

            riveInstance = new runtime.Rive(config);
            windowRef.riveInst = riveInstance;
            attachRiveUserEventListeners(runtime, riveInstance);
        } catch (error) {
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
    };
}
