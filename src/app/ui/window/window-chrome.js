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
        isTauriEnvironment = () => false,
    } = callbacks;

    let controlsBound = false;
    let controlClickHandler = null;
    function getCurrentTauriWindow(windowRef = documentRef?.defaultView || globalThis.window) {
        if (!isTauriEnvironment()) {
            return null;
        }
        const windowApi = windowRef?.__TAURI__?.window;
        if (typeof windowApi?.getCurrentWindow !== 'function') {
            return null;
        }
        try {
            return windowApi.getCurrentWindow();
        } catch {
            return null;
        }
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
        const appWindow = getCurrentTauriWindow();
        const isMaximized = appWindow ? await appWindow.isMaximized().catch(() => false) : false;
        applyMaximizeState(Boolean(isMaximized));
    }

    async function handleWindowControl(action) {
        const appWindow = getCurrentTauriWindow();
        if (!appWindow) {
            return;
        }
        if (action === 'close') {
            await appWindow.close().catch(() => {});
            return;
        }
        if (action === 'minimize') {
            await appWindow.minimize().catch(() => {});
            return;
        }
        if (action === 'maximize') {
            await appWindow.toggleMaximize().catch(() => {});
            await syncMaximizeState();
        }
    }

    function bindWindowControls() {
        if (controlsBound || !elements.windowControls) {
            return;
        }
        controlClickHandler = (event) => {
            const controlButton = event.target instanceof Element
                ? event.target.closest('[data-window-control]')
                : null;
            if (!(controlButton instanceof HTMLElement)) {
                return;
            }
            const action = controlButton.dataset.windowControl;
            if (!action) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            void handleWindowControl(action);
        };
        elements.windowControls.addEventListener('click', controlClickHandler);
        elements.windowControls.dataset.bound = 'true';
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

    function dispose() {
        if (controlsBound && elements.windowControls && controlClickHandler) {
            elements.windowControls.removeEventListener('click', controlClickHandler);
        }
        controlsBound = false;
        controlClickHandler = null;
    }

    return {
        dispose,
        setup,
    };
}
