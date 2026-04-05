function getUpdateBody(update) {
    return String(update?.body || update?.notes || '').trim();
}

export function createAppUpdaterController({
    callbacks = {},
    elements,
    documentRef = globalThis.document,
    getTauriInvoker = () => null,
    isTauriEnvironment = () => false,
    windowRef = globalThis.window,
} = {}) {
    const {
        logEvent = () => {},
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    const state = {
        checkingPromise: null,
        installPromise: null,
        pendingUpdate: null,
        retryTimer: null,
        setupDone: false,
        updateState: 'idle',
    };

    function renderChip(label = '', options = {}) {
        const chip = elements.updateChip;
        if (!chip) {
            return;
        }

        const {
            disabled = false,
            hidden = false,
            stateName = state.updateState,
            title = '',
        } = options;

        chip.hidden = hidden;
        chip.disabled = disabled;
        chip.dataset.updateState = stateName;
        chip.textContent = label;
        chip.title = title || label;
    }

    function hideChip() {
        renderChip('', { hidden: true, stateName: 'idle' });
    }

    async function invokeDesktop(command, args = {}) {
        const invoke = getTauriInvoker();
        if (!invoke) {
            throw new Error('Desktop updater bridge is unavailable');
        }
        return invoke(command, args);
    }

    async function checkForUpdatesOnLaunch({ force = false } = {}) {
        if (!isTauriEnvironment()) {
            hideChip();
            return null;
        }

        if (state.checkingPromise && !force) {
            return state.checkingPromise;
        }

        state.checkingPromise = (async () => {
            state.updateState = 'checking';

            try {
                const result = await invokeDesktop('check_for_app_update');
                if (!result?.available || !result?.version) {
                    state.pendingUpdate = null;
                    state.updateState = 'idle';
                    hideChip();
                    return null;
                }

                const update = {
                    body: getUpdateBody(result),
                    currentVersion: result.currentVersion || result.current_version || null,
                    version: result.version,
                };

                state.pendingUpdate = update;
                state.updateState = 'available';
                renderChip(`UPDATE ${update.version}`, {
                    stateName: 'available',
                    title: update.body ? `Update ${update.version}\n\n${update.body}` : `Update ${update.version} available`,
                });
                updateInfo(`Update ${update.version} ready`);
                logEvent('ui', 'update-available', `Update ${update.version} available`, {
                    currentVersion: update.currentVersion,
                    notes: update.body || null,
                    version: update.version,
                });
                return update;
            } catch (error) {
                state.pendingUpdate = null;
                state.updateState = 'error';
                renderChip('UPDATE RETRY', {
                    stateName: 'error',
                    title: `Update check failed: ${error.message}`,
                });
                logEvent('ui', 'update-check-failed', error.message);
                scheduleRetry();
                return null;
            } finally {
                state.checkingPromise = null;
            }
        })();

        return state.checkingPromise;
    }

    function clearRetryTimer() {
        if (!state.retryTimer) {
            return;
        }
        windowRef.clearTimeout(state.retryTimer);
        state.retryTimer = null;
    }

    function scheduleRetry(delayMs = 5000) {
        if (!isTauriEnvironment() || state.updateState !== 'error') {
            return;
        }
        clearRetryTimer();
        state.retryTimer = windowRef.setTimeout(() => {
            state.retryTimer = null;
            checkForUpdatesOnLaunch({ force: true }).catch(() => {});
        }, delayMs);
    }

    async function installPendingUpdate() {
        if (!state.pendingUpdate) {
            return false;
        }
        if (state.installPromise) {
            return state.installPromise;
        }

        state.installPromise = (async () => {
            const update = state.pendingUpdate;

            state.updateState = 'downloading';
            renderChip(`UPDATING ${update.version}`, {
                disabled: true,
                stateName: 'downloading',
                title: `Downloading update ${update.version}`,
            });
            logEvent('ui', 'update-download-started', `Downloading update ${update.version}`);

            try {
                if (typeof windowRef._mcpBridge?.disable === 'function') {
                    await windowRef._mcpBridge.disable();
                } else {
                    await invokeDesktop('stop_mcp_bridge');
                }
                const result = await invokeDesktop('install_app_update');
                if (!result?.installed) {
                    state.pendingUpdate = null;
                    state.updateState = 'idle';
                    hideChip();
                    return false;
                }

                state.updateState = 'restarting';
                renderChip('RESTARTING', {
                    disabled: true,
                    stateName: 'restarting',
                    title: `Update ${update.version} installed`,
                });
                logEvent('ui', 'update-installed', `Installed update ${update.version}`);
                await invokeDesktop('relaunch_app');
                return true;
            } catch (error) {
                state.updateState = 'error';
                renderChip('UPDATE RETRY', {
                    stateName: 'error',
                    title: `Update failed: ${error.message}`,
                });
                logEvent('ui', 'update-install-failed', error.message);
                showError(`Update failed: ${error.message}`);
                return false;
            } finally {
                state.installPromise = null;
            }
        })();

        return state.installPromise;
    }

    function setup() {
        if (state.setupDone) {
            return;
        }
        state.setupDone = true;

        hideChip();
        elements.updateChip?.addEventListener('click', () => {
            if (state.updateState === 'available') {
                installPendingUpdate().catch(() => {});
                return;
            }

            if (state.updateState === 'error') {
                checkForUpdatesOnLaunch({ force: true }).catch(() => {});
            }
        });
        windowRef.addEventListener?.('online', () => {
            if (state.updateState === 'error') {
                checkForUpdatesOnLaunch({ force: true }).catch(() => {});
            }
        });
        documentRef?.addEventListener?.('visibilitychange', () => {
            if (documentRef.hidden) {
                return;
            }
            if (state.updateState === 'error') {
                checkForUpdatesOnLaunch({ force: true }).catch(() => {});
            }
        });
        windowRef.addEventListener?.('focus', () => {
            if (state.updateState === 'error') {
                checkForUpdatesOnLaunch({ force: true }).catch(() => {});
            }
        });
    }

    return {
        checkForUpdatesOnLaunch,
        installPendingUpdate,
        setup,
    };
}
