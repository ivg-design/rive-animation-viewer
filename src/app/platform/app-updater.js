function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function getUpdateBody(update) {
    return String(update?.body || update?.notes || '').trim();
}

export function createAppUpdaterController({
    callbacks = {},
    elements,
    isTauriEnvironment = () => false,
    loadProcessApi = () => import('@tauri-apps/plugin-process'),
    loadUpdaterApi = () => import('@tauri-apps/plugin-updater'),
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
                const { check } = await loadUpdaterApi();
                const update = await check();
                state.pendingUpdate = update || null;

                if (!update) {
                    state.updateState = 'idle';
                    hideChip();
                    return null;
                }

                const body = getUpdateBody(update);
                state.updateState = 'available';
                renderChip(`UPDATE ${update.version}`, {
                    stateName: 'available',
                    title: body ? `Update ${update.version}\n\n${body}` : `Update ${update.version} available`,
                });
                updateInfo(`Update ${update.version} ready`);
                logEvent('ui', 'update-available', `Update ${update.version} available`, {
                    notes: body || null,
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
                return null;
            } finally {
                state.checkingPromise = null;
            }
        })();

        return state.checkingPromise;
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
            const { relaunch } = await loadProcessApi();
            let downloaded = 0;
            let contentLength = 0;

            state.updateState = 'downloading';
            renderChip(`UPDATING ${update.version}`, {
                disabled: true,
                stateName: 'downloading',
                title: `Downloading update ${update.version}`,
            });
            logEvent('ui', 'update-download-started', `Downloading update ${update.version}`);

            try {
                await update.downloadAndInstall((event) => {
                    if (event.event === 'Started') {
                        contentLength = event.data.contentLength || 0;
                        renderChip(`UPDATING ${update.version}`, {
                            disabled: true,
                            stateName: 'downloading',
                            title: `Downloading ${formatBytes(contentLength)}`,
                        });
                        return;
                    }

                    if (event.event === 'Progress') {
                        downloaded += event.data.chunkLength || 0;
                        const progressLabel = contentLength
                            ? `UPDATING ${Math.max(1, Math.min(99, Math.round((downloaded / contentLength) * 100)))}%`
                            : `UPDATING ${formatBytes(downloaded)}`;
                        renderChip(progressLabel, {
                            disabled: true,
                            stateName: 'downloading',
                            title: contentLength
                                ? `Downloaded ${formatBytes(downloaded)} of ${formatBytes(contentLength)}`
                                : `Downloaded ${formatBytes(downloaded)}`,
                        });
                        return;
                    }

                    if (event.event === 'Finished') {
                        renderChip('RESTARTING', {
                            disabled: true,
                            stateName: 'restarting',
                            title: `Update ${update.version} installed`,
                        });
                    }
                });

                state.updateState = 'restarting';
                logEvent('ui', 'update-installed', `Installed update ${update.version}`);
                await relaunch();
                return true;
            } catch (error) {
                state.updateState = 'error';
                state.pendingUpdate = null;
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
    }

    return {
        checkForUpdatesOnLaunch,
        installPendingUpdate,
        setup,
    };
}
