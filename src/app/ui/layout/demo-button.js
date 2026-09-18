export function createDemoButtonController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
    windowRef = globalThis.window,
} = {}) {
    const {
        getTauriInvoker = () => null,
    } = callbacks;

    function setup() {
        const button = elements.demoBundleButton || documentRef.getElementById('demo-bundle-btn');
        if (!button) return;

        const setButtonState = (enabled) => {
            button.disabled = !enabled;
            button.classList.toggle('demo-button--disabled', !enabled);
            button.title = enabled
                ? 'Export media, standalone HTML, or snippets'
                : 'Available in the desktop app';
        };

        const refreshState = () => {
            setButtonState(Boolean(getTauriInvoker()));
        };

        refreshState();
        windowRef.addEventListener(
            'tauri://ready',
            () => {
                refreshState();
            },
            { once: true },
        );
    }

    function dispose() {}

    return {
        dispose,
        setup,
    };
}
