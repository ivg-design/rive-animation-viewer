import { createWindowChromeController } from '../../../src/app/ui/window/window-chrome.js';

function createElements() {
    document.body.innerHTML = `
        <div id="window-titlebar">
            <div id="window-titlebar-left"></div>
            <div id="window-titlebar-center"></div>
        </div>
        <div id="window-controls" hidden>
            <button id="window-maximize-btn" data-window-control="maximize"><span class="window-control-glyph">+</span></button>
            <button id="window-minimize-btn" data-window-control="minimize"><span class="window-control-glyph">⌄</span></button>
            <button id="window-close-btn" data-window-control="close"><span class="window-control-glyph">×</span></button>
        </div>
    `;

    return {
        windowCloseButton: document.getElementById('window-close-btn'),
        windowControls: document.getElementById('window-controls'),
        windowMaximizeButton: document.getElementById('window-maximize-btn'),
        windowMinimizeButton: document.getElementById('window-minimize-btn'),
        windowTitlebar: document.getElementById('window-titlebar'),
        windowTitlebarLeft: document.getElementById('window-titlebar-left'),
        windowTitlebarCenter: document.getElementById('window-titlebar-center'),
    };
}

describe('ui/window-chrome', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        globalThis.window.__TAURI__ = undefined;
    });

    it('shows desktop controls and forwards window actions in tauri', async () => {
        const elements = createElements();
        const appWindow = {
            close: vi.fn(async () => {}),
            isMaximized: vi.fn(async () => false),
            minimize: vi.fn(async () => {}),
            toggleMaximize: vi.fn(async () => {}),
        };
        globalThis.window.__TAURI__ = {
            window: {
                getCurrentWindow: () => appWindow,
            },
        };
        const controller = createWindowChromeController({
            callbacks: {
                isTauriEnvironment: () => true,
            },
            documentRef: document,
            elements,
        });

        await controller.setup();

        expect(document.body.classList.contains('is-tauri-window')).toBe(true);
        expect(elements.windowControls.hidden).toBe(false);

        elements.windowMinimizeButton.click();
        elements.windowMaximizeButton.click();
        elements.windowCloseButton.click();
        await vi.waitFor(() => {
            expect(appWindow.isMaximized).toHaveBeenCalled();
            expect(appWindow.minimize).toHaveBeenCalled();
            expect(appWindow.toggleMaximize).toHaveBeenCalled();
            expect(appWindow.close).toHaveBeenCalled();
        });
    });

    it('hides custom controls outside tauri', async () => {
        const elements = createElements();
        const controller = createWindowChromeController({
            callbacks: {
                isTauriEnvironment: () => false,
            },
            documentRef: document,
            elements,
        });

        await controller.setup();

        expect(document.body.classList.contains('is-tauri-window')).toBe(false);
        expect(elements.windowControls.hidden).toBe(true);
    });
});
