import { createInstallCounterController } from '../../../src/app/platform/install-counter/controller.js';

describe('platform/install-counter/controller', () => {
    function harness({ desktop = true, status = { available: true, consented: false } } = {}) {
        document.body.innerHTML = '<button id="install-counter-consent-btn" disabled>UNAVAILABLE</button>';
        const button = document.getElementById('install-counter-consent-btn');
        let currentStatus = { ...status };
        const invoke = vi.fn(async (command, payload) => {
            if (command === 'set_install_counter_consent') {
                currentStatus = { ...currentStatus, consented: Boolean(payload?.consented) };
            }
            return currentStatus;
        });
        const controller = createInstallCounterController({
            elements: { installCounterConsentButton: button },
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => desktop,
        });
        return { button, controller, invoke };
    }

    it('is disabled and unavailable in browser mode', async () => {
        const { button, controller } = harness({ desktop: false });
        await controller.setup();
        expect(button.disabled).toBe(true);
        expect(button.textContent).toBe('UNAVAILABLE');
    });

    it('loads consent and writes the updated preference on desktop', async () => {
        const { button, controller, invoke } = harness();
        await controller.setup();
        expect(button.disabled).toBe(false);
        expect(button.textContent).toBe('OFF');
        button.click();
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('set_install_counter_consent', { consented: true }));
        expect(button.textContent).toBe('ON');
        expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    it('serializes rapid consent clicks while a native update is pending', async () => {
        document.body.innerHTML = '<button id="install-counter-consent-btn" disabled>UNAVAILABLE</button>';
        const button = document.getElementById('install-counter-consent-btn');
        let resolveMutation;
        const mutation = new Promise((resolve) => {
            resolveMutation = resolve;
        });
        const invoke = vi.fn((command) => (
            command === 'get_install_counter_status'
                ? Promise.resolve({ available: true, consented: false })
                : mutation
        ));
        const controller = createInstallCounterController({
            elements: { installCounterConsentButton: button },
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
        });

        await controller.setup();
        button.click();
        button.click();
        expect(button.disabled).toBe(true);
        expect(invoke).toHaveBeenCalledTimes(2);

        resolveMutation({ available: true, consented: true });
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(button.textContent).toBe('ON');
    });
});
