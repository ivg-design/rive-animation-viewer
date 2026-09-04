import { applySettingsOverlayAction, captureSettingsOverlayState, measureSettingsOverlay } from './settings-state.js';
import { completeUiOverlayAction } from './action-completion.js';
import { describeDefaultRivAppFailure } from './default-riv-app/error.js';
import { createOverlayParentLock } from './interaction/parent-lock.js';
export function createUiOverlayController({
    callbacks = {},
    documentRef = globalThis.document,
    elements = {},
    windowRef = globalThis.window,
} = {}) {
    const {
        beforeSettingsOpen = () => {},
        createOverlayRequestToken = () => {
            const cryptoRef = windowRef?.crypto || globalThis.crypto;
            if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID();
            if (typeof cryptoRef?.getRandomValues !== 'function') return null;
            const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
            return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        },
        getCurrentCanvasSizing = () => null, getTauriEventListener = async () => null, getTauriInvoker = () => null,
        getDefaultRivAppStatus = () => null,
        getInstallCounterStatus = () => null,
        isTauriEnvironment = () => false,
        onAboutRequested = () => {},
        makeRavDefaultForRiv = async () => false,
        setInstallCounterEnabled = async () => false,
        showError = () => {},
    } = callbacks;
    let activeEpoch = null;
    let activeDefinition = null;
    let activeFocusTarget = null;
    let activePurpose = null;
    let pendingEpoch = null;
    let previousEpoch = null;
    let disposed = false;
    let nativeSupportPromise = null;
    let operationChain = Promise.resolve();
    let setupPromise = null;
    const parentInteraction = createOverlayParentLock(documentRef);
    const unlistenCallbacks = [];
    const syncTimers = new Set();
    const handleRenderSurfacePointerDown = () => {
        if (!activeEpoch && !pendingEpoch) return;
        void close({ restoreFocus: false });
    };
    const handleMainPointerDown = (event) => {
        if (!parentInteraction.isLocked() && !activeEpoch && !pendingEpoch) return;
        const trigger = activeDefinition?.restoreFocusTarget;
        void close({ restoreFocus: parentInteraction.consumePointer(event, trigger) });
    };
    const handleWindowResize = () => {
        if (!activeEpoch && !pendingEpoch) return;
        void close({ restoreFocus: false });
    };
    const handleStateDirty = (event) => {
        if (!activeEpoch || event?.detail?.purpose !== activePurpose) return;
        scheduleStateSync();
    };
    function isNativeOverlayAvailable() {
        return isTauriEnvironment() && typeof getTauriInvoker() === 'function';
    }
    function enqueueOperation(operation) {
        const next = operationChain.then(operation, operation);
        operationChain = next.catch(() => {});
        return next;
    }
    async function isNativeOverlaySupported() {
        if (!isNativeOverlayAvailable()) return false;
        if (!nativeSupportPromise) {
            nativeSupportPromise = Promise.resolve(
                getTauriInvoker()?.('is_ui_overlay_supported', {}),
            ).then(Boolean, () => false);
        }
        return nativeSupportPromise;
    }

    function currentSettingsState() {
        return captureSettingsOverlayState(elements, {
            canvasSizingState: getCurrentCanvasSizing(),
            defaultRivAppState: getDefaultRivAppStatus(),
            telemetryState: getInstallCounterStatus(),
        });
    }
    function markClosed() {
        activeEpoch = null;
        activeDefinition = null;
        activeFocusTarget = null;
        activePurpose = null;
        pendingEpoch = null;
        previousEpoch = null;
        parentInteraction.unlock();
        elements.settingsButton?.setAttribute?.('aria-expanded', 'false');
    }
    async function closeNow({ restoreFocus = true } = {}) {
        if (!activeEpoch && !pendingEpoch) return false;
        const invoke = getTauriInvoker();
        const definition = activeDefinition;
        const focusTarget = definition?.restoreFocusTarget || elements.settingsButton;
        const expectedEpoch = pendingEpoch || activeEpoch;
        try {
            await invoke?.('close_ui_overlay', { expectedEpoch });
        } catch (error) {
            showError(`Unable to close application controls: ${error?.message || error}`);
            return false;
        }
        markClosed();
        definition?.onClose?.();
        if (restoreFocus) focusTarget?.focus?.({ preventScroll: true });
        return true;
    }

    function close(options) {
        return enqueueOperation(() => closeNow(options));
    }
    async function getActiveState(options) {
        let state;
        if (typeof activeDefinition?.getState === 'function') {
            state = await activeDefinition.getState(options);
        } else {
            state = activePurpose === 'settings' ? currentSettingsState() : {};
        }
        return activeFocusTarget ? { ...state, focusTarget: activeFocusTarget } : state;
    }
    async function syncStateNow() {
        if (!activeEpoch || !activePurpose || disposed) return false;
        const definition = activeDefinition;
        const epoch = activeEpoch;
        const state = await getActiveState({ incremental: true });
        await getTauriInvoker()?.('update_ui_overlay_state', { epoch, state });
        if (activeDefinition !== definition || activeEpoch !== epoch) return false;
        definition?.onStateSynced?.(state);
        return true;
    }
    function scheduleStateSync() {
        (activeDefinition?.syncDelays || [0, 120, 500]).forEach((delay) => {
            const timer = windowRef.setTimeout(async () => {
                syncTimers.delete(timer);
                if (!activeEpoch || !activePurpose || disposed) return;
                try {
                    await syncStateNow();
                } catch {
                    /* A restack can supersede this epoch between capture and delivery. */
                }
            }, delay);
            syncTimers.add(timer);
        });
    }

    async function handleAction(event) {
        const payload = event?.payload || {};
        const actionEpoch = Number(payload.epoch);
        if (
            disposed
            || (actionEpoch !== activeEpoch && actionEpoch !== pendingEpoch && actionEpoch !== previousEpoch)
            || payload.purpose !== activePurpose
            || payload.requestToken !== activeDefinition?.requestToken
        ) return;
        try {
            if (payload.action === 'close') {
                const closed = await closeNow();
                if (!closed) await completeUiOverlayAction(getTauriInvoker, payload, false, new Error('Unable to close application controls.'));
                return;
            }
            if (payload.action === 'about') {
                const closed = await closeNow({ restoreFocus: false });
                if (!closed) {
                    await completeUiOverlayAction(getTauriInvoker, payload, false, new Error('Unable to open About.'));
                    return;
                }
                onAboutRequested();
                return;
            }
            if (payload.action === 'focus-target') {
                activeFocusTarget = String(payload.value || '') || null;
                await syncStateNow();
                await completeUiOverlayAction(getTauriInvoker, payload, true);
                return;
            }
            if (activePurpose === 'settings' && payload.action === 'telemetry-toggle') {
                const current = getInstallCounterStatus();
                if (!current?.available || current.busy) {
                    throw new Error('Anonymous usage preference is not available yet.');
                }
                const applied = await setInstallCounterEnabled(!current.enabled);
                if (!applied) throw new Error('Unable to update anonymous usage preference.');
                await syncStateNow();
                await completeUiOverlayAction(getTauriInvoker, payload, true);
                return;
            }
            if (activePurpose === 'settings' && payload.action === 'default-riv-app-apply') {
                const current = getDefaultRivAppStatus();
                if (!current?.available || current.busy) {
                    throw new Error('Default .riv app controls are not available here.');
                }
                const applied = await makeRavDefaultForRiv();
                if (!applied) {
                    throw new Error(describeDefaultRivAppFailure(getDefaultRivAppStatus()));
                }
                await syncStateNow();
                await completeUiOverlayAction(getTauriInvoker, payload, true);
                return;
            }
            if (activePurpose === 'settings' && applySettingsOverlayAction(payload, elements)) {
                await syncStateNow();
                await completeUiOverlayAction(getTauriInvoker, payload, true);
                return;
            }
            if (typeof activeDefinition?.handleAction === 'function') {
                const actionDefinition = activeDefinition;
                const result = await actionDefinition.handleAction(payload);
                if (activeDefinition !== actionDefinition) return;
                if (!result?.close) await syncStateNow();
                await completeUiOverlayAction(getTauriInvoker, payload, true);
                if (result?.close) {
                    await closeNow({ restoreFocus: result.restoreFocus !== false });
                }
                return;
            }
                await completeUiOverlayAction(getTauriInvoker, payload, false, new Error('Unsupported application control.'));
        } catch (error) {
            await completeUiOverlayAction(getTauriInvoker, payload, false, error);
            showError(`Unable to apply ${payload.action || 'application control'}: ${error?.message || error}`);
        }
    }

    async function setup() {
        if (setupPromise) return setupPromise;
        const pendingSetup = (async () => {
            if (!isNativeOverlayAvailable()) return false;
            // A main-WebView reload can interrupt the previous controller's
            // fire-and-forget teardown. Drain any native child left by that
            // prior JS session before adopting new overlay events.
            await getTauriInvoker()?.('close_ui_overlay', { expectedEpoch: null });
            const listen = await getTauriEventListener();
            if (typeof listen !== 'function') return false;
            unlistenCallbacks.push(await listen(
                'ui-overlay:action',
                (event) => enqueueOperation(() => handleAction(event)),
            ));
            unlistenCallbacks.push(await listen('ui-overlay:prepared', (event) => {
                const adoptPreparedOverlay = async () => {
                    const payload = event?.payload || {};
                    if (!payload.epoch || !payload.purpose) return;
                    if (!activeDefinition || (activePurpose && String(payload.purpose) !== activePurpose)) return;
                    if (payload.requestToken !== activeDefinition.requestToken) return;
                    const candidateEpoch = Number(payload.epoch);
                    if (!candidateEpoch || candidateEpoch < (pendingEpoch || activeEpoch || 0)) return;
                    const candidateDefinition = activeDefinition;
                    pendingEpoch = candidateEpoch;
                    try {
                        await getTauriInvoker()?.('acknowledge_ui_overlay_adopted', { epoch: candidateEpoch });
                        if (
                            disposed
                            || activeDefinition !== candidateDefinition
                            || candidateDefinition.requestToken !== payload.requestToken
                            || (pendingEpoch !== candidateEpoch && activeEpoch !== candidateEpoch)
                        ) return;
                        if (activeEpoch && activeEpoch !== candidateEpoch) previousEpoch = activeEpoch;
                        activeEpoch = candidateEpoch;
                        if (pendingEpoch === candidateEpoch) pendingEpoch = null;
                        activePurpose = String(payload.purpose);
                        if (activePurpose === 'settings') {
                            elements.settingsButton?.setAttribute?.('aria-expanded', 'true');
                        }
                        scheduleStateSync();
                    } catch (error) {
                        if (pendingEpoch !== candidateEpoch || activeDefinition !== candidateDefinition) return;
                        showError(`Unable to activate ${activePurpose}: ${error?.message || error}`);
                    }
                };
                // The first prepared receipt resolves show_ui_overlay itself, so it
                // cannot queue behind that open operation. Restacks already have an
                // active epoch and must drain older actions before adoption.
                return activeEpoch ? enqueueOperation(adoptPreparedOverlay) : adoptPreparedOverlay();
            }));
            unlistenCallbacks.push(await listen('ui-overlay:opened', (event) => enqueueOperation(() => {
                const payload = event?.payload || {};
                const openedEpoch = Number(payload.epoch);
                if (!openedEpoch || !payload.purpose) return;
                if (!activeDefinition || (activePurpose && String(payload.purpose) !== activePurpose)) return;
                if (payload.requestToken !== activeDefinition.requestToken) return;
                if (pendingEpoch && openedEpoch !== pendingEpoch) return;
                if (!pendingEpoch && activeEpoch && openedEpoch <= activeEpoch) return;
                if (activeEpoch && activeEpoch !== openedEpoch) previousEpoch = activeEpoch;
                activeEpoch = openedEpoch;
                pendingEpoch = null;
                activePurpose = String(payload.purpose);
                if (activePurpose === 'settings') elements.settingsButton?.setAttribute?.('aria-expanded', 'true');
                scheduleStateSync();
            })));
            unlistenCallbacks.push(await listen('ui-overlay:error', (event) => {
                const payload = event?.payload || {};
                if (!activeDefinition || payload.requestToken !== activeDefinition.requestToken) return;
                const failedEpoch = Number(payload.epoch);
                if (payload.epoch && failedEpoch !== activeEpoch && failedEpoch !== pendingEpoch) return;
                if (failedEpoch === pendingEpoch && activeEpoch && failedEpoch !== activeEpoch) {
                    pendingEpoch = null;
                    return;
                }
                const definition = activeDefinition;
                markClosed();
                definition?.onClose?.();
                showError(payload.message || 'Unable to open application controls.');
            }));
            unlistenCallbacks.push(await listen('ui-overlay:restack-error', (event) => {
                const payload = event?.payload || {};
                if (!activeDefinition || payload.requestToken !== activeDefinition.requestToken) return;
                if (Number(payload.epoch) !== activeEpoch) return;
                showError(payload.message || 'Unable to keep application controls above playback.');
            }));
            documentRef?.addEventListener?.('pointerdown', handleMainPointerDown, true);
            documentRef?.addEventListener?.('rav:render-surface-pointerdown', handleRenderSurfacePointerDown);
            documentRef?.addEventListener?.('rav:ui-overlay-state-dirty', handleStateDirty);
            windowRef?.addEventListener?.('resize', handleWindowResize);
            return true;
        })();
        setupPromise = pendingSetup;
        try {
            const ready = await pendingSetup;
            if (!ready && setupPromise === pendingSetup) setupPromise = null;
            return ready;
        } catch (error) {
            if (setupPromise === pendingSetup) {
                nativeSupportPromise = Promise.resolve(false);
                setupPromise = Promise.resolve(false);
            }
            showError(`Native application controls are unavailable: ${error?.message || error}`);
            return false;
        }
    }

    function openSettings() {
        return enqueueOperation(async () => {
            if (!await isNativeOverlaySupported()) return false;
            if (!await setup()) return false;
            if (activePurpose === 'settings' && activeEpoch) {
                return closeNow();
            }
            await beforeSettingsOpen();
            const bounds = measureSettingsOverlay({
                button: elements.settingsButton,
                popover: elements.settingsPopover,
                viewportHeight: windowRef.innerHeight,
                viewportWidth: windowRef.innerWidth,
            });
            if (!bounds) return false;
            return openPurposeNow({
                bounds,
                getState: currentSettingsState,
                purpose: 'settings',
                restoreFocusTarget: elements.settingsButton,
            });
        });
    }

    async function openPurposeNow({
        bounds,
        focus = false,
        getState = () => ({}),
        handleAction = null,
        onClose = null,
        onStateSynced = null,
        purpose,
        restoreFocusTarget = documentRef?.activeElement || null,
        syncDelays = [0],
    } = {}) {
        if (!purpose || !bounds || !await isNativeOverlaySupported()) return false;
        if (!await setup()) return false;
        if (disposed) return false;
        if (activeEpoch && !await closeNow({ restoreFocus: false })) return false;
        const requestToken = createOverlayRequestToken();
        if (!requestToken) return false;
        const definition = {
            getState,
            handleAction,
            onClose,
            onStateSynced,
            requestToken,
            restoreFocusTarget,
            syncDelays,
        };
        activeDefinition = definition;
        activeFocusTarget = null;
        activePurpose = String(purpose);
        previousEpoch = null;
        parentInteraction.lock();
        try {
            const state = await definition.getState();
            const epoch = await getTauriInvoker()('show_ui_overlay', {
                request: {
                    bounds,
                    focus,
                    purpose: activePurpose,
                    requestToken,
                    state,
                },
            });
            if (disposed || activeDefinition !== definition) return false;
            activeEpoch = Number(epoch);
            pendingEpoch = null;
            definition.onStateSynced?.(state);
            if (activePurpose === 'settings') elements.settingsButton?.setAttribute?.('aria-expanded', 'true');
            return true;
        } catch (error) {
            const failedPurpose = activePurpose;
            if (activeDefinition === definition) {
                markClosed();
                definition.onClose?.();
                showError(`Unable to open ${failedPurpose || 'application controls'}: ${error?.message || error}`);
            }
            return false;
        }
    }

    function openPurpose(definition) {
        return enqueueOperation(() => openPurposeNow(definition));
    }

    function dispose() {
        disposed = true;
        syncTimers.forEach((timer) => windowRef.clearTimeout(timer));
        syncTimers.clear();
        unlistenCallbacks.splice(0).forEach((unlisten) => unlisten?.());
        documentRef?.removeEventListener?.('pointerdown', handleMainPointerDown, true);
        documentRef?.removeEventListener?.('rav:render-surface-pointerdown', handleRenderSurfacePointerDown);
        documentRef?.removeEventListener?.('rav:ui-overlay-state-dirty', handleStateDirty);
        windowRef?.removeEventListener?.('resize', handleWindowResize);
        if (activeEpoch || pendingEpoch) {
            void getTauriInvoker()?.('close_ui_overlay', { expectedEpoch: pendingEpoch || activeEpoch });
        }
        markClosed();
    }

    return {
        close,
        dispose,
        isNativeOverlayAvailable,
        isNativeOverlaySupported,
        openPurpose,
        openSettings,
        setup,
    };
}
