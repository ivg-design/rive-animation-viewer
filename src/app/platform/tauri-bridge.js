export function createTauriBridgeController() {
    let tauriApiLoadPromise = null;
    const tauriBridge = {
        invoke: null,
        listen: null,
    };

    function cleanupBridgeCallbacks(...ids) {
        ids.forEach((id) => Reflect.deleteProperty(window, id));
    }

    function makeCallbackId(prefix) {
        if (window.crypto?.randomUUID) {
            return `_${prefix}_${window.crypto.randomUUID()}`;
        }
        return `_${prefix}_${Math.random().toString(36).slice(2)}${Date.now()}`;
    }

    function isTauriEnvironment() {
        return Boolean(
            window.__TAURI_INTERNALS__
            || window.__TAURI__
            || typeof window.__TAURI_IPC__ === 'function'
        );
    }

    async function ensureTauriBridge() {
        if (!isTauriEnvironment()) {
            return tauriBridge;
        }
        if (window.__TAURI_INTERNALS__?.invoke) {
            tauriBridge.invoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
        }
        if (window.__TAURI__?.core?.invoke) {
            tauriBridge.invoke = window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
        } else if (window.__TAURI__?.invoke) {
            tauriBridge.invoke = window.__TAURI__.invoke.bind(window.__TAURI__);
        }
        if (window.__TAURI__?.event?.listen) {
            tauriBridge.listen = window.__TAURI__.event.listen.bind(window.__TAURI__.event);
        }
        if (typeof tauriBridge.invoke === 'function' && typeof tauriBridge.listen === 'function') {
            return tauriBridge;
        }
        if (tauriApiLoadPromise) {
            await tauriApiLoadPromise;
            return tauriBridge;
        }

        tauriApiLoadPromise = (async () => {
            if (location.protocol !== 'http:' && location.protocol !== 'https:') {
                tauriApiLoadPromise = null;
                return;
            }
            try {
                const [{ invoke }, { listen }] = await Promise.all([
                    import('@tauri-apps/api/core'),
                    import('@tauri-apps/api/event'),
                ]);
                tauriBridge.invoke = tauriBridge.invoke || invoke;
                tauriBridge.listen = tauriBridge.listen || listen;
            } catch (error) {
                console.warn('[rive-viewer] failed to load Tauri API bridge:', error);
            } finally {
                tauriApiLoadPromise = null;
            }
        })();

        await tauriApiLoadPromise;
        return tauriBridge;
    }

    function getTauriInvoker() {
        if (typeof tauriBridge.invoke === 'function') {
            return tauriBridge.invoke;
        }
        if (window.__TAURI_INTERNALS__?.invoke) {
            return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
        }
        if (window.__TAURI__?.core?.invoke) {
            return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
        }
        if (window.__TAURI__?.invoke) {
            return window.__TAURI__.invoke.bind(window.__TAURI__);
        }
        if (typeof window.__TAURI_IPC__ === 'function') {
            return (cmd, args = {}) =>
                new Promise((resolve, reject) => {
                    const successId = makeCallbackId('tauri_cb');
                    const errorId = makeCallbackId('tauri_err');

                    window[successId] = (data) => {
                        cleanupBridgeCallbacks(successId, errorId);
                        resolve(data);
                    };
                    window[errorId] = (error) => {
                        cleanupBridgeCallbacks(successId, errorId);
                        reject(error);
                    };

                    window.__TAURI_IPC__({
                        cmd,
                        callback: successId,
                        error: errorId,
                        ...args,
                    });
                });
        }
        return null;
    }

    async function getTauriEventListener() {
        if (typeof tauriBridge.listen === 'function') {
            return tauriBridge.listen;
        }
        if (window.__TAURI__?.event?.listen) {
            return window.__TAURI__.event.listen.bind(window.__TAURI__.event);
        }
        await ensureTauriBridge();
        if (typeof tauriBridge.listen === 'function') {
            return tauriBridge.listen;
        }
        const legacyListen = window.__TAURI__?.event?.listen;
        return typeof legacyListen === 'function' ? legacyListen.bind(window.__TAURI__.event) : null;
    }

    return {
        ensureTauriBridge,
        getTauriInvoker,
        getTauriEventListener,
        isTauriEnvironment,
        tauriBridge,
    };
}
