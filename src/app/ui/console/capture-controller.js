function mapErudaLogType(type) {
    if (type === 'input') {
        return 'command';
    }
    if (type === 'output') {
        return 'result';
    }
    if (type === 'warning') {
        return 'warn';
    }
    if (type === 'verbose') {
        return 'debug';
    }
    if (type === 'dir') {
        return 'dir';
    }
    if (type === 'error') {
        return 'error';
    }
    if (type === 'info') {
        return 'info';
    }
    return 'log';
}

function resolveErudaLogArgs(log) {
    if (Array.isArray(log?.args) && log.args.length) {
        return log.args;
    }
    if (log?.header !== undefined && log?.header !== null) {
        return [log.header];
    }
    return [];
}

export function createConsoleCaptureController({
    formatEntryMessage,
    getConsoleTool,
    getErudaReady,
    isSuppressed,
    maxCaptured,
    maxErudaLogs,
    mirrorEntryToEruda,
    normalizeSerializable,
    onErudaInsert = () => {},
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

    function attachErudaLogger(logger) {
        if (!logger || typeof logger.on !== 'function' || state.erudaLogger === logger) {
            return;
        }
        detachErudaLogger();
        state.erudaLogger = logger;
        state.erudaInsertHandler = (log) => {
            if (state.erudaSyncingCapturedEntries) {
                return;
            }
            appendCapturedEntry({
                method: mapErudaLogType(log?.type),
                args: resolveErudaLogArgs(log),
                timestamp: Date.now(),
            }, { mirrorToEruda: false });
            onErudaInsert(log);
        };
        logger.on('insert', state.erudaInsertHandler);
    }

    function detachErudaLogger() {
        if (!state.erudaLogger || !state.erudaInsertHandler) {
            state.erudaLogger = null;
            state.erudaInsertHandler = null;
            return;
        }
        state.erudaLogger.off?.('insert', state.erudaInsertHandler);
        state.erudaLogger = null;
        state.erudaInsertHandler = null;
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
            });
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
        if ((!getErudaReady() && !getConsoleTool()) || !state.captured.length) {
            return;
        }
        const start = Math.max(0, state.captured.length - maxErudaLogs, state.erudaFlushCursor);
        state.erudaSyncingCapturedEntries = true;
        try {
            for (let index = start; index < state.captured.length; index += 1) {
                mirrorEntryToEruda(state.captured[index]);
            }
            state.erudaFlushCursor = state.captured.length;
        } finally {
            state.erudaSyncingCapturedEntries = false;
        }
    }

    function handleMirroredEntry() {
        state.erudaFlushCursor = state.captured.length;
        if (state.followLatest) {
            setTimeoutFn?.(() => scrollConsoleToLatest(), 30);
        }
    }

    return {
        appendCapturedEntry,
        attachErudaLogger,
        clearConsole,
        detachErudaLogger,
        flushToEruda,
        getVisibleEntries,
        handleMirroredEntry,
        installCapture,
        readCaptured,
        restoreConsoleMethods,
    };
}
