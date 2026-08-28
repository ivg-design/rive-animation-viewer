import { OPEN_FILE_POLL_INTERVAL_MS } from '../../core/constants.js';
import { extractOpenedFilePath } from './path-utils.js';

export function createOpenedFileQueue({
    clearTimeoutFn = globalThis.clearTimeout,
    ensureTauriBridge = async () => {},
    getTauriEventListener = async () => null,
    getTauriInvoker = () => null,
    isTauriEnvironment = () => false,
    loadRivFromPath = async () => false,
    setTimeoutFn = globalThis.setTimeout,
} = {}) {
    let drainPromise = null;
    let drainRequested = false;
    let pollTimeout = null;
    let unlisten = null;

    async function drain() {
        await ensureTauriBridge();
        const invoke = getTauriInvoker();
        if (!invoke) {
            if (isTauriEnvironment()) {
                console.warn('[rive-viewer] Tauri environment detected but invoke bridge is unavailable');
            }
            return false;
        }

        drainRequested = true;
        if (drainPromise) return drainPromise;

        drainPromise = (async () => {
            let processedAny = false;
            const processedPaths = new Set();
            do {
                drainRequested = false;
                while (true) {
                    let filePath = '';
                    try {
                        filePath = extractOpenedFilePath(await invoke('get_opened_file'));
                    } catch (error) {
                        console.warn('[rive-viewer] get_opened_file failed:', error);
                        break;
                    }
                    if (!filePath) break;
                    processedAny = true;
                    if (processedPaths.has(filePath)) continue;
                    processedPaths.add(filePath);
                    await loadRivFromPath(filePath);
                }
            } while (drainRequested);
            return processedAny;
        })();

        try {
            return await drainPromise;
        } finally {
            drainPromise = null;
            if (drainRequested) void drain();
        }
    }

    function startPolling(intervalMs = OPEN_FILE_POLL_INTERVAL_MS) {
        if (!isTauriEnvironment()) return;
        if (pollTimeout) clearTimeoutFn(pollTimeout);

        const poll = async () => {
            await drain();
            pollTimeout = setTimeoutFn(poll, intervalMs);
        };
        pollTimeout = setTimeoutFn(poll, Math.max(250, intervalMs));
    }

    async function setupListener() {
        const listen = await getTauriEventListener();
        if (typeof listen !== 'function') return false;
        try {
            unlisten = await listen('open-file', async () => {
                // Native owns the durable queue. The event only wakes its
                // single consumer, preventing event + polling double loads.
                return drain();
            });
            return true;
        } catch (error) {
            console.warn('[rive-viewer] failed to register open-file listener:', error);
            return false;
        }
    }

    function dispose() {
        if (pollTimeout) {
            clearTimeoutFn(pollTimeout);
            pollTimeout = null;
        }
        if (typeof unlisten === 'function') {
            try {
                unlisten();
            } catch {
                /* noop */
            }
        }
        unlisten = null;
    }

    return { dispose, drain, setupListener, startPolling };
}
