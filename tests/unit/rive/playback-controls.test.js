import { createPlaybackController } from '../../../src/app/rive/playback-controls.js';

function createHarness(overrides = {}) {
    let currentFileName = 'currentFileName' in overrides ? overrides.currentFileName : 'demo.riv';
    let currentFileUrl = 'currentFileUrl' in overrides ? overrides.currentFileUrl : 'blob:demo';
    let playbackState = overrides.playbackState ?? {
        currentPlaybackName: 'Bounce',
        currentPlaybackType: 'animation',
    };
    let riveInstance = overrides.riveInstance ?? null;

    const callbacks = {
        applyVmControlSnapshot: vi.fn(() => 2),
        captureVmControlSnapshot: vi.fn(() => [{ id: 'speed' }]),
        loadRiveAnimation: vi.fn().mockResolvedValue(undefined),
        logEvent: vi.fn(),
        showError: vi.fn(),
        updateInfo: vi.fn(),
        ...overrides.callbacks,
    };

    const controller = createPlaybackController({
        callbacks,
        getCurrentFileName: () => currentFileName,
        getCurrentFileUrl: () => currentFileUrl,
        getPlaybackState: () => playbackState,
        getRiveInstance: () => riveInstance,
        now: overrides.now ?? (() => 1000),
    });

    return {
        callbacks,
        controller,
        setFile(url, name) {
            currentFileUrl = url;
            currentFileName = name;
        },
        setPlaybackState(nextState) {
            playbackState = nextState;
        },
        setRiveInstance(nextInstance) {
            riveInstance = nextInstance;
        },
    };
}

describe('rive/playback-controls', () => {
    it('restarts finished one-shot animations using the tracked playback state', () => {
        const riveInstance = {
            isPlaying: false,
            play: vi.fn(),
            stop: vi.fn(),
        };
        const harness = createHarness({ riveInstance });

        harness.controller.play();

        expect(riveInstance.stop).toHaveBeenCalled();
        expect(riveInstance.play).toHaveBeenCalledWith('Bounce');
        expect(harness.callbacks.updateInfo).toHaveBeenCalledWith('Playing: [ANIM] Bounce');
    });

    it('pauses active playback when an instance is available', () => {
        const riveInstance = {
            pause: vi.fn(),
        };
        const harness = createHarness({ riveInstance });

        harness.controller.pause();

        expect(riveInstance.pause).toHaveBeenCalled();
        expect(harness.callbacks.updateInfo).toHaveBeenCalledWith('Paused: [ANIM] Bounce');
        expect(harness.callbacks.logEvent).toHaveBeenCalledWith('ui', 'pause', 'Playback paused from UI.');
    });

    it('resets the animation with autoplay and restores VM controls', async () => {
        const callbacks = {
            loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                options?.onLoaded?.();
            }),
        };
        const harness = createHarness({ callbacks, riveInstance: {} });

        await harness.controller.reset();

        expect(callbacks.loadRiveAnimation).toHaveBeenCalledWith('blob:demo', 'demo.riv', expect.objectContaining({
            forceAutoplay: true,
        }));
        expect(harness.callbacks.captureVmControlSnapshot).toHaveBeenCalled();
        expect(harness.callbacks.applyVmControlSnapshot).toHaveBeenCalledWith([{ id: 'speed' }]);
        expect(harness.callbacks.logEvent).toHaveBeenCalledWith('ui', 'reset-complete', 'Animation restarted with autoplay (2 controls restored).');
    });

    it('updates and resets the FPS chip state', () => {
        const fpsChip = document.createElement('div');
        fpsChip.id = 'fps-chip';
        document.body.appendChild(fpsChip);

        let tick = 0;
        const harness = createHarness({
            now: () => {
                tick += 1000;
                return tick;
            },
        });

        harness.controller.resetPlaybackChips();
        expect(fpsChip.innerHTML).toContain('-- FPS');

        harness.controller.updatePlaybackChips();
        expect(fpsChip.innerHTML).toContain('1 FPS');
    });

    it('no-ops play and pause when no instance is available and plays current state for non-animation targets', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const harness = createHarness({ riveInstance: null });

        harness.controller.play();
        harness.controller.pause();

        expect(warnSpy).toHaveBeenCalledWith('[rive-viewer] play() called but no riveInstance');
        expect(harness.callbacks.updateInfo).not.toHaveBeenCalledWith('Paused');

        const riveInstance = {
            isPlaying: true,
            play: vi.fn(),
            stop: vi.fn(),
        };
        harness.setRiveInstance(riveInstance);
        harness.setPlaybackState({ currentPlaybackName: 'Main', currentPlaybackType: 'stateMachine' });

        harness.controller.play();

        expect(riveInstance.stop).not.toHaveBeenCalled();
        expect(riveInstance.play).toHaveBeenCalledWith();
        warnSpy.mockRestore();
    });

    it('reports reset validation and runtime failures', async () => {
        const failingCallbacks = {
            loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                options?.onLoadError?.(new Error('boom'));
            }),
        };
        const missingFileHarness = createHarness({
            callbacks: failingCallbacks,
            currentFileName: null,
            currentFileUrl: null,
            riveInstance: {},
        });
        const failingHarness = createHarness({
            callbacks: failingCallbacks,
            riveInstance: {},
        });

        await missingFileHarness.controller.reset();
        await failingHarness.controller.reset();

        expect(missingFileHarness.callbacks.showError).toHaveBeenCalledWith('Please load a Rive file first');
        expect(failingHarness.callbacks.showError).toHaveBeenCalledWith('Failed to restart animation: boom');
        expect(failingHarness.callbacks.logEvent).toHaveBeenCalledWith(
            'ui',
            'reset-error',
            'Failed to restart animation from UI.',
            expect.any(Error),
        );
    });

    it('executes the default callback paths safely', async () => {
        const riveInstance = {
            isPlaying: false,
            pause: vi.fn(),
            play: vi.fn(),
            stop: vi.fn(),
        };
        const controller = createPlaybackController({
            callbacks: {
                loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                    options?.onLoaded?.();
                }),
            },
            getCurrentFileName: () => 'demo.riv',
            getCurrentFileUrl: () => 'blob:demo',
            getPlaybackState: () => ({
                currentPlaybackName: 'Bounce',
                currentPlaybackType: 'animation',
            }),
            getRiveInstance: () => riveInstance,
        });
        const missingFileController = createPlaybackController();

        controller.play();
        controller.pause();
        await expect(controller.reset()).resolves.toBeUndefined();
        await expect(missingFileController.reset()).resolves.toBeUndefined();

        expect(riveInstance.stop).toHaveBeenCalled();
        expect(riveInstance.pause).toHaveBeenCalled();
    });
});
