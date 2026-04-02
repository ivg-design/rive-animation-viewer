import { createAppUpdaterController } from '../../../src/app/platform/app-updater.js';

describe('platform/app-updater', () => {
    function createElements() {
        document.body.innerHTML = '<button id="update-chip"></button>';
        return {
            updateChip: document.getElementById('update-chip'),
        };
    }

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('stays hidden when no update is available', async () => {
        const elements = createElements();
        const controller = createAppUpdaterController({
            elements,
            isTauriEnvironment: () => true,
            loadUpdaterApi: async () => ({
                check: vi.fn().mockResolvedValue(null),
            }),
        });

        controller.setup();
        await expect(controller.checkForUpdatesOnLaunch()).resolves.toBeNull();
        expect(elements.updateChip.hidden).toBe(true);
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
        const relaunch = vi.fn().mockResolvedValue(undefined);
        const downloadAndInstall = vi.fn(async (onEvent) => {
            onEvent({ event: 'Started', data: { contentLength: 100 } });
            onEvent({ event: 'Progress', data: { chunkLength: 40 } });
            onEvent({ event: 'Finished', data: {} });
        });
        const controller = createAppUpdaterController({
            callbacks: {
                logEvent: vi.fn(),
                updateInfo: vi.fn(),
            },
            elements,
            isTauriEnvironment: () => true,
            loadProcessApi: async () => ({ relaunch }),
            loadUpdaterApi: async () => ({
                check: vi.fn().mockResolvedValue({
                    body: 'Release notes',
                    downloadAndInstall,
                    version: '1.10.0',
                }),
            }),
        });

        controller.setup();
        await controller.checkForUpdatesOnLaunch();

        expect(elements.updateChip.hidden).toBe(false);
        expect(elements.updateChip.textContent).toContain('1.10.0');

        elements.updateChip.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(downloadAndInstall).toHaveBeenCalled();
        expect(relaunch).toHaveBeenCalled();
    });

    it('shows retry state when the update check fails', async () => {
        const elements = createElements();
        const check = vi.fn()
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce(null);
        const controller = createAppUpdaterController({
            callbacks: {
                logEvent: vi.fn(),
            },
            elements,
            isTauriEnvironment: () => true,
            loadUpdaterApi: async () => ({ check }),
        });

        controller.setup();
        await controller.checkForUpdatesOnLaunch();

        expect(elements.updateChip.hidden).toBe(false);
        expect(elements.updateChip.dataset.updateState).toBe('error');

        elements.updateChip.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(check).toHaveBeenCalledTimes(2);
        expect(elements.updateChip.hidden).toBe(true);
    });

    it('surfaces install failures and keeps a retry state', async () => {
        const elements = createElements();
        const showError = vi.fn();
        const controller = createAppUpdaterController({
            callbacks: {
                logEvent: vi.fn(),
                showError,
            },
            elements,
            isTauriEnvironment: () => true,
            loadProcessApi: async () => ({ relaunch: vi.fn() }),
            loadUpdaterApi: async () => ({
                check: vi.fn().mockResolvedValue({
                    downloadAndInstall: vi.fn().mockRejectedValue(new Error('install blocked')),
                    version: '1.10.1',
                }),
            }),
        });

        controller.setup();
        await controller.checkForUpdatesOnLaunch();
        await expect(controller.installPendingUpdate()).resolves.toBe(false);

        expect(elements.updateChip.dataset.updateState).toBe('error');
        expect(showError).toHaveBeenCalledWith('Update failed: install blocked');
    });
});
