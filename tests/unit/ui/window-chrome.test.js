import { createWindowChromeController } from '../../../src/app/ui/window-chrome.js';

function createElements() {
    document.body.innerHTML = `
        <div id="window-titlebar">
            <div id="window-titlebar-center"></div>
        </div>
        <div id="window-controls" hidden>
            <button id="window-maximize-btn"><span class="window-control-glyph">+</span></button>
            <button id="window-minimize-btn"><span class="window-control-glyph">−</span></button>
            <button id="window-close-btn"><span class="window-control-glyph">×</span></button>
        </div>
    `;

    return {
        windowCloseButton: document.getElementById('window-close-btn'),
        windowControls: document.getElementById('window-controls'),
        windowMaximizeButton: document.getElementById('window-maximize-btn'),
        windowMinimizeButton: document.getElementById('window-minimize-btn'),
        windowTitlebar: document.getElementById('window-titlebar'),
        windowTitlebarCenter: document.getElementById('window-titlebar-center'),
    };
}

describe('ui/window-chrome', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('shows desktop controls and forwards window actions in tauri', async () => {
        const elements = createElements();
        const invoke = vi.fn(async (command) => {
            if (command === 'window_chrome_is_maximized') {
                return false;
            }
            if (command === 'window_chrome_toggle_maximize') {
                return true;
            }
            return null;
        });
        const controller = createWindowChromeController({
            callbacks: {
                getTauriInvoker: () => invoke,
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
        elements.windowTitlebar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        elements.windowTitlebarCenter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        await vi.waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('window_chrome_is_maximized');
            expect(invoke).toHaveBeenCalledWith('window_chrome_minimize');
            expect(invoke).toHaveBeenCalledWith('window_chrome_toggle_maximize');
            expect(invoke).toHaveBeenCalledWith('window_chrome_close');
            expect(invoke).toHaveBeenCalledWith('window_chrome_start_dragging');
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
