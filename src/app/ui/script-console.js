const MAX_CAPTURED = 1200;
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
        return JSON.stringify(value);
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
        currentLevel: 'all',
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

    function getScrollContainer() {
        return elements.scriptConsoleOutput || null;
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
        button.setAttribute('aria-label', state.followLatest ? 'Follow latest console entries' : 'Follow latest console entries off');
        button.title = state.followLatest
            ? 'Newest console entries stay pinned in view'
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

    function appendCapturedEntry(entry) {
        state.captured.push(entry);
        if (state.captured.length > MAX_CAPTURED) {
            state.captured.splice(0, state.captured.length - MAX_CAPTURED);
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

    async function openConsole() {
        state.isOpen = true;
        syncUi();
        renderConsoleEntries();
        onOpenChange(true);
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
                renderConsoleEntries();
            };
            element.addEventListener('click', handler);
            state.cleanupFns.push(() => element.removeEventListener('click', handler));
        });

        if (elements.scriptConsoleFilterSearch) {
            elements.scriptConsoleFilterSearch.value = '';
            const searchHandler = () => renderConsoleEntries();
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
            elements.scriptConsoleOutput.addEventListener('scroll', scrollHandler);
            state.cleanupFns.push(() => elements.scriptConsoleOutput?.removeEventListener('scroll', scrollHandler));
        }

        if (elements.scriptConsoleCopyButton) {
            const copyHandler = async () => {
                const text = getVisibleEntries()
                    .slice(0, 120)
                    .map((entry) => `[${formatTimestamp(entry.timestamp)}] ${resolveEntryBadge(entry.method)} ${formatEntryMessage(entry)}`)
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

        if (elements.scriptConsoleLogList) {
            elements.scriptConsoleLogList.innerHTML = '';
        }

        restoreConsoleMethods();
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
