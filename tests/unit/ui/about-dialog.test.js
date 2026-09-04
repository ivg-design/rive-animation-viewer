import { createAboutDialogController } from '../../../src/app/ui/about/about-dialog.js';

describe('ui/about/about-dialog', () => {
    it('injects an About row into settings and opens a populated dialog', async () => {
        document.body.innerHTML = '<div id="settings-popover"></div>';
        const openExternalUrl = vi.fn();

        const controller = createAboutDialogController({
            callbacks: {
                getAppBuildLabel: () => 'DEV · b0123-test',
                getAppVersionLabel: () => '2.0.5',
                getAdditionalDependencyEntries: async () => [
                    { name: 'Rive Web Runtime (WEBGL2)', version: '2.42.0' },
                    { name: 'ffmpeg', version: 'ffmpeg version 7.1.4-Jellyfin' },
                    { name: 'ffprobe', version: 'ffprobe version 7.1.4-Jellyfin' },
                    { name: 'gifski (optional)', version: 'unavailable' },
                ],
                getCurrentRuntime: () => 'webgl2',
                getCurrentRuntimeVersion: () => '2.36.0',
                getOpenExternalUrl: () => openExternalUrl,
            },
            fetchImpl: vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    dependencies: {
                        codemirror: '^6.0.2',
                    },
                    devDependencies: {
                        vitest: '^3.2.4',
                    },
                }),
            })),
        });

        controller.setup();

        const aboutRowButton = document.querySelector('[data-settings-about-row] button');
        expect(aboutRowButton).toBeTruthy();

        await controller.openDialog();

        const dialog = document.getElementById('about-dialog');
        expect(dialog).toBeTruthy();
        expect(dialog.open).toBe(true);
        expect(dialog.textContent).toContain('Rive Animation Viewer');
        expect(dialog.querySelector('[data-about-build]')?.textContent).toBe('DEV · b0123-test');
        expect(dialog.querySelector('[data-about-build-detail]')?.textContent).toBe('DEV · b0123-test');
        expect(dialog.textContent).toContain('6 deps');
        expect(dialog.textContent).toContain('codemirror');
        expect(dialog.textContent).toContain('vitest');
        expect(dialog.textContent).toContain('Rive Web Runtime (WEBGL2)');
        expect(dialog.textContent).toContain('ffmpeg version 7.1.4-Jellyfin');
        expect(dialog.textContent).toContain('ffprobe version 7.1.4-Jellyfin');
        expect(dialog.textContent).toContain('gifski (optional)unavailable');
        expect(dialog.textContent).toContain('Rive Docs');
        expect(dialog.textContent).toContain('Rive Community');
        expect(dialog.textContent).toContain('mograph.life');
        expect(dialog.textContent).toContain('Privacy Policy');
        expect(dialog.querySelectorAll('.about-dialog-link-btn')).toHaveLength(7);

        const privacyPolicyButton = [...dialog.querySelectorAll('.about-dialog-link-btn')]
            .find((button) => button.textContent === 'Privacy Policy');
        privacyPolicyButton.click();
        await vi.waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://forge.mograph.life/apps/rav/privacy'));
    });

    it('opens from the tauri about menu event', async () => {
        document.body.innerHTML = '<div id="settings-popover"></div>';

        let aboutListener = null;
        const controller = createAboutDialogController({
            callbacks: {
                getAppBuildLabel: () => 'b0139-test',
                getAppVersionLabel: () => '2.0.5',
                getCurrentRuntime: () => 'webgl2',
                getCurrentRuntimeVersion: () => '2.36.0',
                getTauriEventListener: async () => async (eventName, handler) => {
                    if (eventName === 'show-about') {
                        aboutListener = handler;
                    }
                    return () => {};
                },
            },
            fetchImpl: vi.fn(async () => ({
                ok: true,
                json: async () => ({ dependencies: {}, devDependencies: {} }),
            })),
        });

        controller.setup();
        await Promise.resolve();
        await Promise.resolve();
        await aboutListener?.();

        const dialog = document.getElementById('about-dialog');
        expect(dialog?.open).toBe(true);
        expect(dialog?.textContent).toContain('Rive Animation Viewer');
    });
});
