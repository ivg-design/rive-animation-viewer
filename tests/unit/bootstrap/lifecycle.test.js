import { createAppLifecycle } from '../../../src/app/bootstrap/lifecycle.js';

describe('bootstrap/lifecycle refresh transactions', () => {
    it.each([
        ['paused', false, 'pause'],
        ['playing', true, 'play'],
    ])('restores authoritative visible %s state instead of reading the paused hidden instance', async (
        _label,
        isPlaying,
        expectedCommand,
    ) => {
        const requestCommand = vi.fn().mockResolvedValue({ applied: true, status: 'applied' });
        const loadRiveAnimation = vi.fn(async (_url, _name, options) => {
            options.beforeUserOnLoad?.();
            options.onLoaded?.();
        });
        const lifecycle = createAppLifecycle({
            callbacks: {
                applyVmControlSnapshot: vi.fn(() => 1),
                captureVmControlSnapshot: vi.fn(() => [{ kind: 'number', value: 2 }]),
                getArtboardStateSnapshot: () => ({
                    currentArtboard: 'Main',
                    currentPlaybackName: 'Intro',
                    currentPlaybackType: 'animation',
                }),
                getCurrentFileName: () => 'demo.riv',
                getCurrentFileUrl: () => 'blob:demo',
                getRiveInstance: () => ({
                    isPlaying: !isPlaying,
                    pause: vi.fn(),
                    play: vi.fn(),
                }),
                loadRiveAnimation,
                logEvent: vi.fn(),
                renderSurfaceController: {
                    getCanonicalState: () => ({
                        playback: { isPlaying, name: 'Intro', type: 'animation' },
                    }),
                    getState: () => ({ activeSessionId: 'active-1' }),
                    requestCommand,
                },
                showError: vi.fn(),
                updateInfo: vi.fn(),
            },
            elements: {},
        });

        await expect(lifecycle.refreshCurrentState()).resolves.toBe(true);

        expect(loadRiveAnimation).toHaveBeenCalledWith(
            'blob:demo',
            'demo.riv',
            expect.objectContaining({
                configOverrides: expect.objectContaining({ autoplay: isPlaying }),
            }),
        );
        expect(requestCommand).toHaveBeenCalledWith(
            expectedCommand,
            expectedCommand === 'play' ? { name: 'Intro' } : {},
        );
    });

    it('fails refresh when the replacement surface cannot confirm the preserved playback state', async () => {
        const showError = vi.fn();
        const lifecycle = createAppLifecycle({
            callbacks: {
                applyVmControlSnapshot: vi.fn(),
                captureVmControlSnapshot: vi.fn(() => []),
                getArtboardStateSnapshot: () => ({}),
                getCurrentFileName: () => 'demo.riv',
                getCurrentFileUrl: () => 'blob:demo',
                getRiveInstance: () => ({ isPlaying: false }),
                loadRiveAnimation: vi.fn(async (_url, _name, options) => options.onLoaded?.()),
                logEvent: vi.fn(),
                renderSurfaceController: {
                    getCanonicalState: () => ({ playback: { isPlaying: false } }),
                    getState: () => ({ activeSessionId: 'active-2' }),
                    requestCommand: vi.fn().mockResolvedValue({ applied: false, message: 'pause rejected' }),
                },
                showError,
                updateInfo: vi.fn(),
            },
            elements: {},
        });

        await expect(lifecycle.refreshCurrentState()).resolves.toBe(false);
        expect(showError).toHaveBeenCalledWith('Failed to refresh animation: pause rejected');
    });
});
