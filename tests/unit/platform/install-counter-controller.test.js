import { createInstallCounterController } from '../../../src/app/platform/install-counter/controller.js';

describe('platform/install-counter/controller', () => {
    function harness({
        desktop = true,
        status = { available: true, enabled: true, noticeRequired: false },
        mutate,
    } = {}) {
        document.body.innerHTML = `
            <button id="install-counter-enabled-btn" disabled>UNAVAILABLE</button>
            <button id="install-counter-privacy-btn">DETAILS</button>
            <aside id="install-counter-notice" tabindex="-1" hidden>
                <button id="install-counter-notice-opt-out-btn">TURN OFF</button>
                <button id="install-counter-notice-privacy-btn">PRIVACY DETAILS</button>
                <button id="install-counter-notice-dismiss-btn">×</button>
            </aside>
        `;
        const elements = {
            installCounterEnabledButton: document.getElementById('install-counter-enabled-btn'),
            installCounterPrivacyButton: document.getElementById('install-counter-privacy-btn'),
            installCounterNotice: document.getElementById('install-counter-notice'),
            installCounterNoticeOptOutButton: document.getElementById('install-counter-notice-opt-out-btn'),
            installCounterNoticePrivacyButton: document.getElementById('install-counter-notice-privacy-btn'),
            installCounterNoticeDismissButton: document.getElementById('install-counter-notice-dismiss-btn'),
        };
        let currentStatus = { ...status };
        const invoke = vi.fn(async (command, payload) => {
            if (command === 'set_install_counter_enabled') {
                if (mutate) return mutate(command, payload);
                currentStatus = { ...currentStatus, enabled: Boolean(payload?.enabled) };
            }
            if (command === 'acknowledge_install_counter_notice') {
                currentStatus = { ...currentStatus, noticeRequired: false };
            }
            return currentStatus;
        });
        const controller = createInstallCounterController({
            elements,
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => desktop,
            documentRef: document,
            windowRef: window,
        });
        return { elements, controller, invoke };
    }

    it('is disabled and unavailable in browser mode', async () => {
        const { elements, controller } = harness({ desktop: false });
        await controller.setup();
        expect(elements.installCounterEnabledButton.disabled).toBe(true);
        expect(elements.installCounterEnabledButton.textContent).toBe('UNAVAILABLE');
        expect(elements.installCounterNotice.hidden).toBe(true);
    });

    it('loads default-on state and writes an opt-out from Settings', async () => {
        const { elements, controller, invoke } = harness();
        await controller.setup();
        expect(elements.installCounterEnabledButton.disabled).toBe(false);
        expect(elements.installCounterEnabledButton.textContent).toBe('ON');
        elements.installCounterEnabledButton.click();
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('set_install_counter_enabled', { enabled: false }));
        expect(elements.installCounterEnabledButton.textContent).toBe('OFF');
        expect(elements.installCounterEnabledButton.getAttribute('aria-pressed')).toBe('false');
    });

    it('shows the first-run notice without recording completion before an immediate opt-out', async () => {
        const { elements, controller, invoke } = harness({
            status: { available: true, enabled: true, noticeRequired: true },
        });
        await controller.setup();

        expect(elements.installCounterNotice.hidden).toBe(false);
        expect(elements.installCounterNotice.classList.contains('is-visible')).toBe(true);
        expect(document.activeElement).toBe(elements.installCounterNotice);
        expect(invoke).not.toHaveBeenCalledWith('acknowledge_install_counter_notice', {});

        elements.installCounterNoticeOptOutButton.click();
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('set_install_counter_enabled', { enabled: false }));
        expect(elements.installCounterEnabledButton.textContent).toBe('OFF');
        expect(invoke).not.toHaveBeenCalledWith('acknowledge_install_counter_notice', {});
    });

    it('automatically dismisses the first-run notice after fifteen seconds', async () => {
        const { elements, controller, invoke } = harness({
            status: { available: true, enabled: true, noticeRequired: true },
        });
        await controller.setup();

        expect(elements.installCounterNotice.hidden).toBe(false);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(elements.installCounterNotice.hidden).toBe(false);
        expect(elements.installCounterNotice.classList.contains('is-visible')).toBe(false);
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('acknowledge_install_counter_notice', {}));
        await vi.advanceTimersByTimeAsync(180);
        expect(elements.installCounterNotice.hidden).toBe(true);
    });

    it('does not show the first-run notice again after native acknowledgement persists', async () => {
        const firstRun = harness({
            status: { available: true, enabled: true, noticeRequired: true },
        });
        await firstRun.controller.setup();
        firstRun.elements.installCounterNoticeDismissButton.click();
        await vi.waitFor(() => expect(firstRun.invoke).toHaveBeenCalledWith('acknowledge_install_counter_notice', {}));
        firstRun.controller.dispose();

        const relaunch = harness({
            status: { available: true, enabled: true, noticeRequired: false },
        });
        await relaunch.controller.setup();
        expect(relaunch.elements.installCounterNotice.hidden).toBe(true);
        expect(relaunch.invoke).not.toHaveBeenCalledWith('acknowledge_install_counter_notice', {});
    });

    it('shows the notice again when the app exits before fifteen seconds or explicit dismissal', async () => {
        const interrupted = harness({
            status: { available: true, enabled: true, noticeRequired: true },
        });
        await interrupted.controller.setup();
        await vi.advanceTimersByTimeAsync(1_000);
        interrupted.controller.dispose();
        expect(interrupted.invoke).not.toHaveBeenCalledWith('acknowledge_install_counter_notice', {});

        const relaunch = harness({
            status: { available: true, enabled: true, noticeRequired: true },
        });
        await relaunch.controller.setup();
        expect(relaunch.elements.installCounterNotice.hidden).toBe(false);
        expect(relaunch.invoke).not.toHaveBeenCalledWith('acknowledge_install_counter_notice', {});
    });

    it('keeps a migrated opt-out off without showing an inaccurate counts-on notice', async () => {
        const { elements, controller, invoke } = harness({
            status: { available: true, enabled: false, noticeRequired: true },
        });
        await controller.setup();
        expect(elements.installCounterEnabledButton.textContent).toBe('OFF');
        expect(elements.installCounterNotice.hidden).toBe(true);
        expect(invoke).not.toHaveBeenCalledWith('acknowledge_install_counter_notice', {});
    });

    it('pauses the dismissal timer while the notice is being inspected', async () => {
        const { elements, controller } = harness({
            status: { available: true, enabled: true, noticeRequired: true },
        });
        await controller.setup();
        await vi.advanceTimersByTimeAsync(10_000);
        elements.installCounterNotice.dispatchEvent(new MouseEvent('mouseenter'));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(elements.installCounterNotice.hidden).toBe(false);
        elements.installCounterNotice.dispatchEvent(new MouseEvent('mouseleave'));
        await vi.advanceTimersByTimeAsync(5_180);
        expect(elements.installCounterNotice.hidden).toBe(true);
    });

    it('pauses once keyboard focus enters a control and Escape dismisses the notice', async () => {
        const { elements, controller, invoke } = harness({
            status: { available: true, enabled: true, noticeRequired: true },
        });
        await controller.setup();
        await vi.advanceTimersByTimeAsync(10_000);
        elements.installCounterNoticePrivacyButton.focus();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(elements.installCounterNotice.hidden).toBe(false);

        elements.installCounterNoticePrivacyButton.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        }));
        await vi.advanceTimersByTimeAsync(180);
        expect(elements.installCounterNotice.hidden).toBe(true);
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('acknowledge_install_counter_notice', {}));
    });

    it('serializes rapid preference clicks while a native update is pending', async () => {
        let resolveMutation;
        const mutation = new Promise((resolve) => {
            resolveMutation = resolve;
        });
        const { elements, controller, invoke } = harness({
            status: { available: true, enabled: true, noticeRequired: false },
            mutate: () => mutation,
        });

        await controller.setup();
        elements.installCounterEnabledButton.click();
        elements.installCounterEnabledButton.click();
        expect(elements.installCounterEnabledButton.disabled).toBe(true);
        expect(invoke).toHaveBeenCalledTimes(2);

        resolveMutation({ available: true, enabled: false, noticeRequired: false });
        await vi.waitFor(() => expect(elements.installCounterEnabledButton.disabled).toBe(false));
        expect(elements.installCounterEnabledButton.textContent).toBe('OFF');
    });
});
