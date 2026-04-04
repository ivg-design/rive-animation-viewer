function detectWindowPlatform(navigatorRef = globalThis.navigator) {
    const platformValue = `${navigatorRef?.userAgent || ''} ${navigatorRef?.platform || ''}`.toLowerCase();
    if (platformValue.includes('mac')) {
        return 'macos';
    }
    if (platformValue.includes('win')) {
        return 'windows';
    }
    return 'other';
}

export function createWindowChromeController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
} = {}) {
    const {
        getTauriInvoker = () => null,
        isTauriEnvironment = () => false,
    } = callbacks;

    let controlsBound = false;

    async function invokeWindowChrome(command) {
        if (!isTauriEnvironment()) {
            return null;
        }
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') {
            return null;
        }
        return invoke(command);
    }

    function applyWindowChromeClasses() {
        const documentElement = documentRef?.documentElement;
        const body = documentRef?.body;
        if (!body || !documentElement) {
            return;
        }
        const isDesktopWindow = isTauriEnvironment();
        documentElement.classList.toggle('is-tauri-window', isDesktopWindow);
        body.classList.toggle('is-tauri-window', isDesktopWindow);
        body.dataset.windowPlatform = detectWindowPlatform(documentRef.defaultView?.navigator);
    }

    function applyMaximizeState(isMaximized) {
        const button = elements.windowMaximizeButton;
        if (!button) {
            return;
        }
        button.dataset.windowState = isMaximized ? 'maximized' : 'normal';
        button.setAttribute('aria-label', isMaximized ? 'Restore window' : 'Maximize window');
        button.title = isMaximized ? 'Restore window' : 'Maximize window';
    }

    async function syncMaximizeState() {
        const isMaximized = await invokeWindowChrome('window_chrome_is_maximized').catch(() => false);
        applyMaximizeState(Boolean(isMaximized));
    }

    async function handleWindowControl(action) {
        if (action === 'close') {
            await invokeWindowChrome('window_chrome_close');
            return;
        }
        if (action === 'minimize') {
            await invokeWindowChrome('window_chrome_minimize');
            return;
        }
        if (action === 'maximize') {
            const nextState = await invokeWindowChrome('window_chrome_toggle_maximize').catch(() => null);
            if (typeof nextState === 'boolean') {
                applyMaximizeState(nextState);
            } else {
                await syncMaximizeState();
            }
        }
    }

    async function handleTitlebarMouseDown(event) {
        if (event.button !== 0) {
            return;
        }
        const eventTarget = event.target;
        if (!(eventTarget instanceof Element)) {
            return;
        }
        if (eventTarget.closest('.window-controls')) {
            return;
        }
        event.preventDefault();
        void invokeWindowChrome('window_chrome_start_dragging');
    }

    function bindWindowControls() {
        if (controlsBound) {
            return;
        }
        elements.windowCloseButton?.addEventListener('click', () => {
            void handleWindowControl('close');
        });
        elements.windowMinimizeButton?.addEventListener('click', () => {
            void handleWindowControl('minimize');
        });
        elements.windowMaximizeButton?.addEventListener('click', () => {
            void handleWindowControl('maximize');
        });
        elements.windowTitlebar?.addEventListener('mousedown', (event) => {
            void handleTitlebarMouseDown(event);
        });
        elements.windowTitlebarCenter?.addEventListener('dblclick', () => {
            void handleWindowControl('maximize');
        });
        controlsBound = true;
    }

    async function setup() {
        applyWindowChromeClasses();
        if (!elements.windowControls) {
            return;
        }
        const isDesktopWindow = isTauriEnvironment();
        elements.windowControls.hidden = !isDesktopWindow;
        if (!isDesktopWindow) {
            return;
        }
        bindWindowControls();
        await syncMaximizeState();
    }

    function dispose() {}

    return {
        dispose,
        setup,
    };
}
