const ENABLED_COMMAND = 'set_install_counter_enabled';
const STATUS_COMMAND = 'get_install_counter_status';
const ACKNOWLEDGE_NOTICE_COMMAND = 'acknowledge_install_counter_notice';
const OPEN_EXTERNAL_COMMAND = 'open_external_url';
const PRIVACY_URL = 'https://forge.mograph.life/apps/rav/privacy';
const NOTICE_DURATION_MS = 15_000;

export function createInstallCounterController({
    elements,
    getTauriInvoker = () => null,
    isTauriEnvironment = () => false,
    logEvent = () => {},
    documentRef = globalThis.document,
    windowRef = globalThis.window,
} = {}) {
    const button = elements?.installCounterEnabledButton;
    const notice = elements?.installCounterNotice;
    const noticePrivacyButton = elements?.installCounterNoticePrivacyButton;
    const noticeDismissButton = elements?.installCounterNoticeDismissButton;
    let disposed = false;
    let busy = false;
    let currentStatus = { available: false, enabled: false, noticeRequired: false };
    let noticeTimer = null;
    let hideTimer = null;
    let timerStartedAt = 0;
    let remainingNoticeMs = NOTICE_DURATION_MS;
    let focusBeforeNotice = null;
    const pauseReasons = new Set();

    function normalizeStatus(status = {}) {
        return {
            available: Boolean(status.available),
            enabled: Boolean(status.enabled ?? status.consented),
            noticeRequired: Boolean(status.noticeRequired),
        };
    }

    function render(status = currentStatus) {
        currentStatus = normalizeStatus(status);
        if (button) {
            button.disabled = busy || !currentStatus.available;
            button.setAttribute('aria-pressed', currentStatus.enabled ? 'true' : 'false');
            button.textContent = !currentStatus.available ? 'UNAVAILABLE' : (currentStatus.enabled ? 'ON' : 'OFF');
            button.classList.toggle('is-active', currentStatus.available && currentStatus.enabled);
        }
        const EventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
        documentRef?.dispatchEvent?.(new EventCtor('rav:ui-overlay-state-dirty', {
            detail: { purpose: 'settings' },
        }));
    }

    function getStatusSnapshot() {
        return { ...currentStatus, busy };
    }

    function clearNoticeTimer() {
        if (noticeTimer !== null) {
            windowRef.clearTimeout(noticeTimer);
            noticeTimer = null;
        }
    }

    function scheduleNoticeTimer() {
        clearNoticeTimer();
        if (!notice || notice.hidden || pauseReasons.size > 0 || remainingNoticeMs <= 0) return;
        timerStartedAt = Date.now();
        noticeTimer = windowRef.setTimeout(() => completeNotice(), remainingNoticeMs);
    }

    function pauseNoticeTimer(reason) {
        if (pauseReasons.has(reason)) return;
        pauseReasons.add(reason);
        if (noticeTimer !== null) {
            remainingNoticeMs = Math.max(0, remainingNoticeMs - (Date.now() - timerStartedAt));
            clearNoticeTimer();
        }
    }

    function resumeNoticeTimer(reason) {
        pauseReasons.delete(reason);
        scheduleNoticeTimer();
    }

    function hideNotice() {
        clearNoticeTimer();
        if (!notice || notice.hidden) return;
        const restoreFocus = notice.contains(documentRef?.activeElement);
        notice.classList.remove('is-visible');
        if (hideTimer !== null) windowRef.clearTimeout(hideTimer);
        hideTimer = windowRef.setTimeout(() => {
            if (notice) notice.hidden = true;
            if (restoreFocus && focusBeforeNotice?.isConnected) {
                focusBeforeNotice.focus?.({ preventScroll: true });
            }
            hideTimer = null;
        }, 180);
    }

    async function acknowledgeNotice() {
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') return false;
        try {
            const status = await invoke(ACKNOWLEDGE_NOTICE_COMMAND, {});
            render(status);
            return currentStatus.noticeRequired === false;
        } catch (error) {
            logEvent('ui', 'install-counter-notice-failed', 'Anonymous usage notice could not be recorded.', error);
            return false;
        }
    }

    function completeNotice() {
        hideNotice();
        void acknowledgeNotice();
    }

    function showNotice() {
        if (!notice || !currentStatus.available || !currentStatus.enabled || !currentStatus.noticeRequired) return;
        remainingNoticeMs = NOTICE_DURATION_MS;
        pauseReasons.clear();
        notice.hidden = false;
        void notice.offsetWidth;
        notice.classList.add('is-visible');
        focusBeforeNotice = documentRef?.activeElement;
        notice.focus?.({ preventScroll: true });
        scheduleNoticeTimer();
    }

    async function setEnabled(enabled) {
        if (disposed || busy || !currentStatus.available) return false;
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') return false;
        busy = true;
        render(currentStatus);
        try {
            const status = await invoke(ENABLED_COMMAND, { enabled });
            render(status);
            if (!currentStatus.enabled) hideNotice();
            return currentStatus.enabled === enabled;
        } catch (error) {
            logEvent('ui', 'install-counter-preference-failed', 'Unable to update anonymous usage preference.', error);
            return false;
        } finally {
            busy = false;
            if (!disposed) render(currentStatus);
        }
    }

    async function onSettingsClick() {
        if (button?.disabled) return;
        await setEnabled(button.getAttribute('aria-pressed') !== 'true');
    }

    async function openPrivacyDetails() {
        const invoke = getTauriInvoker();
        try {
            if (isTauriEnvironment() && typeof invoke === 'function') {
                await invoke(OPEN_EXTERNAL_COMMAND, { url: PRIVACY_URL });
            } else {
                windowRef?.open?.(PRIVACY_URL, '_blank', 'noopener,noreferrer');
            }
        } catch (error) {
            logEvent('ui', 'install-counter-privacy-open-failed', 'Unable to open anonymous usage details.', error);
        }
    }

    function onFocusOut() {
        windowRef.setTimeout(() => {
            if (!notice?.contains(documentRef?.activeElement)) resumeNoticeTimer('focus');
        }, 0);
    }

    function onVisibilityChange() {
        if (documentRef?.hidden) pauseNoticeTimer('visibility');
        else resumeNoticeTimer('visibility');
    }

    function onPointerEnter() {
        pauseNoticeTimer('pointer');
    }

    function onPointerLeave() {
        resumeNoticeTimer('pointer');
    }

    function onFocusIn(event) {
        if (event.target !== notice) pauseNoticeTimer('focus');
    }

    function onNoticeKeyDown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        completeNotice();
    }

    function attachListeners() {
        button?.addEventListener('click', onSettingsClick);
        noticePrivacyButton?.addEventListener('click', openPrivacyDetails);
        noticeDismissButton?.addEventListener('click', completeNotice);
        notice?.addEventListener('mouseenter', onPointerEnter);
        notice?.addEventListener('mouseleave', onPointerLeave);
        notice?.addEventListener('focusin', onFocusIn);
        notice?.addEventListener('focusout', onFocusOut);
        notice?.addEventListener('keydown', onNoticeKeyDown);
        documentRef?.addEventListener('visibilitychange', onVisibilityChange);
    }

    async function setup() {
        if (!button) return;
        attachListeners();
        if (!isTauriEnvironment()) {
            render({ available: false, enabled: false });
            return;
        }
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') {
            render({ available: false, enabled: false });
            return;
        }
        try {
            const status = await invoke(STATUS_COMMAND, {});
            render(status);
            showNotice();
        } catch (error) {
            render({ available: false, enabled: false });
            logEvent('ui', 'install-counter-status-failed', 'Anonymous usage status unavailable.', error);
        }
    }

    function dispose() {
        disposed = true;
        clearNoticeTimer();
        if (hideTimer !== null) windowRef.clearTimeout(hideTimer);
        button?.removeEventListener('click', onSettingsClick);
        noticePrivacyButton?.removeEventListener('click', openPrivacyDetails);
        noticeDismissButton?.removeEventListener('click', completeNotice);
        notice?.removeEventListener('mouseenter', onPointerEnter);
        notice?.removeEventListener('mouseleave', onPointerLeave);
        notice?.removeEventListener('focusin', onFocusIn);
        notice?.removeEventListener('focusout', onFocusOut);
        notice?.removeEventListener('keydown', onNoticeKeyDown);
        documentRef?.removeEventListener('visibilitychange', onVisibilityChange);
    }

    return { setup, dispose, acknowledgeNotice, getStatusSnapshot, setEnabled };
}
