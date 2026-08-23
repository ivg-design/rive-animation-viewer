import {
    createRiveInstanceController,
    safelyInvokeUserCallback,
} from '../../../src/app/rive/instance-controller.js';
import { RAV_ANIMATION_LOADED_EVENT } from '../../../src/app/rive/control-events.js';

function createElements() {
    document.body.innerHTML = `
        <div id="canvas-container"></div>
        <div id="artboard-switcher"></div>
    `;

    return {
        artboardSwitcher: document.getElementById('artboard-switcher'),
        canvasContainer: document.getElementById('canvas-container'),
    };
}

describe('rive/instance-controller', () => {
    it('guards user callbacks from throwing', () => {
        const callback = vi.fn(() => {
            throw new Error('bad callback');
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(() => safelyInvokeUserCallback(callback, { type: 'play' }, 'onPlay')).not.toThrow();
        expect(callback).toHaveBeenCalledWith({ type: 'play' });
        expect(warnSpy).toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    it('loads a Rive instance, applies detected defaults, and wires runtime callbacks', async () => {
        const elements = createElements();
        Object.defineProperty(elements.canvasContainer, 'clientWidth', { configurable: true, value: 640 });
        Object.defineProperty(elements.canvasContainer, 'clientHeight', { configurable: true, value: 360 });

        let capturedConfig = null;
        let instance = null;
        const loadOrder = [];
        const userOnLoad = vi.fn(() => {
            loadOrder.push('userOnLoad');
        });
        const runtime = {
            Alignment: { TopLeft: Symbol('TopLeft') },
            EventType: { RiveEvent: 'rive-event' },
            Fit: { Contain: Symbol('Contain') },
            Layout: class Layout {
                constructor(config) {
                    Object.assign(this, config);
                }
            },
            Rive: vi.fn((config) => {
                capturedConfig = config;
                instance = {
                    cleanup: vi.fn(),
                    off: vi.fn(),
                    on: vi.fn(),
                    playingStateMachineNames: [],
                    reset: vi.fn(() => config.onLoad()),
                    resizeDrawingSurfaceToCanvas: vi.fn(),
                    stateMachineNames: ['DetectedSM'],
                    viewModelInstance: { name: 'VM' },
                };
                return instance;
            }),
        };
        const callbacks = {
            applyCanvasBackground: vi.fn((canvas) => {
                canvas.style.background = '#0d1117';
            }),
            detectDefaultStateMachineName: vi.fn().mockResolvedValue('DetectedSM'),
            ensureRuntime: vi.fn().mockResolvedValue(runtime),
            hideError: vi.fn(),
            isCanvasBackgroundTransparent: () => true,
            logEvent: vi.fn(),
            populateArtboardSwitcher: vi.fn(),
            refreshInfoStrip: vi.fn(),
            renderVmInputControls: vi.fn(() => {
                loadOrder.push('renderVmInputControls');
            }),
            resetPlaybackChips: vi.fn(),
            resetVmInputControls: vi.fn(),
            setVmControlBaselineSnapshot: vi.fn(() => {
                loadOrder.push('setVmControlBaselineSnapshot');
            }),
            showError: vi.fn(),
            syncArtboardStateAfterLoad: vi.fn(),
            syncArtboardStateFromConfig: vi.fn(),
            updateInfo: vi.fn(),
            updatePlaybackChips: vi.fn(),
        };
        const controller = createRiveInstanceController({
            callbacks,
            elements,
            getCurrentLayoutAlignment: () => 'topLeft',
            getCurrentFileBuffer: () => new ArrayBuffer(4),
            getCurrentLayoutFit: () => 'contain',
            getCurrentRuntime: () => 'webgl2',
            getEditorConfig: () => ({
                autoplay: false,
                layout: {
                    alignment: Symbol('editor-alignment-must-not-win'),
                    fit: Symbol('editor-fit-must-not-win'),
                    layoutScaleFactor: 2,
                },
                onLoad: userOnLoad,
            }),
            windowRef: window,
        });

        const animationLoadedEvents = [];
        const onAnimationLoaded = (event) => animationLoadedEvents.push(event.detail);
        document.addEventListener(RAV_ANIMATION_LOADED_EVENT, onAnimationLoaded);

        await controller.loadRiveAnimation('blob:demo', 'demo.riv', {
            beforeUserOnLoad: () => {
                loadOrder.push('beforeUserOnLoad');
            },
            onLoaded: () => {
                loadOrder.push('onLoaded');
            },
        });

        expect(callbacks.ensureRuntime).toHaveBeenCalledWith('webgl2');
        expect(capturedConfig).toEqual(expect.objectContaining({
            autoBind: true,
            canvas: expect.any(HTMLCanvasElement),
            src: 'blob:demo',
            stateMachines: 'DetectedSM',
            useOffscreenRenderer: true,
        }));
        expect(callbacks.applyCanvasBackground).toHaveBeenCalledWith(capturedConfig.canvas);
        expect(capturedConfig.canvas.style.background).toBe('rgb(13, 17, 23)');
        expect(capturedConfig.layout).toEqual(expect.objectContaining({
            alignment: runtime.Alignment.TopLeft,
            fit: runtime.Fit.Contain,
            layoutScaleFactor: 2,
        }));
        expect(callbacks.syncArtboardStateFromConfig).toHaveBeenLastCalledWith({
            animations: null,
            artboard: undefined,
            configuredStateMachines: ['DetectedSM'],
            hasConfiguredAnimation: false,
        });
        expect(controller.getRiveInstance()).toBe(instance);
        expect(window.riveInst).toBe(instance);

        capturedConfig.onAdvance({});
        expect(callbacks.updatePlaybackChips).toHaveBeenCalled();

        capturedConfig.onLoad();
        expect(callbacks.hideError).toHaveBeenCalled();
        expect(callbacks.renderVmInputControls).toHaveBeenCalled();
        expect(callbacks.populateArtboardSwitcher).toHaveBeenCalled();
        expect(callbacks.syncArtboardStateAfterLoad).toHaveBeenCalledWith(instance, capturedConfig);
        expect(callbacks.updateInfo).toHaveBeenNthCalledWith(1, 'Loading demo.riv...');
        expect(callbacks.updateInfo).toHaveBeenNthCalledWith(2, 'Loaded: [SM] DetectedSM · [VM] VM');
        expect(userOnLoad).toHaveBeenCalled();
        expect(loadOrder).toEqual([
            'beforeUserOnLoad',
            'userOnLoad',
            'renderVmInputControls',
            'setVmControlBaselineSnapshot',
            'onLoaded',
        ]);
        expect(animationLoadedEvents).toHaveLength(1);

        const restoreAfterReset = vi.fn();
        expect(controller.resetRiveInstance(
            { autoplay: true, stateMachines: 'DetectedSM' },
            { beforeUserOnLoad: restoreAfterReset },
        )).toBe(true);
        expect(instance.reset).toHaveBeenCalledWith({ autoplay: true, stateMachines: 'DetectedSM' });
        expect(restoreAfterReset).toHaveBeenCalledTimes(1);
        expect(animationLoadedEvents).toHaveLength(1);
        document.removeEventListener(RAV_ANIMATION_LOADED_EVENT, onAnimationLoaded);

        const riveEventListener = instance.on.mock.calls[0][1];
        riveEventListener({ data: { name: 'ButtonPressed' } });
        expect(callbacks.logEvent).toHaveBeenCalledWith('rive-user', 'ButtonPressed', '', { name: 'ButtonPressed' });

        const playEvent = { type: 'play' };
        const pauseEvent = { type: 'pause' };
        const stopEvent = { type: 'stop' };
        const loopEvent = { type: 'loop' };
        const stateChangeEvent = { type: 'statechange' };
        capturedConfig.onPlay(playEvent);
        capturedConfig.onPause(pauseEvent);
        capturedConfig.onStop(stopEvent);
        capturedConfig.onLoop(loopEvent);
        capturedConfig.onStateChange(stateChangeEvent);

        expect(callbacks.logEvent).toHaveBeenCalledWith('native', 'play', 'Playback started by runtime.', playEvent);
        expect(callbacks.logEvent).toHaveBeenCalledWith('native', 'pause', 'Playback paused by runtime.', pauseEvent);
        expect(callbacks.logEvent).toHaveBeenCalledWith('native', 'stop', 'Playback stopped by runtime.', stopEvent);
        expect(callbacks.logEvent).toHaveBeenCalledWith('native', 'loop', 'Loop event emitted by runtime.', loopEvent);
        expect(callbacks.logEvent).toHaveBeenCalledWith('native', 'statechange', 'State machine changed state.', stateChangeEvent);
    });

    it('resizes and cleans up the active instance', async () => {
        const elements = createElements();
        const cleanupOrder = [];
        Object.defineProperty(elements.canvasContainer, 'clientWidth', { configurable: true, value: 400 });
        Object.defineProperty(elements.canvasContainer, 'clientHeight', { configurable: true, value: 220 });

        let capturedConfig = null;
        const callbacks = {
            detectDefaultStateMachineName: vi.fn().mockResolvedValue(null),
            ensureRuntime: vi.fn().mockResolvedValue({
                EventType: { RiveEvent: 'rive-event' },
                Layout: class Layout {
                    constructor(config) {
                        Object.assign(this, config);
                    }
                },
                Rive: vi.fn((config) => {
                    capturedConfig = config;
                    return {
                        cleanup: vi.fn(() => cleanupOrder.push('rive-cleanup')),
                        off: vi.fn(),
                        on: vi.fn(),
                        resizeDrawingSurfaceToCanvas: vi.fn(),
                        stateMachineNames: [],
                    };
                }),
            }),
            hideError: vi.fn(),
            logEvent: vi.fn(),
            populateArtboardSwitcher: vi.fn(),
            refreshInfoStrip: vi.fn(),
            renderVmInputControls: vi.fn(),
            resetPlaybackChips: vi.fn(),
            resetVmInputControls: vi.fn(() => cleanupOrder.push('vm-reset')),
            showError: vi.fn(),
            syncArtboardStateAfterLoad: vi.fn(),
            syncArtboardStateFromConfig: vi.fn(),
            updateInfo: vi.fn(),
            updatePlaybackChips: vi.fn(),
        };
        const controller = createRiveInstanceController({
            callbacks,
            elements,
            getCurrentFileBuffer: () => null,
            getCurrentLayoutFit: () => 'cover',
            getCurrentRuntime: () => 'canvas',
            getEditorConfig: () => ({}),
            windowRef: window,
        });

        await controller.loadRiveAnimation('blob:demo', 'demo.riv');
        capturedConfig.onLoad();

        const canvas = document.getElementById('rive-canvas');
        expect(canvas.width).toBe(400);
        expect(canvas.height).toBe(220);

        Object.defineProperty(elements.canvasContainer, 'clientWidth', { configurable: true, value: 300 });
        Object.defineProperty(elements.canvasContainer, 'clientHeight', { configurable: true, value: 150 });
        controller.handleResize();

        expect(canvas.width).toBe(300);
        expect(canvas.height).toBe(150);

        controller.cleanupInstance();
        expect(callbacks.resetPlaybackChips).toHaveBeenCalled();
        expect(callbacks.resetVmInputControls).toHaveBeenCalledWith('No animation loaded.');
        expect(cleanupOrder.slice(-2)).toEqual(['vm-reset', 'rive-cleanup']);
        expect(controller.getRiveInstance()).toBeNull();
    });

    it('honors explicit fixed canvas sizing from shared state', async () => {
        const elements = createElements();
        Object.defineProperty(elements.canvasContainer, 'clientWidth', { configurable: true, value: 640 });
        Object.defineProperty(elements.canvasContainer, 'clientHeight', { configurable: true, value: 360 });
        Object.defineProperty(elements.canvasContainer, 'scrollLeft', { configurable: true, writable: true, value: 0 });
        Object.defineProperty(elements.canvasContainer, 'scrollTop', { configurable: true, writable: true, value: 0 });
        const originalRequestAnimationFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => {
            callback();
            return 1;
        };
        try {
            let capturedConfig = null;
            const controller = createRiveInstanceController({
                callbacks: {
                    detectDefaultStateMachineName: vi.fn().mockResolvedValue(null),
                    ensureRuntime: vi.fn().mockResolvedValue({
                        EventType: { RiveEvent: 'rive-event' },
                        Layout: class Layout {
                            constructor(config) {
                                Object.assign(this, config);
                            }
                        },
                        Rive: vi.fn((config) => {
                            capturedConfig = config;
                            return {
                                cleanup: vi.fn(),
                                off: vi.fn(),
                                on: vi.fn(),
                                resizeDrawingSurfaceToCanvas: vi.fn(),
                                stateMachineNames: [],
                            };
                        }),
                    }),
                    hideError: vi.fn(),
                    logEvent: vi.fn(),
                    populateArtboardSwitcher: vi.fn(),
                    refreshInfoStrip: vi.fn(),
                    renderVmInputControls: vi.fn(),
                    resetPlaybackChips: vi.fn(),
                    resetVmInputControls: vi.fn(),
                    showError: vi.fn(),
                    syncArtboardStateAfterLoad: vi.fn(),
                    syncArtboardStateFromConfig: vi.fn(),
                    updateInfo: vi.fn(),
                    updatePlaybackChips: vi.fn(),
                },
                elements,
                getCurrentCanvasSizing: () => ({
                    mode: 'fixed',
                    width: 1920,
                    height: 1080,
                    lockAspectRatio: true,
                    aspectRatio: 16 / 9,
                }),
                getCurrentRuntime: () => 'webgl2',
                getEditorConfig: () => ({}),
                windowRef: window,
            });

            await controller.loadRiveAnimation('blob:demo', 'demo.riv');
            capturedConfig.onLoad();

            const canvas = document.getElementById('rive-canvas');
            expect(canvas.width).toBe(1920);
            expect(canvas.height).toBe(1080);
            expect(canvas.style.width).toBe('1920px');
            expect(canvas.style.height).toBe('1080px');
            expect(elements.canvasContainer.classList.contains('canvas-container-fixed-size')).toBe(true);
            expect(canvas.classList.contains('rive-canvas-fixed-size')).toBe(true);
            expect(elements.canvasContainer.scrollLeft).toBe(640);
            expect(elements.canvasContainer.scrollTop).toBe(360);
        } finally {
            window.requestAnimationFrame = originalRequestAnimationFrame;
        }
    });

    it('reports missing files, initialization failures, and load errors', async () => {
        const elements = createElements();
        const showError = vi.fn();
        const logEvent = vi.fn();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const loadErrorUserCallback = vi.fn(() => {
            throw new Error('user onLoadError failed');
        });
        let capturedConfig = null;
        const controller = createRiveInstanceController({
            callbacks: {
                detectDefaultStateMachineName: vi.fn().mockResolvedValue(null),
                ensureRuntime: vi.fn()
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce({
                        EventType: { RiveEvent: null },
                        Layout: class Layout {
                            constructor(config) {
                                Object.assign(this, config);
                            }
                        },
                        Rive: vi.fn((config) => {
                            capturedConfig = config;
                            return {
                                cleanup: vi.fn(),
                                off: vi.fn(),
                                on: vi.fn(),
                                resizeDrawingSurfaceToCanvas: vi.fn(),
                                stateMachineNames: [],
                            };
                        }),
                    }),
                hideError: vi.fn(),
                isCanvasBackgroundTransparent: () => false,
                logEvent,
                populateArtboardSwitcher: vi.fn(),
                refreshInfoStrip: vi.fn(),
                renderVmInputControls: vi.fn(),
                resetPlaybackChips: vi.fn(),
                resetVmInputControls: vi.fn(),
                showError,
                syncArtboardStateAfterLoad: vi.fn(),
                syncArtboardStateFromConfig: vi.fn(),
                updateInfo: vi.fn(),
                updatePlaybackChips: vi.fn(),
            },
            elements,
            getCurrentFileBuffer: () => null,
            getCurrentLayoutFit: () => 'contain',
            getCurrentRuntime: () => 'webgl2',
            getEditorConfig: () => ({
                onLoadError: loadErrorUserCallback,
                stateMachines: '',
            }),
            windowRef: window,
        });

        await expect(controller.loadRiveAnimation(null, 'demo.riv')).resolves.toBeUndefined();
        await expect(controller.loadRiveAnimation('blob:demo', 'demo.riv')).rejects.toThrow(
            'Runtime or canvas container is not available',
        );

        await controller.loadRiveAnimation('blob:demo', 'demo.riv');
        capturedConfig.onLoadError(new Error('bad file'));

        expect(showError).toHaveBeenCalledWith('Please load a Rive file first');
        expect(showError).toHaveBeenCalledWith('Error initializing Rive: Runtime or canvas container is not available');
        expect(showError).toHaveBeenCalledWith('Error loading animation: bad file');
        expect(logEvent).toHaveBeenCalledWith(
            'native',
            'init-error',
            'Error initializing runtime instance.',
            expect.any(Error),
        );
        expect(logEvent).toHaveBeenCalledWith(
            'native',
            'loaderror',
            'Load error for demo.riv.',
            expect.any(Error),
        );
        expect(warnSpy).toHaveBeenCalledWith('[rive-viewer] runtime.EventType.RiveEvent is falsy');

        warnSpy.mockRestore();
    });

    it('executes default callback paths safely with a minimal runtime', async () => {
        const elements = createElements();
        Object.defineProperty(elements.canvasContainer, 'clientWidth', { configurable: true, value: 320 });
        Object.defineProperty(elements.canvasContainer, 'clientHeight', { configurable: true, value: 180 });

        let capturedConfig = null;
        const controller = createRiveInstanceController({
            callbacks: {
                ensureRuntime: vi.fn().mockResolvedValue({
                    EventType: { RiveEvent: 'rive-event' },
                    Layout: class Layout {
                        constructor(config) {
                            Object.assign(this, config);
                        }
                    },
                    Rive: vi.fn((config) => {
                        capturedConfig = config;
                        return {
                            cleanup: vi.fn(),
                            off: vi.fn(),
                            on: vi.fn(),
                            resizeDrawingSurfaceToCanvas: vi.fn(),
                            stateMachineNames: [],
                        };
                    }),
                }),
            },
            elements,
            getCurrentFileBuffer: () => Uint8Array.from([1, 2, 3]).buffer,
            getEditorConfig: () => ({
                stateMachines: 'Preset',
            }),
            windowRef: window,
        });

        await expect(controller.loadRiveAnimation('blob:demo', 'demo.riv')).resolves.toBeUndefined();
        expect(capturedConfig).toEqual(expect.objectContaining({
            autoBind: true,
            src: 'blob:demo',
            stateMachines: 'Preset',
        }));

        capturedConfig.onAdvance({ type: 'advance' });
        capturedConfig.onLoad();
        controller.handleResize();
        controller.cleanupInstance();

        expect(controller.getRiveInstance()).toBeNull();
    });
});
