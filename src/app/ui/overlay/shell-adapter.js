import { createUiOverlayController } from './controller.js';

export function createSettingsOverlayAdapter({
    callbacks,
    documentRef,
    elements,
    syncCanvasSizingControls,
    windowRef,
} = {}) {
    const controller = createUiOverlayController({
        callbacks: {
            beforeSettingsOpen: async () => {
                syncCanvasSizingControls();
                await callbacks.refreshDefaultRivAppStatus?.();
            },
            getCurrentCanvasSizing: callbacks.getCurrentCanvasSizing,
            getDefaultRivAppStatus: callbacks.getDefaultRivAppStatus,
            getTauriEventListener: callbacks.getTauriEventListener,
            getTauriInvoker: callbacks.getTauriInvoker,
            getInstallCounterStatus: callbacks.getInstallCounterStatus,
            isTauriEnvironment: callbacks.isTauriEnvironment,
            onAboutRequested: () => {
                documentRef.querySelector?.('[data-settings-about-row] button')?.click?.();
            },
            makeRavDefaultForRiv: callbacks.makeRavDefaultForRiv,
            setInstallCounterEnabled: callbacks.setInstallCounterEnabled,
            showError: callbacks.showError,
        },
        documentRef,
        elements,
        windowRef,
    });

    function setup() {
        const button = elements.settingsButton;
        const popover = elements.settingsPopover;
        if (!button || !popover) return;
        void controller.setup();
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            syncCanvasSizingControls();
            if (controller.isNativeOverlayAvailable()) {
                const opened = await controller.openSettings();
                if (opened) {
                    popover.hidden = true;
                    return;
                }
            }
            if (typeof callbacks.refreshDefaultRivAppStatus === 'function') {
                await callbacks.refreshDefaultRivAppStatus();
            }
            popover.hidden = !popover.hidden;
            button.setAttribute('aria-expanded', String(!popover.hidden));
        });
        documentRef.addEventListener('click', (event) => {
            if (!popover.hidden && !popover.contains(event.target) && event.target !== button) {
                popover.hidden = true;
                button.setAttribute('aria-expanded', 'false');
            }
        });
        documentRef.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !popover.hidden) {
                popover.hidden = true;
                button.setAttribute('aria-expanded', 'false');
            }
        });
    }

    return { ...controller, setup };
}
