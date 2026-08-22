const CONSENT_COMMAND = 'set_install_counter_consent';
const STATUS_COMMAND = 'get_install_counter_status';

export function createInstallCounterController({
    elements,
    getTauriInvoker = () => null,
    isTauriEnvironment = () => false,
    logEvent = () => {},
} = {}) {
    const button = elements?.installCounterConsentButton;
    let disposed = false;
    let busy = false;
    let currentStatus = { available: false, consented: false };

    function render({ available, consented } = currentStatus) {
        if (!button) return;
        currentStatus = { available: Boolean(available), consented: Boolean(consented) };
        button.disabled = busy || !currentStatus.available;
        button.setAttribute('aria-pressed', currentStatus.consented ? 'true' : 'false');
        button.textContent = !currentStatus.available ? 'UNAVAILABLE' : (currentStatus.consented ? 'ON' : 'OFF');
        button.classList.toggle('is-active', currentStatus.available && currentStatus.consented);
    }

    async function setup() {
        if (!button) return;
        if (!isTauriEnvironment()) {
            render({ available: false, consented: false });
            return;
        }
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') {
            render({ available: false, consented: false });
            return;
        }
        try {
            const status = await invoke(STATUS_COMMAND, {});
            render({ available: Boolean(status?.available), consented: Boolean(status?.consented) });
        } catch (error) {
            render({ available: false, consented: false });
            logEvent('ui', 'install-counter-status-failed', 'Anonymous usage status unavailable.', error);
        }
        button.addEventListener('click', onClick);
    }

    async function onClick() {
        if (disposed || busy || button.disabled) return;
        const next = button.getAttribute('aria-pressed') !== 'true';
        const invoke = getTauriInvoker();
        busy = true;
        render(currentStatus);
        try {
            const status = await invoke(CONSENT_COMMAND, { consented: next });
            render({ available: Boolean(status?.available), consented: Boolean(status?.consented) });
        } catch (error) {
            logEvent('ui', 'install-counter-consent-failed', 'Unable to update anonymous usage preference.', error);
        } finally {
            busy = false;
            if (!disposed) render(currentStatus);
        }
    }

    function dispose() {
        disposed = true;
        button?.removeEventListener('click', onClick);
    }

    return { setup, dispose };
}
