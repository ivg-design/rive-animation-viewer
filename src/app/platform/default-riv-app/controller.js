const STATUS_COMMAND = 'get_riv_default_app_status';
const APPLY_COMMAND = 'make_rav_default_for_riv';

function normalizeStatus(status = {}) {
    const available = Boolean(status.available);
    const state = String(status.state || (available ? 'other-app' : 'unavailable'));
    const currentBundlePath = String(status.currentBundlePath || '');
    const contentTypeHandlers = Array.isArray(status.contentTypeHandlers)
        ? status.contentTypeHandlers
            .map((entry) => ({
                contentType: String(entry?.contentType || ''),
                handlerPath: String(entry?.handlerPath || ''),
            }))
            .filter((entry) => entry.contentType)
        : [];
    return {
        available,
        canonicalHandlerPath: String(status.canonicalHandlerPath || ''),
        contentTypeHandlers,
        currentBundlePath,
        handlerName: String(status.handlerName || ''),
        legacyHandlerPath: String(status.legacyHandlerPath || ''),
        playHandlerPath: String(status.playHandlerPath || ''),
        reason: String(status.reason || ''),
        resolvedContentType: String(status.resolvedContentType || ''),
        resolvedHandlerPath: String(status.resolvedHandlerPath || ''),
        riviewHandlerPath: String(status.riviewHandlerPath || ''),
        state: available ? state : 'unavailable',
    };
}

/**
 * Owns the one-shot Default .riv App setting. This deliberately refreshes only
 * when Settings is opened or the user asks to repair it; it never polls macOS.
 */
export function createDefaultRivAppController({
    documentRef = globalThis.document,
    elements,
    getTauriInvoker = () => null,
    isTauriEnvironment = () => false,
    logEvent = () => {},
} = {}) {
    const button = elements?.defaultRivAppActionButton;
    const statusElement = elements?.defaultRivAppStatus;
    let busy = false;
    let disposed = false;
    let currentStatus = normalizeStatus();

    function dispatchStateDirty() {
        const EventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
        documentRef?.dispatchEvent?.(new EventCtor('rav:ui-overlay-state-dirty', {
            detail: { purpose: 'settings' },
        }));
    }

    function render(nextStatus = currentStatus) {
        currentStatus = normalizeStatus(nextStatus);
        const isDefault = currentStatus.state === 'rav-default';
        const isUnavailable = !currentStatus.available || currentStatus.state === 'unavailable';
        const statusLabel = busy
            ? 'CHECKING…'
            : (isUnavailable
            ? 'UNAVAILABLE'
            : (isDefault
                ? 'RAV DEFAULT'
                : (currentStatus.state === 'pending'
                    ? 'PENDING'
                    : (currentStatus.state === 'rav-other-copy'
                        ? 'ANOTHER RAV'
                        : (currentStatus.handlerName || 'UNKNOWN APP')))));
        const statusDetail = currentStatus.reason || '';
        if (statusElement) {
            statusElement.textContent = statusLabel;
            statusElement.title = statusDetail;
            statusElement.setAttribute('aria-label', `Default .riv app: ${statusLabel}${statusDetail ? `. ${statusDetail}` : ''}`);
        }
        if (button) {
            button.disabled = busy || isUnavailable;
            button.textContent = busy
                ? 'WORKING…'
                : (isUnavailable
                    ? 'UNAVAILABLE'
                    : (isDefault ? 'REPAIR ICON' : 'MAKE DEFAULT'));
            button.title = isDefault
                ? 'Refresh RAV’s .riv registration and document icon metadata'
                : 'Make RAV the default app for .riv files';
            button.setAttribute('aria-label', button.title);
        }
        dispatchStateDirty();
    }

    function getStatusSnapshot() {
        return {
            ...currentStatus,
            busy,
            contentTypeHandlers: currentStatus.contentTypeHandlers.map((entry) => ({ ...entry })),
        };
    }

    async function refresh() {
        if (disposed || !isTauriEnvironment()) {
            render({ available: false, state: 'unavailable' });
            return getStatusSnapshot();
        }
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') {
            render({ available: false, state: 'unavailable' });
            return getStatusSnapshot();
        }
        busy = true;
        render(currentStatus);
        try {
            const status = await invoke(STATUS_COMMAND, {});
            if (!disposed) render(status);
        } catch (error) {
            if (!disposed) {
                render({ available: false, reason: 'Default-app controls are unavailable.', state: 'unavailable' });
                logEvent('ui', 'default-riv-app-status-failed', 'Default .riv app status unavailable.', error);
            }
        }
        busy = false;
        if (!disposed) render(currentStatus);
        return getStatusSnapshot();
    }

    async function apply() {
        if (disposed || busy || !currentStatus.available) return false;
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') return false;
        busy = true;
        render(currentStatus);
        try {
            const status = await invoke(APPLY_COMMAND, {});
            if (!disposed) render(status);
            return currentStatus.state === 'rav-default';
        } catch (error) {
            logEvent('ui', 'default-riv-app-apply-failed', 'Unable to make RAV the default .riv app.', error);
            await refresh();
            return false;
        } finally {
            busy = false;
            if (!disposed) render(currentStatus);
        }
    }

    function onAction() {
        void apply();
    }

    async function setup() {
        button?.addEventListener('click', onAction);
        await refresh();
    }

    function dispose() {
        disposed = true;
        button?.removeEventListener('click', onAction);
    }

    return { apply, dispose, getStatusSnapshot, refresh, setup };
}
