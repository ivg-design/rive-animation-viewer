import { createSafeInspectPreview } from '../core/safe-inspect.js';

const ERUDA_VENDOR_PATH = '/vendor/eruda.js';
const MAX_CAPTURED = 1200;
const MAX_ERUDA_LOGS = 500;
const COMMAND_HISTORY_LIMIT = 100;
const SUPPRESSED_WARNINGS = ['Measure loop'];

function normalizeSerializable(value) {
    return createSafeInspectPreview(value, { windowRef: globalThis.window });
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const centiseconds = String(Math.floor(date.getMilliseconds() / 10)).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}.${centiseconds}`;
}

function formatArgValue(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
        return String(value);
    }
    try {
        return JSON.stringify(createSafeInspectPreview(value, { windowRef: globalThis.window }));
    } catch {
        return String(value);
    }
}

function formatEntryMessage(entry) {
    return entry.args.map(formatArgValue).join(' ');
}

function resolveEntryLevel(method) {
    if (method === 'warn' || method === 'warning') {
        return 'warning';
    }
    if (method === 'error') {
        return 'error';
    }
    return 'info';
}

function resolveEntryBadge(method) {
    if (method === 'command') return 'CMD';
    if (method === 'result') return 'RESULT';
    if (method === 'debug') return 'DEBUG';
    if (method === 'info') return 'INFO';
    if (method === 'warn' || method === 'warning') return 'WARN';
    if (method === 'error') return 'ERROR';
    return 'LOG';
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
        onOpenChange = () => {},
        onToggleRequested = null,
        renderEventLog = () => {},
    } = callbacks;

    const state = {
        captureInstalled: false,
        captured: [],
        cleanupFns: [],
        commandHistory: [],
        consoleTool: null,
        currentLevel: 'all',
        erudaFlushCursor: 0,
        erudaLoadPromise: null,
        erudaObserver: null,
        erudaPresentationSyncing: false,
        erudaRowSequence: 0,
        erudaReady: false,
        followLatest: true,
        historyIndex: -1,
        historyPending: '',
        isOpen: false,
        originalMethods: {},
        replKeydownHandler: null,
        setupDone: false,
    };

    function isSuppressed(args) {
        return typeof args?.[0] === 'string' && SUPPRESSED_WARNINGS.some((needle) => args[0].includes(needle));
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

    function getErudaScrollContainer() {
        if (!state.erudaReady) {
            return null;
        }
        return elements.scriptConsoleOutput?.querySelector('.luna-console-logs-space')
            || elements.scriptConsoleOutput?.querySelector('.rav-eruda .luna-console-logs-space')
            || null;
    }

    function getScrollContainer() {
        return getErudaScrollContainer() || elements.scriptConsoleOutput || null;
    }

    function getListContainer() {
        return elements.scriptConsoleLogList || elements.scriptConsoleOutput || null;
    }

    function searchNeedle() {
        return String(elements.scriptConsoleFilterSearch?.value || '').trim().toLowerCase();
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

    function syncFollowButton() {
        const button = elements.scriptConsoleFollowButton;
        if (!button) {
            return;
        }
        button.classList.toggle('is-active', state.followLatest);
        button.setAttribute('aria-pressed', String(state.followLatest));
        button.dataset.followState = state.followLatest ? 'on' : 'off';
        button.setAttribute('aria-label', state.followLatest ? 'Follow latest console output' : 'Follow latest console output off');
        button.title = state.followLatest
            ? 'Newest console output stays pinned in view'
            : 'Pinned follow is off';
    }

    function syncFollowStateFromScroll() {
        const container = getScrollContainer();
        if (!container) {
            return;
        }
        const nextFollowLatest = container.scrollTop <= 6;
        if (nextFollowLatest === state.followLatest) {
            return;
        }
        state.followLatest = nextFollowLatest;
        syncFollowButton();
    }

    function scrollConsoleToLatest() {
        const container = getScrollContainer();
        if (!container) {
            return;
        }
        container.scrollTop = 0;
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

    function shouldMirrorToEruda(method) {
        return ['log', 'info', 'warn', 'error', 'debug', 'dir'].includes(method);
    }

    function mirrorEntryToEruda(entry) {
        const consoleTool = getConsoleTool();
        if (!consoleTool || !shouldMirrorToEruda(entry.method)) {
            return false;
        }

        const method = typeof consoleTool[entry.method] === 'function' ? entry.method : 'log';
        try {
            consoleTool[method](...entry.args);
        } catch {
            try {
                consoleTool.log(...entry.args);
            } catch {
                return false;
            }
        }
        state.erudaFlushCursor = state.captured.length;
        if (state.followLatest) {
            setTimeoutFn?.(() => scrollConsoleToLatest(), 30);
        }
        return true;
    }

    function appendCapturedEntry(entry, { mirrorToEruda = true } = {}) {
        state.captured.push(entry);
        if (state.captured.length > MAX_CAPTURED) {
            const overflow = state.captured.length - MAX_CAPTURED;
            state.captured.splice(0, overflow);
            state.erudaFlushCursor = Math.max(0, state.erudaFlushCursor - overflow);
        }

        if (state.erudaReady && mirrorToEruda && mirrorEntryToEruda(entry)) {
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

    function getVisibleEntries() {
        const needle = searchNeedle();
        return state.captured
            .filter((entry) => {
                const level = resolveEntryLevel(entry.method);
                if (state.currentLevel !== 'all' && level !== state.currentLevel) {
                    return false;
                }
                if (!needle) {
                    return true;
                }
                const haystack = `${entry.method} ${formatEntryMessage(entry)}`.toLowerCase();
                return haystack.includes(needle);
            })
            .slice()
            .reverse();
    }

    function renderConsoleEntries() {
        if (state.erudaReady) {
            return;
        }

        const list = getListContainer();
        const scrollContainer = getScrollContainer();
        if (!list) {
            return;
        }

        const previousHeight = scrollContainer?.scrollHeight || 0;
        const previousTop = scrollContainer?.scrollTop || 0;
        const visibleEntries = getVisibleEntries();

        list.innerHTML = '';
        if (!visibleEntries.length) {
            const empty = documentRef.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No console output matches current filters.';
            list.appendChild(empty);
        } else {
            visibleEntries.forEach((entry) => {
                const row = documentRef.createElement('div');
                row.className = `event-log-row console-log-row console-log-row-${resolveEntryLevel(entry.method)}`;

                const time = documentRef.createElement('span');
                time.className = 'event-row-time';
                time.textContent = formatTimestamp(entry.timestamp);

                const kind = documentRef.createElement('span');
                kind.className = `event-row-kind console-row-kind ${resolveEntryLevel(entry.method)}`;
                kind.textContent = resolveEntryBadge(entry.method);

                const message = documentRef.createElement('span');
                message.className = 'event-row-message console-row-message';
                message.textContent = formatEntryMessage(entry);
                message.title = message.textContent;

                row.appendChild(time);
                row.appendChild(kind);
                row.appendChild(message);
                list.appendChild(row);
            });
        }

        if (!scrollContainer) {
            return;
        }
        if (state.followLatest) {
            scrollConsoleToLatest();
            return;
        }
        const heightDelta = scrollContainer.scrollHeight - previousHeight;
        scrollContainer.scrollTop = previousTop + Math.max(0, heightDelta);
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

    async function evaluateConsoleSource(source) {
        const expressionWrapper = `(async () => (${source}))()`;
        try {
            return await windowRef.eval(expressionWrapper);
        } catch {
            const statementWrapper = `(async () => { ${source}\n })()`;
            return await windowRef.eval(statementWrapper);
        }
    }

    async function loadEruda() {
        if (state.erudaReady) {
            return true;
        }
        if (state.erudaLoadPromise) {
            return state.erudaLoadPromise;
        }

        state.erudaLoadPromise = (async () => {
            try {
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
                    /* noop */
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
                    /* noop */
                }

                reparentErudaContainer(host);
                await sleep(60);
                reparentErudaContainer(host);
                windowRef.eruda.show('console');

                state.consoleTool = getConsoleTool();
                if (!state.consoleTool) {
                    throw new Error('Console tool not found');
                }

                const config = state.consoleTool.config;
                if (config?.set) {
                    config.set('overrideConsole', true);
                    config.set('jsExecution', true);
                    config.set('catchGlobalErr', true);
                    config.set('asyncRender', true);
                    config.set('lazyEvaluation', true);
                }

                if (state.consoleTool._logger?.options) {
                    state.consoleTool._logger.options.maxNum = MAX_ERUDA_LOGS;
                }

                const lunaElement = host.querySelector('.luna-console');
                if (lunaElement) {
                    lunaElement.classList.remove('luna-console-theme-light');
                    lunaElement.classList.add('luna-console-theme-dark');
                }

                if (state.consoleTool._logger?.warn) {
                    const originalWarn = state.consoleTool._logger.warn.bind(state.consoleTool._logger);
                    state.consoleTool._logger.warn = (...args) => {
                        if (isSuppressed(args)) {
                            return;
                        }
                        originalWarn(...args);
                    };
                }

                flushToEruda();
                state.erudaReady = true;
                observeErudaLogs();
                refreshErudaPresentation();
                applyErudaFilter();
                if (state.followLatest) {
                    setTimeoutFn?.(() => scrollConsoleToLatest(), 30);
                }
                return true;
            } catch (error) {
                state.consoleTool = null;
                state.erudaReady = false;
                throw error;
            } finally {
                state.erudaLoadPromise = null;
            }
        })();

        return state.erudaLoadPromise;
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

    function applyErudaFilter() {
        applyErudaDomFilter();
        if (state.followLatest) {
            setTimeoutFn?.(() => scrollConsoleToLatest(), 30);
        }
    }

    async function openConsole() {
        state.isOpen = true;
        syncUi();
        onOpenChange(true);

        try {
            await loadEruda();
        } catch (error) {
            logEvent('ui', 'console-init-failed', error.message);
            renderConsoleEntries();
        }

        if (!state.erudaReady) {
            renderConsoleEntries();
        }
        return { open: true };
    }

    function closeConsole() {
        state.isOpen = false;
        syncUi();
        renderEventLog();
        onOpenChange(false);
        return { open: false };
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

    async function exec(code) {
        const source = String(code || '').trim();
        if (!source) {
            return { ok: false, error: 'code is required' };
        }

        try {
            if (!state.isOpen) {
                await openConsole();
            }

            const consoleTool = getConsoleTool();
            if (consoleTool?._logger?.evaluate) {
                appendCapturedEntry({ method: 'command', args: [source], timestamp: Date.now() }, { mirrorToEruda: false });
                const evaluation = consoleTool._logger.evaluate(source);
                if (typeof evaluation?.then === 'function') {
                    await evaluation;
                }
                if (state.followLatest) {
                    setTimeoutFn?.(() => scrollConsoleToLatest(), 50);
                }
                return { ok: true, code: source };
            }

            appendCapturedEntry({ method: 'command', args: [source], timestamp: Date.now() });
            const result = await evaluateConsoleSource(source);
            if (result !== undefined) {
                appendCapturedEntry({ method: 'result', args: [normalizeSerializable(result)], timestamp: Date.now() });
            }
            return { ok: true, code: source, result: normalizeSerializable(result) };
        } catch (error) {
            appendCapturedEntry({ method: 'error', args: [error.message], timestamp: Date.now() });
            logEvent('ui', 'console-exec-failed', error.message);
            return { ok: false, code: source, error: error.message };
        }
    }

    function flushToEruda() {
        if (!state.erudaReady && !getConsoleTool()) {
            return;
        }
        const start = Math.max(0, state.captured.length - MAX_ERUDA_LOGS, state.erudaFlushCursor);
        for (let index = start; index < state.captured.length; index += 1) {
            mirrorEntryToEruda(state.captured[index]);
        }
        state.erudaFlushCursor = state.captured.length;
        refreshErudaPresentation();
    }

    function setup() {
        if (state.setupDone) {
            return;
        }
        state.setupDone = true;

        const toggleHandler = () => {
            if (typeof onToggleRequested === 'function') {
                onToggleRequested();
                return;
            }

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

        [
            { element: elements.scriptConsoleFilterAll, level: 'all' },
            { element: elements.scriptConsoleFilterInfo, level: 'info' },
            { element: elements.scriptConsoleFilterWarning, level: 'warning' },
            { element: elements.scriptConsoleFilterError, level: 'error' },
        ].forEach(({ element, level }) => {
            if (!element) {
                return;
            }
            const handler = () => {
                state.currentLevel = level;
                syncLevelButtons();
                if (state.erudaReady) {
                    applyErudaFilter();
                } else {
                    renderConsoleEntries();
                }
            };
            element.addEventListener('click', handler);
            state.cleanupFns.push(() => element.removeEventListener('click', handler));
        });

        if (elements.scriptConsoleFilterSearch) {
            elements.scriptConsoleFilterSearch.value = '';
            const searchHandler = () => {
                if (state.erudaReady) {
                    applyErudaFilter();
                } else {
                    renderConsoleEntries();
                }
            };
            elements.scriptConsoleFilterSearch.addEventListener('input', searchHandler);
            state.cleanupFns.push(() => elements.scriptConsoleFilterSearch?.removeEventListener('input', searchHandler));
        }

        if (elements.scriptConsoleFollowButton) {
            const followHandler = () => {
                state.followLatest = !state.followLatest;
                syncFollowButton();
                if (state.followLatest) {
                    scrollConsoleToLatest();
                }
            };
            elements.scriptConsoleFollowButton.addEventListener('click', followHandler);
            state.cleanupFns.push(() => elements.scriptConsoleFollowButton?.removeEventListener('click', followHandler));
        }

        if (elements.scriptConsoleOutput) {
            const scrollHandler = () => syncFollowStateFromScroll();
            elements.scriptConsoleOutput.addEventListener('scroll', scrollHandler, true);
            state.cleanupFns.push(() => elements.scriptConsoleOutput?.removeEventListener('scroll', scrollHandler, true));
        }

        if (elements.scriptConsoleCopyButton) {
            const copyHandler = async () => {
                const text = getErudaRows(elements.scriptConsoleOutput?.querySelector('.luna-console-logs'))
                    .filter((row) => !row.hidden)
                    .map((row) => {
                        const timestamp = row.querySelector('.rav-console-time')?.textContent || '';
                        const rowLevel = classifyErudaRow(row);
                        const badge = rowLevel === 'command'
                            ? 'CMD'
                            : rowLevel === 'result'
                                ? 'RESULT'
                                : rowLevel === 'warning'
                                    ? 'WARN'
                                    : rowLevel === 'error'
                                        ? 'ERROR'
                                        : 'LOG';
                        const message = readErudaRowText(row);
                        return timestamp
                            ? `[${timestamp}] ${badge} ${message}`
                            : `${badge} ${message}`;
                    })
                    .join('\n');
                if (text) {
                    await writeTextToClipboard(text);
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

        wireReplInput();
        syncLevelButtons();
        syncFollowButton();
        syncUi();
        renderConsoleEntries();
    }

    function destroy() {
        state.cleanupFns.splice(0).forEach((cleanup) => cleanup());
        state.setupDone = false;
        state.isOpen = false;
        syncUi();
        onOpenChange(false);

        if (elements.scriptConsoleReplInput && state.replKeydownHandler) {
            elements.scriptConsoleReplInput.removeEventListener('keydown', state.replKeydownHandler);
        }
        state.replKeydownHandler = null;

        try {
            windowRef?.eruda?.destroy?.();
        } catch {
            /* noop */
        }
        state.erudaObserver?.disconnect?.();
        state.erudaObserver = null;
        state.consoleTool = null;
        state.erudaReady = false;

        if (elements.scriptConsoleOutput) {
            elements.scriptConsoleOutput.innerHTML = elements.scriptConsoleLogList ? '<div id="script-console-log-list"></div>' : '';
        }

        restoreConsoleMethods();
    }

    function reparentErudaContainer(host) {
        if (!host) {
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
            const existing = documentRef.querySelector(`script[data-src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === 'true') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed: ${src}`)), { once: true });
                return;
            }
            const script = documentRef.createElement('script');
            script.src = src;
            script.dataset.src = src;
            script.onload = () => {
                script.dataset.loaded = 'true';
                resolve();
            };
            script.onerror = () => reject(new Error(`Failed: ${src}`));
            documentRef.head.appendChild(script);
        });
    }

    async function writeTextToClipboard(text) {
        try {
            if (typeof navigatorRef?.clipboard?.writeText === 'function') {
                await navigatorRef.clipboard.writeText(text);
                return true;
            }
        } catch {
            /* fall through */
        }

        const textarea = documentRef?.createElement?.('textarea');
        if (!textarea) {
            return false;
        }

        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        textarea.style.inset = '0';
        documentRef.body.appendChild(textarea);
        textarea.select();

        let copied = false;
        try {
            copied = documentRef.execCommand?.('copy') === true;
        } catch {
            copied = false;
        } finally {
            textarea.remove();
        }

        return copied;
    }

    async function sleep(ms) {
        return new Promise((resolve) => setTimeoutFn(resolve, ms));
    }

    function getErudaLogContainers() {
        const output = elements.scriptConsoleOutput;
        if (!output) {
            return [];
        }
        return [
            output.querySelector('.luna-console-logs'),
            output.querySelector('.luna-console-fake-logs'),
        ].filter(Boolean);
    }

    function getErudaRows(container) {
        if (!container) {
            return [];
        }
        return Array.from(container.children).filter((child) =>
            child.classList?.contains('luna-console-log-container'));
    }

    function classifyErudaRow(row) {
        if (!row) {
            return 'info';
        }
        if (row.querySelector('.luna-console-error')) {
            return 'error';
        }
        if (row.querySelector('.luna-console-warn, .luna-console-warning')) {
            return 'warning';
        }
        if (row.querySelector('.luna-console-input')) {
            return 'command';
        }
        if (row.querySelector('.luna-console-output')) {
            return 'result';
        }
        return 'info';
    }

    function resolveErudaBadge(row) {
        const level = classifyErudaRow(row);
        if (level === 'command') {
            return 'CMD';
        }
        if (level === 'result') {
            return 'RESULT';
        }
        if (level === 'warning') {
            return 'WARN';
        }
        if (level === 'error') {
            return 'ERROR';
        }
        return 'LOG';
    }

    function readErudaRowText(row) {
        const content = row?.querySelector('.luna-console-log-content');
        if (!content) {
            return '';
        }

        const clone = content.cloneNode(true);
        clone.querySelector('.rav-console-time')?.remove();
        clone.querySelector('.rav-console-badge')?.remove();
        return String(clone.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function shouldShowErudaRow(row) {
        const rowLevel = classifyErudaRow(row);
        if (state.currentLevel === 'warning') {
            return rowLevel === 'warning' && searchMatch(row);
        }
        if (state.currentLevel === 'error') {
            return rowLevel === 'error' && searchMatch(row);
        }
        if (state.currentLevel === 'info') {
            return rowLevel !== 'warning' && rowLevel !== 'error' && searchMatch(row);
        }
        return searchMatch(row);
    }

    function searchMatch(row) {
        const needle = searchNeedle();
        if (!needle) {
            return true;
        }
        return readErudaRowText(row).toLowerCase().includes(needle);
    }

    function applyErudaDomFilter() {
        getErudaLogContainers().forEach((container) => {
            getErudaRows(container).forEach((row) => {
                row.hidden = !shouldShowErudaRow(row);
            });
        });
    }

    function ensureRowTimestamp(row) {
        if (!row) {
            return;
        }
        if (!row.dataset.ravSeq) {
            state.erudaRowSequence += 1;
            row.dataset.ravSeq = String(state.erudaRowSequence);
        }

        if (row.querySelector('.rav-console-time')) {
            return;
        }

        const content = row.querySelector('.luna-console-log-content');
        if (!content) {
            return;
        }

        const stamp = documentRef.createElement('span');
        stamp.className = 'rav-console-time';
        stamp.textContent = formatTimestamp(Date.now());
        content.prepend(stamp);
    }

    function ensureRowBadge(row) {
        if (!row) {
            return;
        }

        const content = row.querySelector('.luna-console-log-content');
        if (!content) {
            return;
        }

        let badge = content.querySelector('.rav-console-badge');
        if (!badge) {
            badge = documentRef.createElement('span');
            badge.className = 'rav-console-badge';
            const timestamp = content.querySelector('.rav-console-time');
            if (timestamp?.nextSibling) {
                content.insertBefore(badge, timestamp.nextSibling);
            } else {
                content.prepend(badge);
            }
        }

        const level = classifyErudaRow(row);
        badge.textContent = resolveErudaBadge(row);
        badge.dataset.level = level;
        badge.className = `rav-console-badge is-${level}`;
    }

    function reorderRowsNewestFirst(container) {
        const rows = getErudaRows(container);
        if (rows.length < 2) {
            return;
        }
        const orderedRows = rows
            .slice()
            .sort((left, right) => Number(right.dataset.ravSeq || 0) - Number(left.dataset.ravSeq || 0));
        const needsReorder = orderedRows.some((row, index) => row !== rows[index]);
        if (!needsReorder) {
            return;
        }
        orderedRows.forEach((row) => container.appendChild(row));
    }

    function refreshErudaPresentation() {
        if (!state.erudaReady || state.erudaPresentationSyncing) {
            return;
        }

        state.erudaPresentationSyncing = true;
        try {
            getErudaLogContainers().forEach((container) => {
                const rows = getErudaRows(container);
                rows.forEach(ensureRowTimestamp);
                rows.forEach(ensureRowBadge);
                reorderRowsNewestFirst(container);
            });
            applyErudaDomFilter();

            if (state.followLatest) {
                setTimeoutFn?.(() => scrollConsoleToLatest(), 0);
            }
        } finally {
            state.erudaPresentationSyncing = false;
        }
    }

    function observeErudaLogs() {
        state.erudaObserver?.disconnect?.();
        const containers = getErudaLogContainers();
        if (!containers.length || typeof MutationObserver !== 'function') {
            return;
        }

        state.erudaObserver = new MutationObserver(() => {
            refreshErudaPresentation();
        });

        containers.forEach((container) => {
            state.erudaObserver.observe(container, { childList: true, subtree: false });
        });
    }

    return {
        close: closeConsole,
        destroy,
        exec,
        installCapture,
        isFollowingLatest: () => state.followLatest,
        isOpen: () => state.isOpen,
        open: openConsole,
        readCaptured,
        setup,
    };
}
