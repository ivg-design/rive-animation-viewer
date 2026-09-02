export function createRiveEventBridge({ isEnabled = () => true, logEvent = () => {} } = {}) {
    let unsubscribers = [];

    function clear() {
        unsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch {
                /* noop */
            }
        });
        unsubscribers = [];
    }

    function attach(runtime, instance) {
        clear();
        if (!isEnabled()) return;
        if (!runtime?.EventType || !instance || typeof instance.on !== 'function') {
            console.warn('[rive-viewer] cannot attach event listeners: missing EventType or .on() method');
            return;
        }

        const eventType = runtime.EventType.RiveEvent;
        if (!eventType) {
            console.warn('[rive-viewer] runtime.EventType.RiveEvent is falsy');
            return;
        }

        const listener = (event) => {
            const payload = event?.data ?? event;
            const eventName = payload?.name || event?.name || 'unknown';
            logEvent('rive-user', eventName, '', payload);
        };
        instance.on(eventType, listener);
        unsubscribers.push(() => instance.off?.(eventType, listener));
    }

    return { attach, clear };
}
