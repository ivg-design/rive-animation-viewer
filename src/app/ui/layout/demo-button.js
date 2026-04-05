export function createDemoButtonController({
    callbacks = {},
    clearIntervalFn = globalThis.clearInterval,
    documentRef = globalThis.document,
    elements,
    setIntervalFn = globalThis.setInterval,
    windowRef = globalThis.window,
} = {}) {
    const {
        getTauriInvoker = () => null,
        syncTransparencyControls = () => {},
    } = callbacks;

    let intervalId = null;

    function setup() {
        const button = elements.demoBundleButton || documentRef.getElementById('demo-bundle-btn');
        if (!button) return;

        const setButtonState = (enabled) => {
            button.disabled = !enabled;
            button.classList.toggle('demo-button--disabled', !enabled);
            button.title = enabled
                ? 'Package the current animation into a demo executable'
                : 'Available in the desktop app';
        };

        const refreshState = () => {
            setButtonState(Boolean(getTauriInvoker()));
            syncTransparencyControls();
        };

        refreshState();
        if (intervalId) {
            clearIntervalFn(intervalId);
            intervalId = null;
        }

        let attempts = 0;
        const maxAttempts = 20;
        intervalId = setIntervalFn(() => {
            refreshState();
            if (getTauriInvoker()) {
                clearIntervalFn(intervalId);
                intervalId = null;
                return;
            }
            attempts += 1;
            if (attempts >= maxAttempts) {
                clearIntervalFn(intervalId);
                intervalId = null;
            }
        }, 300);

        windowRef.addEventListener(
            'tauri://ready',
            () => {
                refreshState();
            },
            { once: true },
        );
    }

    function dispose() {
        if (!intervalId) {
            return;
        }
        clearIntervalFn(intervalId);
        intervalId = null;
    }

    return {
        dispose,
        setup,
    };
}
