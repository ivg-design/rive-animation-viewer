export function createConsoleCaptureController({
    formatEntryMessage,
    getConsoleTool,
    getErudaReady,
    isSuppressed,
    maxCaptured,
    maxErudaLogs,
    mirrorEntryToEruda,
    normalizeSerializable,
    renderConsoleEntries,
    scrollConsoleToLatest,
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    state,
    windowRef = globalThis.window,
} = {}) {
    function appendCapturedEntry(entry, { mirrorToEruda = true } = {}) {
        state.captured.push(entry);
        if (state.captured.length > maxCaptured) {
            const overflow = state.captured.length - maxCaptured;
            state.captured.splice(0, overflow);
            state.erudaFlushCursor = Math.max(0, state.erudaFlushCursor - overflow);
        }

        if (getErudaReady() && mirrorToEruda && mirrorEntryToEruda(entry)) {
            return;
        }

        renderConsoleEntries();
    }

    function installCapture() {
        if (state.captureInstalled || !windowRef?.console) {
            return;
        }

        ['log', 'info', 'warn', 'error', 'debug', 'dir'].forEach((method) => {
            const original = typeof windowRef.console[method] === 'function'
                ? windowRef.console[method].bind(windowRef.console)
                : null;

            if (!original) {
                return;
            }

            state.originalMethods[method] = original;

            windowRef.console[method] = (...args) => {
                if (!isSuppressed(args)) {
                    appendCapturedEntry({ method, args, timestamp: Date.now() });
                }
                return original(...args);
            };
        });

        state.captureInstalled = true;
    }

    function restoreConsoleMethods() {
        if (!windowRef?.console || !state.captureInstalled) {
            return;
        }

        Object.entries(state.originalMethods).forEach(([method, original]) => {
            if (typeof original === 'function') {
                windowRef.console[method] = original;
            }
        });
        state.captureInstalled = false;
    }

    function getVisibleEntries({ currentLevel, searchNeedle }) {
        return state.captured
            .filter((entry) => {
                const level = entry.method === 'warn' || entry.method === 'warning'
                    ? 'warning'
                    : entry.method === 'error'
                        ? 'error'
                        : 'info';
                if (currentLevel !== 'all' && level !== currentLevel) {
                    return false;
                }
                if (!searchNeedle) {
                    return true;
                }
                const haystack = `${entry.method} ${formatEntryMessage(entry)}`.toLowerCase();
                return haystack.includes(searchNeedle);
            })
            .slice()
            .reverse();
    }

    function clearConsole() {
        state.captured.length = 0;
        state.erudaFlushCursor = 0;
        state.erudaRowSequence = 0;
        try {
            getConsoleTool()?.clear?.();
        } catch {
            /* noop */
        }
        renderConsoleEntries();
    }

    function readCaptured(limit = 50) {
        const entries = state.captured
            .slice(-limit)
            .reverse()
            .map((entry) => ({
                method: entry.method,
                timestamp: entry.timestamp,
                args: entry.args.map(normalizeSerializable),
            }));

        return {
            total: state.captured.length,
            returned: entries.length,
            entries,
        };
    }

    function flushToEruda() {
        if (!getErudaReady() && !getConsoleTool()) {
            return;
        }
        const start = Math.max(0, state.captured.length - maxErudaLogs, state.erudaFlushCursor);
        for (let index = start; index < state.captured.length; index += 1) {
            mirrorEntryToEruda(state.captured[index]);
        }
        state.erudaFlushCursor = state.captured.length;
    }

    function handleMirroredEntry() {
        state.erudaFlushCursor = state.captured.length;
        if (state.followLatest) {
            setTimeoutFn?.(() => scrollConsoleToLatest(), 30);
        }
    }

    return {
        appendCapturedEntry,
        clearConsole,
        flushToEruda,
        getVisibleEntries,
        handleMirroredEntry,
        installCapture,
        readCaptured,
        restoreConsoleMethods,
    };
}
