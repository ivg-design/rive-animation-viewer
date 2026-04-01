import {
    createRiveInstanceController,
    safelyInvokeUserCallback,
} from '../../../src/app/rive/instance-controller.js';

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
        const userOnLoad = vi.fn();
        const callbacks = {
            cleanupTransparencyRuntime: vi.fn().mockResolvedValue(undefined),
            detectDefaultStateMachineName: vi.fn().mockResolvedValue('DetectedSM'),
            ensureRuntime: vi.fn().mockResolvedValue({
                EventType: { RiveEvent: 'rive-event' },
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
                        resizeDrawingSurfaceToCanvas: vi.fn(),
                        stateMachineNames: ['DetectedSM'],
                        viewModelInstance: { name: 'VM' },
                    };
                    return instance;
                }),
            }),
            hideError: vi.fn(),
            isCanvasEffectivelyTransparent: () => true,
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
        };
        const controller = createRiveInstanceController({
            callbacks,
            elements,
            getCurrentFileBuffer: () => new ArrayBuffer(4),
            getCurrentLayoutFit: () => 'contain',
            getCurrentRuntime: () => 'webgl2',
            getEditorConfig: () => ({
                autoplay: false,
                onLoad: userOnLoad,
            }),
            windowRef: window,
        });

        await controller.loadRiveAnimation('blob:demo', 'demo.riv');

        expect(callbacks.ensureRuntime).toHaveBeenCalledWith('webgl2');
        expect(capturedConfig).toEqual(expect.objectContaining({
            autoBind: true,
            canvas: expect.any(HTMLCanvasElement),
            src: 'blob:demo',
            stateMachines: 'DetectedSM',
            useOffscreenRenderer: true,
        }));
        expect(capturedConfig.layout).toEqual(expect.objectContaining({
            alignment: 'center',
            fit: 'contain',
        }));
        expect(controller.getRiveInstance()).toBe(instance);
        expect(window.riveInst).toBe(instance);

        capturedConfig.onAdvance({});
        expect(callbacks.updatePlaybackChips).toHaveBeenCalled();

        capturedConfig.onLoad();
        expect(callbacks.hideError).toHaveBeenCalled();
        expect(callbacks.renderVmInputControls).toHaveBeenCalled();
        expect(callbacks.populateArtboardSwitcher).toHaveBeenCalled();
        expect(callbacks.syncArtboardStateAfterLoad).toHaveBeenCalledWith(instance, capturedConfig);
        expect(callbacks.updateInfo).toHaveBeenCalledWith('Loaded: demo.riv (webgl2) - state machine "DetectedSM" active');
        expect(userOnLoad).toHaveBeenCalled();

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
        Object.defineProperty(elements.canvasContainer, 'clientWidth', { configurable: true, value: 400 });
        Object.defineProperty(elements.canvasContainer, 'clientHeight', { configurable: true, value: 220 });

        let capturedConfig = null;
        const callbacks = {
            cleanupTransparencyRuntime: vi.fn().mockResolvedValue(undefined),
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
        expect(callbacks.cleanupTransparencyRuntime).toHaveBeenCalled();
        expect(callbacks.resetPlaybackChips).toHaveBeenCalled();
        expect(callbacks.resetVmInputControls).toHaveBeenCalledWith('No animation loaded.');
        expect(controller.getRiveInstance()).toBeNull();
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
                cleanupTransparencyRuntime: vi.fn().mockResolvedValue(undefined),
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
                isCanvasEffectivelyTransparent: () => false,
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
