export function createSelectionInteractionGuard({
    documentRef = globalThis.document,
    elements,
    onSyncRequested = () => {},
    scheduleFn = globalThis.setTimeout?.bind(globalThis),
} = {}) {
    let listenersAttached = false;
    let syncPending = false;
    const controls = () => [
        elements?.artboardSelect,
        elements?.playbackSelect,
        elements?.vmInstanceSelect,
    ].filter(Boolean);
    const isFocused = () => controls().includes(documentRef?.activeElement);

    function request({ force = false } = {}) {
        if (!force && isFocused()) {
            syncPending = true;
            return false;
        }
        syncPending = false;
        onSyncRequested();
        return true;
    }

    function schedule({ force = false } = {}) {
        const flush = () => {
            if (syncPending) request({ force });
        };
        if (typeof scheduleFn === 'function') scheduleFn(flush, 0);
        else (documentRef?.defaultView?.queueMicrotask || globalThis.queueMicrotask)?.(flush);
    }

    function setup() {
        if (listenersAttached) return;
        listenersAttached = true;
        controls().forEach((select) => {
            // A user selection becomes the next requested authority. Do not
            // replay a child tick that arrived while the native popup was open.
            select.addEventListener('change', () => {
                syncPending = false;
            });
            select.addEventListener('blur', () => schedule());
            select.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') schedule({ force: true });
            });
        });
    }

    return { request, setup };
}
