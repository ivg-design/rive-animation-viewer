import { createAppUpdaterController } from '../../../src/app/platform/app-updater.js';

describe('platform/app-updater', () => {
    function createElements() {
        document.body.innerHTML = '<button id="update-chip"></button>';
        return {
            updateChip: document.getElementById('update-chip'),
        };
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('stays hidden when no update is available', async () => {
        const elements = createElements();
        const invoke = vi.fn().mockResolvedValue({
            available: false,
            currentVersion: '1.9.9',
            version: null,
        });
        const controller = createAppUpdaterController({
            elements,
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
        });

        controller.setup();
        await expect(controller.checkForUpdatesOnLaunch()).resolves.toBeNull();
        expect(elements.updateChip.hidden).toBe(true);
        expect(invoke).toHaveBeenCalledWith('check_for_app_update', {});
    });

    it('no-ops cleanly outside Tauri and when there is no pending install', async () => {
        const elements = createElements();
        const controller = createAppUpdaterController({
            elements,
            isTauriEnvironment: () => false,
        });

        controller.setup();
        await expect(controller.checkForUpdatesOnLaunch()).resolves.toBeNull();
        await expect(controller.installPendingUpdate()).resolves.toBe(false);
        expect(elements.updateChip.hidden).toBe(true);
    });

    it('shows an update chip and installs the update on click', async () => {
        const elements = createElements();
        const invoke = vi.fn(async (command) => {
            if (command === 'check_for_app_update') {
                return {
                    available: true,
                    body: 'Release notes',
                    currentVersion: '1.9.9',
                    version: '1.10.0',
                };
            }
            if (command === 'install_app_update') {
                return { installed: true, version: '1.10.0' };
            }
            if (command === 'relaunch_app') {
                return true;
            }
            throw new Error(`Unexpected command: ${command}`);
        });
        const controller = createAppUpdaterController({
            callbacks: {
                logEvent: vi.fn(),
                updateInfo: vi.fn(),
            },
            elements,
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
        });

        controller.setup();
        await controller.checkForUpdatesOnLaunch();

        expect(elements.updateChip.hidden).toBe(false);
        expect(elements.updateChip.textContent).toContain('1.10.0');

        elements.updateChip.click();
        await vi.waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('install_app_update', {});
            expect(invoke).toHaveBeenCalledWith('relaunch_app', {});
        });
    });

    it('shows retry state when the update check fails', async () => {
        const elements = createElements();
        const invoke = vi.fn()
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({
                available: false,
                currentVersion: '1.9.9',
                version: null,
            });
        const controller = createAppUpdaterController({
            callbacks: {
                logEvent: vi.fn(),
            },
            elements,
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
        });

        controller.setup();
        await controller.checkForUpdatesOnLaunch();

        expect(elements.updateChip.hidden).toBe(false);
        expect(elements.updateChip.dataset.updateState).toBe('error');

        elements.updateChip.click();
        await vi.waitFor(() => {
            expect(invoke).toHaveBeenCalledTimes(2);
            expect(elements.updateChip.hidden).toBe(true);
        });
    });

    it('retries automatically after an initial check failure', async () => {
        const elements = createElements();
        const invoke = vi.fn()
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({
                available: true,
                currentVersion: '2.0.2',
                version: '2.0.3',
                body: 'Ready',
            });
        const controller = createAppUpdaterController({
            callbacks: {
                logEvent: vi.fn(),
                updateInfo: vi.fn(),
            },
            elements,
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
        });

        controller.setup();
        await controller.checkForUpdatesOnLaunch();
        expect(elements.updateChip.dataset.updateState).toBe('error');

        await vi.advanceTimersByTimeAsync(5000);

        expect(invoke).toHaveBeenCalledTimes(2);
        expect(elements.updateChip.dataset.updateState).toBe('available');
        expect(elements.updateChip.textContent).toContain('2.0.3');
    });

    it('surfaces install failures and keeps a retry state', async () => {
        const elements = createElements();
        const showError = vi.fn();
        const invoke = vi.fn(async (command) => {
            if (command === 'check_for_app_update') {
                return {
                    available: true,
                    currentVersion: '1.9.9',
                    version: '1.10.1',
                };
            }
            if (command === 'install_app_update') {
                throw new Error('install blocked');
            }
            return true;
        });
        const controller = createAppUpdaterController({
            callbacks: {
                logEvent: vi.fn(),
                showError,
            },
            elements,
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
        });

        controller.setup();
        await controller.checkForUpdatesOnLaunch();
        await expect(controller.installPendingUpdate()).resolves.toBe(false);

        expect(elements.updateChip.dataset.updateState).toBe('error');
        expect(showError).toHaveBeenCalledWith('Update failed: install blocked');
    });
});
