import { createPlaybackController } from '../../../src/app/rive/playback-controls.js';
import { RAV_PLAYBACK_COMMAND_EVENT } from '../../../src/app/rive/control-events.js';

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
        isAuthoritativeChildMode: () => Boolean(overrides.authoritativeChildMode),
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

    it('resets in place with autoplay, restores VM controls, and relays the same reset to the child', async () => {
        const loadOrder = [];
        const resetRiveInstance = vi.fn((_params, options) => {
            options?.beforeUserOnLoad?.();
            return true;
        });
        const callbacks = {
            applyVmControlSnapshot: vi.fn(() => {
                loadOrder.push('restoreVmControls');
                return 2;
            }),
            loadRiveAnimation: vi.fn(async (_url, _name, options) => {
                options?.beforeUserOnLoad?.();
                loadOrder.push('onLoaded');
                options?.onLoaded?.();
            }),
            resetRiveInstance,
        };
        const harness = createHarness({
            callbacks,
            playbackState: {
                currentArtboard: 'Main',
                currentPlaybackName: 'Bounce',
                currentPlaybackType: 'animation',
                currentVmInstanceName: 'Board',
            },
            riveInstance: {},
        });
        const playbackCommands = [];
        document.addEventListener(
            RAV_PLAYBACK_COMMAND_EVENT,
            (event) => playbackCommands.push(event.detail),
            { once: true },
        );

        await harness.controller.reset();

        expect(callbacks.loadRiveAnimation).not.toHaveBeenCalled();
        expect(resetRiveInstance).toHaveBeenCalledWith({
            animations: 'Bounce',
            artboard: 'Main',
            autoBind: false,
            autoplay: true,
            stateMachines: undefined,
            viewModelInstanceName: 'Board',
        }, expect.objectContaining({ beforeUserOnLoad: expect.any(Function) }));
        expect(harness.callbacks.captureVmControlSnapshot).toHaveBeenCalled();
        expect(harness.callbacks.applyVmControlSnapshot).toHaveBeenCalledWith([{ id: 'speed' }]);
        expect(loadOrder).toEqual(['restoreVmControls']);
        expect(playbackCommands.at(-1)).toEqual({
            command: 'reset',
            payload: {
                params: expect.objectContaining({ animations: 'Bounce', artboard: 'Main', autoplay: true }),
                snapshot: [{ id: 'speed' }],
            },
        });
        expect(harness.callbacks.logEvent).toHaveBeenCalledWith(
            'ui',
            'reset-complete',
            'Animation restarted in place with autoplay (2 controls restored).',
        );
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
        const harness = createHarness({ riveInstance: null });

        harness.controller.play();
        harness.controller.pause();

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
    });

    it('waits for child acknowledgement for play and pause without touching the hidden parent', async () => {
        const requestAuthoritativeCommand = vi.fn(async (command) => ({ applied: true, command, status: 'applied' }));
        const riveInstance = { pause: vi.fn(), play: vi.fn(), stop: vi.fn() };
        const harness = createHarness({
            authoritativeChildMode: true,
            callbacks: { requestAuthoritativeCommand },
            riveInstance,
        });

        await expect(harness.controller.play()).resolves.toEqual({ applied: true, status: 'applied' });
        await expect(harness.controller.pause()).resolves.toEqual({ applied: true, status: 'applied' });
        expect(requestAuthoritativeCommand).toHaveBeenNthCalledWith(1, 'play', { name: 'Bounce' });
        expect(requestAuthoritativeCommand).toHaveBeenNthCalledWith(2, 'pause');
        expect(riveInstance.play).not.toHaveBeenCalled();
        expect(riveInstance.pause).not.toHaveBeenCalled();
        expect(riveInstance.stop).not.toHaveBeenCalled();
    });

    it('does not report child playback success when acknowledgement is rejected', async () => {
        const requestAuthoritativeCommand = vi.fn(async () => ({ applied: false, status: 'rejected' }));
        const harness = createHarness({
            authoritativeChildMode: true,
            callbacks: { requestAuthoritativeCommand },
        });

        await expect(harness.controller.play()).resolves.toEqual({ applied: false, status: 'rejected' });
        expect(harness.callbacks.showError).toHaveBeenCalledWith('Unable to start playback: rejected');
        expect(harness.callbacks.updateInfo).not.toHaveBeenCalled();
    });

    it('resets only the authoritative child and resolves after its rendered-frame acknowledgement', async () => {
        let acknowledge;
        const requestAuthoritativeCommand = vi.fn(() => new Promise((resolve) => { acknowledge = resolve; }));
        const resetRiveInstance = vi.fn();
        const loadRiveAnimation = vi.fn();
        const harness = createHarness({
            authoritativeChildMode: true,
            callbacks: { loadRiveAnimation, requestAuthoritativeCommand, resetRiveInstance },
            playbackState: {
                currentArtboard: 'Main',
                currentPlaybackName: 'Bounce',
                currentPlaybackType: 'animation',
                currentVmInstanceName: 0,
            },
        });

        const resetPromise = harness.controller.reset();
        await vi.waitFor(() => expect(requestAuthoritativeCommand).toHaveBeenCalledWith('reset', expect.objectContaining({
            params: expect.objectContaining({
                animations: 'Bounce', artboard: 'Main', autoBind: false, viewModelInstanceName: 0,
            }),
            snapshot: [{ id: 'speed' }],
        })));
        expect(harness.callbacks.updateInfo).toHaveBeenLastCalledWith('Restarting demo.riv...');
        acknowledge({ applied: true, status: 'applied' });
        await expect(resetPromise).resolves.toEqual({ applied: true, status: 'applied' });
        expect(resetRiveInstance).not.toHaveBeenCalled();
        expect(loadRiveAnimation).not.toHaveBeenCalled();
        expect(harness.callbacks.updateInfo).toHaveBeenLastCalledWith('Restarted demo.riv');
    });

    it('does not report reset success when runtime-list snapshot restoration is rejected', async () => {
        const requestAuthoritativeCommand = vi.fn(async () => ({
            applied: false,
            message: 'Playback reset could not restore 1 control value.',
            status: 'rejected',
        }));
        const harness = createHarness({
            authoritativeChildMode: true,
            callbacks: { requestAuthoritativeCommand },
        });

        await harness.controller.reset();

        expect(harness.callbacks.showError).toHaveBeenCalledWith(
            'Failed to restart animation: Playback reset could not restore 1 control value.',
        );
        expect(harness.callbacks.updateInfo).not.toHaveBeenCalledWith('Restarted demo.riv');
        expect(harness.callbacks.logEvent).not.toHaveBeenCalledWith(
            'ui',
            'reset-complete',
            expect.any(String),
        );
    });

    it('keeps auto-bound ViewModel selection explicit when resetting the visible child', async () => {
        const requestAuthoritativeCommand = vi.fn(async () => ({ applied: true, status: 'applied' }));
        const harness = createHarness({
            authoritativeChildMode: true,
            callbacks: { requestAuthoritativeCommand },
            playbackState: {
                currentArtboard: 'Main',
                currentPlaybackName: 'Bounce',
                currentPlaybackType: 'animation',
                currentVmInstanceName: '__rav_auto_bound__',
            },
        });

        await harness.controller.reset();

        expect(requestAuthoritativeCommand).toHaveBeenCalledWith('reset', expect.objectContaining({
            params: expect.objectContaining({ autoBind: true, viewModelInstanceName: null }),
        }));
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
