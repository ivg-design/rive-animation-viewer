const ERUDA_VENDOR_PATH = '/vendor/eruda.js';
const MAX_CAPTURED = 1200;
const MAX_ERUDA_LOGS = 500;
const COMMAND_HISTORY_LIMIT = 100;
const SUPPRESSED_WARNINGS = ['Measure loop'];

function normalizeSerializable(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return String(value);
    }
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export function createScriptConsoleController({
    elements,
    callbacks = {},
    documentRef = globalThis.document,
    navigatorRef = globalThis.navigator,
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    windowRef = globalThis.window,
} = {}) {
    const {
        logEvent = () => {},
        renderEventLog = () => {},
    } = callbacks;

    const state = {
        captureInstalled: false,
        captured: [],
        cleanupFns: [],
        commandHistory: [],
        consoleTool: null,
        currentLevel: 'all',
        erudaLoadPromise: null,
        erudaReady: false,
        flushCursor: 0,
        historyIndex: -1,
        historyPending: '',
        isOpen: false,
        methodBindings: new Map(),
        originalMethods: {},
        replKeydownHandler: null,
        setupDone: false,
    };

    function isSuppressed(args) {
        return typeof args?.[0] === 'string' && SUPPRESSED_WARNINGS.some((needle) => args[0].includes(needle));
    }

    function syncLevelButtons() {
        const levelButtons = [
            { element: elements.scriptConsoleFilterAll, level: 'all' },
            { element: elements.scriptConsoleFilterInfo, level: 'info' },
            { element: elements.scriptConsoleFilterWarning, level: 'warning' },
            { element: elements.scriptConsoleFilterError, level: 'error' },
        ];

        levelButtons.forEach(({ element, level }) => {
            if (!element) {
                return;
            }
            const active = state.currentLevel === level;
            element.classList.toggle('is-active', active);
            element.setAttribute('aria-pressed', String(active));
        });
    }

    function searchNeedle() {
        return String(elements.scriptConsoleFilterSearch?.value || '').trim().toLowerCase();
    }

    function syncUi() {
        documentRef?.body?.classList.toggle('js-console-mode', state.isOpen);

        const button = elements.toggleScriptConsoleButton;
        if (button) {
            button.classList.toggle('is-active', state.isOpen);
            button.setAttribute('aria-pressed', String(state.isOpen));
            button.title = state.isOpen ? 'Disable JavaScript Console' : 'Enable JavaScript Console';
        }

        elements.eventLogPanel?.classList.toggle('script-console-mode', state.isOpen);

        if (elements.eventLogTitle) {
            elements.eventLogTitle.textContent = state.isOpen ? 'JAVASCRIPT CONSOLE' : 'EVENT CONSOLE';
        }

        if (elements.eventLogFilterControls) {
            elements.eventLogFilterControls.hidden = state.isOpen;
        }
        if (elements.scriptConsoleSummaryRight) {
            elements.scriptConsoleSummaryRight.hidden = !state.isOpen;
        }
        if (elements.scriptConsoleView) {
            elements.scriptConsoleView.hidden = !state.isOpen;
        }
        if (elements.eventLogList) {
            elements.eventLogList.hidden = state.isOpen;
        }
        if (elements.eventLogCount) {
            elements.eventLogCount.style.display = state.isOpen ? 'none' : '';
        }
    }

    function appendCapturedEntry(entry) {
        state.captured.push(entry);
        if (state.captured.length > MAX_CAPTURED) {
            const excess = state.captured.length - MAX_CAPTURED;
            state.captured.splice(0, excess);
            state.flushCursor = Math.max(0, state.flushCursor - excess);
        }

        if (state.consoleTool) {
            appendEntryToEruda(entry);
            state.flushCursor = state.captured.length;
        }
    }

    function appendEntryToEruda(entry) {
        if (!state.consoleTool || isSuppressed(entry.args)) {
            return;
        }

        const method = typeof state.consoleTool[entry.method] === 'function' ? entry.method : 'log';
        try {
            state.consoleTool[method](...entry.args);
        } catch {
            try {
                state.consoleTool.log(...entry.args);
            } catch {
                // noop
            }
        }
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

            const wrapped = (...args) => {
                if (!isSuppressed(args)) {
                    appendCapturedEntry({ method, args, timestamp: Date.now() });
                }
                return original(...args);
            };

            state.methodBindings.set(method, wrapped);
            windowRef.console[method] = wrapped;
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

    function getConsoleTool() {
        if (state.consoleTool) {
            return state.consoleTool;
        }

        if (windowRef?.eruda && typeof windowRef.eruda.get === 'function') {
            try {
                state.consoleTool = windowRef.eruda.get('console');
            } catch {
                state.consoleTool = null;
            }
        }
        return state.consoleTool;
    }

    function reparentErudaContainer(host) {
        if (!host || !documentRef?.querySelectorAll) {
            return;
        }

        const containers = Array.from(documentRef.querySelectorAll('.eruda-container'));
        if (!containers.length) {
            return;
        }

        const target = containers[containers.length - 1];
        if (target.parentElement !== host) {
            host.appendChild(target);
        }
        target.classList.add('rav-eruda');

        containers.forEach((container) => {
            if (container !== target && container.parentElement === documentRef.body) {
                container.remove();
            }
        });
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = documentRef?.querySelector?.(`script[data-src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === 'true') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
                return;
            }

            const script = documentRef?.createElement?.('script');
            if (!script || !documentRef?.head) {
                reject(new Error('Unable to inject script tag'));
                return;
            }

            script.src = src;
            script.dataset.src = src;
            script.onload = () => {
                script.dataset.loaded = 'true';
                resolve();
            };
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            documentRef.head.appendChild(script);
        });
    }

    async function ensureErudaReady() {
        if (state.erudaReady) {
            return state.consoleTool;
        }
        if (state.erudaLoadPromise) {
            return state.erudaLoadPromise;
        }

        state.erudaLoadPromise = (async () => {
            if (!windowRef?.eruda) {
                await loadScript(ERUDA_VENDOR_PATH);
            }
            if (!windowRef?.eruda) {
                throw new Error('Eruda failed to load');
            }

            const host = elements.scriptConsoleOutput;
            if (!host) {
                throw new Error('No console host element');
            }

            host.innerHTML = '';

            try {
                windowRef.eruda.destroy?.();
            } catch {
                // noop
            }

            windowRef.eruda.init({
                container: host,
                inline: true,
                autoScale: false,
                useShadowDom: false,
                tool: ['console'],
                defaults: { theme: 'dark' },
            });

            windowRef.eruda.show('console');
            try {
                windowRef.eruda.remove?.('settings');
            } catch {
                // noop
            }

            reparentErudaContainer(host);
            await new Promise((resolve) => setTimeoutFn(resolve, 100));
            reparentErudaContainer(host);

            state.consoleTool = getConsoleTool();
            if (!state.consoleTool) {
                throw new Error('Console tool not found');
            }

            const config = state.consoleTool.config;
            if (config?.set) {
                config.set('overrideConsole', false);
                config.set('jsExecution', true);
                config.set('catchGlobalErr', true);
                config.set('asyncRender', true);
                config.set('lazyEvaluation', true);
            }

            if (state.consoleTool._logger?.options) {
                state.consoleTool._logger.options.maxNum = MAX_ERUDA_LOGS;
            }

            const lunaConsole = host.querySelector('.luna-console');
            if (lunaConsole) {
                lunaConsole.classList.remove('luna-console-theme-light');
                lunaConsole.classList.add('luna-console-theme-dark');
            }

            const loggerWarn = state.consoleTool._logger?.warn?.bind(state.consoleTool._logger);
            if (loggerWarn) {
                state.consoleTool._logger.warn = (...args) => {
                    if (!isSuppressed(args)) {
                        loggerWarn(...args);
                    }
                };
            }

            wireReplInput();
            flushToEruda();
            state.erudaReady = true;
            return state.consoleTool;
        })()
            .catch((error) => {
                state.consoleTool = null;
                state.erudaReady = false;
                throw error;
            })
            .finally(() => {
                state.erudaLoadPromise = null;
            });

        return state.erudaLoadPromise;
    }

    function flushToEruda() {
        if (!state.consoleTool) {
            return;
        }

        const limit = Math.min(state.captured.length, MAX_ERUDA_LOGS);
        const start = Math.max(state.flushCursor, state.captured.length - limit);
        for (let index = start; index < state.captured.length; index += 1) {
            const entry = state.captured[index];
            if (entry) {
                appendEntryToEruda(entry);
            }
        }
        state.flushCursor = state.captured.length;
    }

    function applyFilter(level = state.currentLevel, search = searchNeedle()) {
        if (!state.consoleTool || typeof state.consoleTool.filter !== 'function') {
            return;
        }

        state.consoleTool.filter((log) => {
            if (level !== 'all') {
                const type = String(log?.type || '').toLowerCase();
                if (level === 'warning') {
                    if (type !== 'warning' && type !== 'warn') {
                        return false;
                    }
                } else if (type !== level) {
                    return false;
                }
            }

            if (!search) {
                return true;
            }

            const haystack = [log?.type, log?.text, log?.src, log?.html, log?.stack]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(search);
        });
    }

    function clearConsole() {
        if (state.consoleTool && typeof state.consoleTool.clear === 'function') {
            try {
                state.consoleTool.clear();
            } catch {
                // noop
            }
        }
    }

    function wireReplInput() {
        const input = elements.scriptConsoleReplInput;
        if (!input) {
            return;
        }

        if (state.replKeydownHandler) {
            input.removeEventListener('keydown', state.replKeydownHandler);
        }

        input.placeholder = 'Type JS and press Enter';
        state.replKeydownHandler = async (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                const code = input.value.trim();
                if (!code) {
                    return;
                }

                if (state.commandHistory[0] !== code) {
                    state.commandHistory.unshift(code);
                }
                if (state.commandHistory.length > COMMAND_HISTORY_LIMIT) {
                    state.commandHistory.length = COMMAND_HISTORY_LIMIT;
                }

                state.historyIndex = -1;
                state.historyPending = '';
                input.value = '';
                await exec(code);
                return;
            }

            if (event.key === 'ArrowUp') {
                if (!state.commandHistory.length) {
                    return;
                }
                event.preventDefault();
                if (state.historyIndex === -1) {
                    state.historyPending = input.value;
                }
                if (state.historyIndex < state.commandHistory.length - 1) {
                    state.historyIndex += 1;
                    input.value = state.commandHistory[state.historyIndex];
                }
                return;
            }

            if (event.key === 'ArrowDown') {
                if (state.historyIndex < 0) {
                    return;
                }
                event.preventDefault();
                state.historyIndex -= 1;
                input.value = state.historyIndex >= 0
                    ? state.commandHistory[state.historyIndex]
                    : state.historyPending;
            }
        };

        input.addEventListener('keydown', state.replKeydownHandler);
    }

    function scrollConsoleToBottom() {
        setTimeoutFn(() => {
            const scrollContainer = elements.scriptConsoleOutput?.querySelector('.luna-console-logs');
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }, 50);
    }

    async function openConsole() {
        state.isOpen = true;
        syncUi();
        await ensureErudaReady();
        return { open: true };
    }

    function closeConsole() {
        state.isOpen = false;
        syncUi();
        renderEventLog();
        return { open: false };
    }

    function readCaptured(limit = 50) {
        const entries = state.captured.slice(-limit).map((entry) => ({
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

    async function exec(code) {
        const source = String(code || '').trim();
        if (!source) {
            return { ok: false, error: 'code is required' };
        }

        try {
            if (!state.isOpen) {
                await openConsole();
            } else {
                await ensureErudaReady();
            }

            const logger = state.consoleTool?._logger;
            if (!logger || typeof logger.evaluate !== 'function') {
                throw new Error('Console evaluator is unavailable');
            }

            logger.evaluate(source);
            scrollConsoleToBottom();
            return { ok: true, code: source };
        } catch (error) {
            logEvent('ui', 'console-exec-failed', error.message);
            return { ok: false, code: source, error: error.message };
        }
    }

    function setup() {
        if (state.setupDone) {
            return;
        }
        state.setupDone = true;

        const toggleHandler = () => {
            if (state.isOpen) {
                closeConsole();
            } else {
                openConsole().catch((error) => {
                    logEvent('ui', 'console-open-failed', error.message);
                });
            }
        };
        elements.toggleScriptConsoleButton?.addEventListener('click', toggleHandler);
        state.cleanupFns.push(() => elements.toggleScriptConsoleButton?.removeEventListener('click', toggleHandler));

        const levelButtons = [
            { element: elements.scriptConsoleFilterAll, level: 'all' },
            { element: elements.scriptConsoleFilterInfo, level: 'info' },
            { element: elements.scriptConsoleFilterWarning, level: 'warning' },
            { element: elements.scriptConsoleFilterError, level: 'error' },
        ];

        levelButtons.forEach(({ element, level }) => {
            if (!element) {
                return;
            }

            const handler = () => {
                state.currentLevel = level;
                syncLevelButtons();
                applyFilter(state.currentLevel, searchNeedle());
            };

            element.addEventListener('click', handler);
            state.cleanupFns.push(() => element.removeEventListener('click', handler));
        });

        if (elements.scriptConsoleFilterSearch) {
            elements.scriptConsoleFilterSearch.value = '';
            const searchHandler = () => {
                applyFilter(state.currentLevel, searchNeedle());
            };
            elements.scriptConsoleFilterSearch.addEventListener('input', searchHandler);
            state.cleanupFns.push(() => elements.scriptConsoleFilterSearch?.removeEventListener('input', searchHandler));
        }

        if (elements.scriptConsoleCopyButton) {
            const copyHandler = async () => {
                const text = state.captured
                    .slice(-120)
                    .reverse()
                    .map((entry) => `[${formatTimestamp(entry.timestamp)}] ${entry.method}: ${entry.args.map(String).join(' ')}`)
                    .join('\n');
                if (text) {
                    await navigatorRef?.clipboard?.writeText?.(text).catch(() => {});
                }
            };
            elements.scriptConsoleCopyButton.addEventListener('click', copyHandler);
            state.cleanupFns.push(() => elements.scriptConsoleCopyButton?.removeEventListener('click', copyHandler));
        }

        if (elements.scriptConsoleClearButton) {
            const clearHandler = () => clearConsole();
            elements.scriptConsoleClearButton.addEventListener('click', clearHandler);
            state.cleanupFns.push(() => elements.scriptConsoleClearButton?.removeEventListener('click', clearHandler));
        }

        syncLevelButtons();
        syncUi();
    }

    function destroy() {
        state.cleanupFns.splice(0).forEach((cleanup) => cleanup());
        state.setupDone = false;

        if (elements.scriptConsoleReplInput && state.replKeydownHandler) {
            elements.scriptConsoleReplInput.removeEventListener('keydown', state.replKeydownHandler);
        }
        state.replKeydownHandler = null;

        try {
            windowRef?.eruda?.destroy?.();
        } catch {
            // noop
        }

        state.consoleTool = null;
        state.erudaReady = false;
        state.erudaLoadPromise = null;
        if (elements.scriptConsoleOutput) {
            elements.scriptConsoleOutput.innerHTML = '';
        }

        restoreConsoleMethods();
    }

    return {
        close: closeConsole,
        destroy,
        exec,
        installCapture,
        isOpen: () => state.isOpen,
        open: openConsole,
        readCaptured,
        setup,
    };
}
