export function createPlaybackController({
    callbacks = {},
    documentRef = globalThis.document,
    getCurrentFileName = () => null,
    getCurrentFileUrl = () => null,
    getPlaybackState = () => ({ currentPlaybackName: null, currentPlaybackType: null }),
    getRiveInstance = () => null,
    now = () => globalThis.performance.now(),
} = {}) {
    const {
        applyVmControlSnapshot = () => 0,
        captureVmControlSnapshot = () => [],
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    let frameCount = 0;
    let lastFpsUpdate = 0;

    function updatePlaybackChips() {
        frameCount += 1;
        const currentTime = now();
        if (currentTime - lastFpsUpdate >= 1000) {
            const fps = Math.round((frameCount * 1000) / (currentTime - lastFpsUpdate));
            const fpsChip = documentRef.getElementById('fps-chip');
            if (fpsChip) {
                fpsChip.innerHTML = `<span class="dot"></span>${fps} FPS`;
            }
            frameCount = 0;
            lastFpsUpdate = currentTime;
        }
    }

    function resetPlaybackChips() {
        frameCount = 0;
        lastFpsUpdate = now();
        const fpsChip = documentRef.getElementById('fps-chip');
        if (fpsChip) {
            fpsChip.innerHTML = '<span class="dot"></span>-- FPS';
        }
    }

    function play() {
        const riveInstance = getRiveInstance();
        console.log('[rive-viewer] play() called, riveInstance:', !!riveInstance);
        if (!riveInstance) {
            console.warn('[rive-viewer] play() called but no riveInstance');
            return;
        }

        const playbackState = getPlaybackState();
        if (!riveInstance.isPlaying && playbackState.currentPlaybackType === 'animation' && playbackState.currentPlaybackName) {
            riveInstance.stop();
            riveInstance.play(playbackState.currentPlaybackName);
        } else {
            riveInstance.play();
        }
        updateInfo('Playing');
        logEvent('ui', 'play', 'Playback started from UI.');
    }

    function pause() {
        const riveInstance = getRiveInstance();
        console.log('[rive-viewer] pause() called, riveInstance:', !!riveInstance);
        if (!riveInstance) {
            return;
        }
        riveInstance.pause();
        updateInfo('Paused');
        logEvent('ui', 'pause', 'Playback paused from UI.');
    }

    async function reset() {
        const currentFileUrl = getCurrentFileUrl();
        const currentFileName = getCurrentFileName();
        console.log('[rive-viewer] reset() called, riveInstance:', !!getRiveInstance());
        if (!currentFileUrl || !currentFileName) {
            showError('Please load a Rive file first');
            return;
        }

        const viewModelSnapshot = captureVmControlSnapshot();
        updateInfo(`Restarting ${currentFileName}...`);
        logEvent('ui', 'reset', `Restarting animation with autoplay (${viewModelSnapshot.length} controls captured).`);

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
                        reject(error || new Error('Animation restart failed'));
                    }
                };

                loadRiveAnimation(currentFileUrl, currentFileName, {
                    forceAutoplay: true,
                    onLoaded: resolveOnce,
                    onLoadError: rejectOnce,
                }).catch(rejectOnce);
            });

            const restoredControls = applyVmControlSnapshot(viewModelSnapshot);
            updateInfo(`Restarted ${currentFileName}`);
            logEvent('ui', 'reset-complete', `Animation restarted with autoplay (${restoredControls} controls restored).`);
        } catch (error) {
            showError(`Failed to restart animation: ${error?.message || error}`);
            logEvent('ui', 'reset-error', 'Failed to restart animation from UI.', error);
        }
    }

    return {
        pause,
        play,
        reset,
        resetPlaybackChips,
        updatePlaybackChips,
    };
}
