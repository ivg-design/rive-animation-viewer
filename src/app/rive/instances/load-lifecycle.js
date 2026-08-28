import { dispatchAnimationLoaded } from '../control-events.js';
import { runUserOnLoadWithVmRestore } from '../instance/load-hooks.js';
import { buildPlaybackContext, buildPlaybackStatusLabel } from '../playback-status.js';
import { normalizeLoadErrorMessage } from './load-settlement.js';

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

export function configureRiveLoadLifecycle({
    activateAuthoritativeSurface,
    authoritativeAutoplay = true,
    authoritativeChildMode,
    beforeUserOnLoad,
    config,
    documentRef,
    fileName,
    getCurrentRuntime,
    getPlaybackState,
    getRiveInstance,
    hideError,
    isCurrentLoad = () => true,
    loadSettled,
    logEvent,
    notifyLoadFailure,
    notifyLoadSuccess,
    onLoadError,
    populateArtboardSwitcher,
    refreshInfoStrip,
    renderVmInputControls,
    setVmControlBaselineSnapshot,
    showError,
    syncArtboardStateAfterLoad,
    takePendingInPlaceReset,
    updateInfo,
    updatePlaybackChips,
    userOnAdvance,
    userOnLoad,
    userOnLoop,
    userOnPause,
    userOnPlay,
    userOnStateChange,
    userOnStop,
    resizeCanvas,
    userConfig,
}) {
    config.onLoad = () => {
        if (!isCurrentLoad()) {
            notifyLoadFailure(new Error('Animation load superseded.'));
            return;
        }
        const inPlaceReset = takePendingInPlaceReset();
        hideError();
        resizeCanvas(config.canvas, userConfig);
        getRiveInstance()?.resizeDrawingSurfaceToCanvas?.();
        logEvent('native', 'load', `Loaded ${fileName} using ${getCurrentRuntime()}.`);
        syncArtboardStateAfterLoad(getRiveInstance(), config);
        updateInfo(buildPlaybackStatusLabel(buildPlaybackContext({
            playbackState: getPlaybackState(),
            riveInstance: getRiveInstance(),
        })));
        refreshInfoStrip();
        runUserOnLoadWithVmRestore({
            beforeUserOnLoad: inPlaceReset ? inPlaceReset.beforeUserOnLoad : beforeUserOnLoad,
            riveInstance: getRiveInstance(),
            userOnLoad: authoritativeChildMode ? null : userOnLoad,
        });
        if (authoritativeChildMode) {
            getRiveInstance()?.pause?.();
        }
        renderVmInputControls();
        setVmControlBaselineSnapshot();
        populateArtboardSwitcher();
        if (authoritativeChildMode) {
            Promise.resolve(activateAuthoritativeSurface({ autoplay: authoritativeAutoplay })).then((activated) => {
                if (!isCurrentLoad()) {
                    notifyLoadFailure(new Error('Animation load superseded.'));
                    return;
                }
                if (!activated) {
                    throw new Error('The playback surface did not complete activation.');
                }
                notifyLoadSuccess();
            }).catch((error) => {
                if (!isCurrentLoad()) {
                    notifyLoadFailure(new Error('Animation load superseded.'));
                    return;
                }
                showError(`Unable to activate playback: ${normalizeLoadErrorMessage(error)}`);
                notifyLoadFailure(error);
            });
        } else {
            if (!loadSettled()) {
                dispatchAnimationLoaded(documentRef, { fileName, runtime: getCurrentRuntime() });
            }
            notifyLoadSuccess();
        }
    };
    config.onLoadError = (error) => {
        if (!isCurrentLoad()) {
            notifyLoadFailure(new Error('Animation load superseded.'));
            return;
        }
        const errorMsg = normalizeLoadErrorMessage(error);
        showError(`Error loading animation: ${errorMsg}`);
        logEvent('native', 'loaderror', `Load error for ${fileName}.`, error);
        if (!authoritativeChildMode) safelyInvokeUserCallback(onLoadError, error, 'onLoadError');
        notifyLoadFailure(error);
    };
    const runtimeCallbacks = {
        onPlay: ['play', 'Playback started by runtime.', userOnPlay],
        onPause: ['pause', 'Playback paused by runtime.', userOnPause],
        onStop: ['stop', 'Playback stopped by runtime.', userOnStop],
        onLoop: ['loop', 'Loop event emitted by runtime.', userOnLoop],
        onStateChange: ['statechange', 'State machine changed state.', userOnStateChange],
    };
    Object.entries(runtimeCallbacks).forEach(([name, [eventName, message, callback]]) => {
        config[name] = (event) => {
            if (!isCurrentLoad()) return;
            logEvent('native', eventName, message, event);
            if (!authoritativeChildMode) safelyInvokeUserCallback(callback, event, name);
        };
    });
    config.onAdvance = (event) => {
        if (!isCurrentLoad()) return;
        if (!authoritativeChildMode) {
            updatePlaybackChips();
            safelyInvokeUserCallback(userOnAdvance, event, 'onAdvance');
        }
    };
}
