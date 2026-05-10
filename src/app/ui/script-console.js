import { writeTextToClipboard } from './console/io/clipboard.js';
import { createConsoleCaptureController } from './console/capture-controller.js';
import { buildVisibleConsoleCopyText } from './console/copy-visible-rows.js';
import { summarizeConsoleExecution, waitForConsoleTranscript } from './console/exec-outcome.js';
import { loadErudaConsole } from './console/eruda/loader.js';
import { configureErudaConsoleTool } from './console/eruda/configure-tool.js';
import { createErudaPresentationController } from './console/eruda/presentation.js';
import { formatEntryMessage, formatTimestamp, normalizeSerializable, resolveEntryBadge, resolveEntryLevel } from './console/formatting.js';
import { createReplHistoryController } from './console/repl-history-controller.js';
import { registerConsoleBindings } from './console/setup-bindings.js';
import { createConsoleUiStateController } from './console/ui-state-controller.js';
const ERUDA_VENDOR_PATH = '/vendor/eruda.js';
const MAX_CAPTURED = 1200;
const MAX_ERUDA_LOGS = 500;
const COMMAND_HISTORY_LIMIT = 100;
const SUPPRESSED_WARNINGS = ['Measure loop'];
export function createScriptConsoleController({
    elements,
    callbacks = {},
    documentRef = globalThis.document,
    navigatorRef = globalThis.navigator,
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    windowRef = globalThis.window,
} = {}) {
    const { logEvent = () => {}, onOpenChange = () => {}, onToggleRequested = null, renderEventLog = () => {} } = callbacks;
    const state = {
        captureInstalled: false,
        captured: [],
        cleanupFns: [],
        commandHistory: [],
        consoleTool: null,
        currentLevel: 'all',
        erudaFlushCursor: 0,
        erudaLoadPromise: null,
        erudaInsertHandler: null,
        erudaLogger: null,
        erudaObserver: null,
        erudaPresentationSyncing: false,
        erudaReady: false,
        erudaRowSequence: 0,
        erudaSyncingCapturedEntries: false,
        followLatest: true,
        historyIndex: -1,
        historyPending: '',
        isOpen: false,
        originalMethods: {},
        replKeydownHandler: null,
        scrollContainer: null,
        scrollHandler: null,
        setupDone: false,
    };

    const isSuppressed = (args) =>
        typeof args?.[0] === 'string' && SUPPRESSED_WARNINGS.some((needle) => args[0].includes(needle));
    function getConsoleTool() {
        if (state.consoleTool) return state.consoleTool;
        if (windowRef?.eruda && typeof windowRef.eruda.get === 'function') {
            try {
                state.consoleTool = windowRef.eruda.get('console');
            } catch {
                state.consoleTool = null;
            }
        }
        return state.consoleTool;
    }

    const uiStateController = createConsoleUiStateController({
        documentRef,
        elements,
        getErudaReady: () => state.erudaReady,
        state,
    });
    const erudaPresentation = createErudaPresentationController({
        bindScrollContainer: uiStateController.bindScrollContainer,
        documentRef,
        elements,
        getCurrentLevel: () => state.currentLevel,
        getFollowLatest: () => state.followLatest,
        getSearchNeedle: () => String(elements.scriptConsoleFilterSearch?.value || '').trim().toLowerCase(),
        scrollConsoleToLatest: uiStateController.scrollConsoleToLatest,
        setTimeoutFn,
        state,
    });

    function shouldMirrorToEruda(method) { return ['log', 'info', 'warn', 'error', 'debug', 'dir', 'command', 'result'].includes(method); }

    function renderConsoleEntries() {
        if (state.erudaReady) return;

        const list = uiStateController.getListContainer();
        const scrollContainer = uiStateController.getScrollContainer();
        if (!list) return;

        const previousTop = scrollContainer?.scrollTop || 0;
        const visibleEntries = captureController.getVisibleEntries({
            currentLevel: state.currentLevel,
            searchNeedle: String(elements.scriptConsoleFilterSearch?.value || '').trim().toLowerCase(),
        });

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
                message.textContent = formatEntryMessage(entry, windowRef);
                message.title = message.textContent;

                row.append(time, kind, message);
                list.appendChild(row);
            });
        }

        if (!scrollContainer) return;
        if (state.followLatest) {
            uiStateController.scrollConsoleToLatest();
            return;
        }
        const latestScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
        scrollContainer.scrollTop = Math.min(previousTop, latestScrollTop);
    }

    function mirrorEntryToEruda(entry) {
        const consoleTool = getConsoleTool();
        if (!consoleTool || !shouldMirrorToEruda(entry.method)) return false;

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
        captureController.handleMirroredEntry();
        erudaPresentation.refreshErudaPresentation();
        return true;
    }

    const captureController = createConsoleCaptureController({
        formatEntryMessage: (entry) => formatEntryMessage(entry, windowRef),
        getConsoleTool,
        getErudaReady: () => state.erudaReady,
        isSuppressed,
        maxCaptured: MAX_CAPTURED,
        maxErudaLogs: MAX_ERUDA_LOGS,
        mirrorEntryToEruda,
        normalizeSerializable: (value) => normalizeSerializable(value, windowRef),
        onErudaInsert: () => {
            erudaPresentation.refreshErudaPresentation();
            uiStateController.bindScrollContainer();
            if (state.followLatest) {
                setTimeoutFn?.(() => uiStateController.scrollConsoleToLatest(), 0);
            }
        },
        renderConsoleEntries,
        scrollConsoleToLatest: uiStateController.scrollConsoleToLatest,
        setTimeoutFn,
        state,
        windowRef,
    });

    const replHistoryController = createReplHistoryController({
        commandHistoryLimit: COMMAND_HISTORY_LIMIT,
        elements,
        exec,
        state,
    });

    async function loadEruda() {
        if (state.erudaReady) return true;
        if (state.erudaLoadPromise) return state.erudaLoadPromise;

        state.erudaLoadPromise = loadErudaConsole({
            captureController,
            configureConsoleTool: (consoleTool) => {
                configureErudaConsoleTool({
                    captureController,
                    consoleTool,
                    elements,
                    isSuppressed,
                    maxErudaLogs: MAX_ERUDA_LOGS,
                });
            },
            documentRef,
            elements,
            ensureConsoleTool: getConsoleTool,
            erudaPresentation,
            erudaVendorPath: ERUDA_VENDOR_PATH,
            getFollowLatest: () => state.followLatest,
            getWindowEruda: () => windowRef?.eruda,
            onConsoleReady: () => {
                state.erudaReady = true;
                captureController.attachErudaLogger(state.consoleTool?._logger || null);
            },
            onScrollContainerReady: uiStateController.bindScrollContainer,
            scrollConsoleToLatest: uiStateController.scrollConsoleToLatest,
            setTimeoutFn,
            state,
            windowRef,
        }).catch((error) => {
            state.consoleTool = null;
            state.erudaReady = false;
            throw error;
        }).finally(() => {
            state.erudaLoadPromise = null;
        });

        return state.erudaLoadPromise;
    }

    function applyErudaFilter() {
        erudaPresentation.applyErudaDomFilter();
        if (state.followLatest) setTimeoutFn?.(() => uiStateController.scrollConsoleToLatest(), 30);
    }
    function syncUi() { uiStateController.syncUi(); uiStateController.syncLevelButtons(); uiStateController.syncFollowButton(); }

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
        if (!state.erudaReady) renderConsoleEntries();
        return { open: true };
    }
    function closeConsole() {
        state.isOpen = false;
        syncUi();
        renderEventLog();
        onOpenChange(false);
        return { open: false };
    }
    async function evaluateConsoleSource(source) {
        try {
            return await windowRef.eval(`(async () => (${source}))()`);
        } catch {
            return await windowRef.eval(`(async () => { ${source}\n })()`);
        }
    }

    async function exec(code) {
        const source = String(code || '').trim();
        if (!source) {
            return { ok: false, error: 'code is required' };
        }

        const capturedCountBeforeExec = state.captured.length;

        try {
            if (!state.isOpen) {
                await openConsole();
            }

            const consoleTool = getConsoleTool();
            if (consoleTool?._logger?.evaluate) {
                const evaluation = consoleTool._logger.evaluate(source);
                if (typeof evaluation?.then === 'function') await evaluation;
                await waitForConsoleTranscript(setTimeoutFn);
                erudaPresentation.refreshErudaPresentation();
                uiStateController.bindScrollContainer();
                if (state.followLatest) {
                    setTimeoutFn?.(() => uiStateController.scrollConsoleToLatest(), 50);
                }
                return summarizeConsoleExecution({
                    code: source,
                    entries: state.captured.slice(capturedCountBeforeExec),
                    normalizeSerializable: (value) => normalizeSerializable(value, windowRef),
                });
            }

            captureController.appendCapturedEntry({ method: 'command', args: [source], timestamp: Date.now() });
            const result = await evaluateConsoleSource(source);
            if (result !== undefined) {
                captureController.appendCapturedEntry({ method: 'result', args: [normalizeSerializable(result, windowRef)], timestamp: Date.now() });
            }
            return summarizeConsoleExecution({
                code: source,
                entries: state.captured.slice(capturedCountBeforeExec),
                normalizeSerializable: (value) => normalizeSerializable(value, windowRef),
            });
        } catch (error) {
            captureController.appendCapturedEntry({ method: 'error', args: [error.message], timestamp: Date.now() });
            logEvent('ui', 'console-exec-failed', error.message);
            return summarizeConsoleExecution({
                code: source,
                entries: state.captured.slice(capturedCountBeforeExec),
                normalizeSerializable: (value) => normalizeSerializable(value, windowRef),
            });
        }
    }

    function setup() {
        if (state.setupDone) return;
        state.setupDone = true;

        state.scrollHandler = () => uiStateController.syncFollowStateFromScroll();
        uiStateController.bindScrollContainer();
        state.cleanupFns.push(() => uiStateController.unbindScrollContainer());
        state.cleanupFns.push(...registerConsoleBindings({
            copyVisibleRows: async () => {
                const text = buildVisibleConsoleCopyText({
                    classifyRow: erudaPresentation.classifyErudaRow,
                    getRows: erudaPresentation.getErudaRows,
                    getText: erudaPresentation.readErudaRowText,
                    orderRows: (rows) => rows,
                    root: elements.scriptConsoleOutput?.querySelector('.luna-console-logs'),
                });
                if (text) {
                    await writeTextToClipboard(text, { documentRef, navigatorRef });
                }
            },
            elements,
            onClear: () => captureController.clearConsole(),
            onFilterSearch: () => {
                if (state.erudaReady) applyErudaFilter(); else renderConsoleEntries();
            },
            onFollowToggle: () => {
                state.followLatest = !state.followLatest;
                uiStateController.syncFollowButton();
                if (state.followLatest) uiStateController.scrollConsoleToLatest();
            },
            onLevelChange: (level) => {
                state.currentLevel = level;
                uiStateController.syncLevelButtons();
                if (state.erudaReady) applyErudaFilter(); else renderConsoleEntries();
            },
            onToggle: () => {
                if (typeof onToggleRequested === 'function') {
                    onToggleRequested();
                } else if (state.isOpen) {
                    closeConsole();
                } else {
                    openConsole().catch((error) => logEvent('ui', 'console-open-failed', error.message));
                }
            },
        }).cleanupFns);

        replHistoryController.wire();
        syncUi();
        renderConsoleEntries();
    }

    function destroy() {
        state.cleanupFns.splice(0).forEach((cleanup) => cleanup());
        state.setupDone = false;
        state.isOpen = false;
        syncUi();
        onOpenChange(false);
        replHistoryController.destroy();
        captureController.detachErudaLogger();
        try {
            windowRef?.eruda?.destroy?.();
        } catch {
            /* noop */
        }
        state.erudaObserver?.disconnect?.();
        state.erudaObserver = null;
        state.consoleTool = null;
        state.erudaReady = false;
        if (elements.scriptConsoleOutput) elements.scriptConsoleOutput.innerHTML = elements.scriptConsoleLogList ? '<div id="script-console-log-list"></div>' : '';
        captureController.restoreConsoleMethods();
    }

    function setFilter({ level, search } = {}) {
        if (level === 'all' || level === 'info' || level === 'warning' || level === 'error') {
            state.currentLevel = level;
            uiStateController.syncLevelButtons();
        }
        if (typeof search === 'string' && elements.scriptConsoleFilterSearch) elements.scriptConsoleFilterSearch.value = search;
        if (state.erudaReady) applyErudaFilter(); else renderConsoleEntries();
        return { level: state.currentLevel, search: String(elements.scriptConsoleFilterSearch?.value || '') };
    }

    return {
        clear: () => captureController.clearConsole(),
        close: closeConsole,
        destroy,
        exec,
        installCapture: captureController.installCapture,
        isFollowingLatest: () => state.followLatest,
        isOpen: () => state.isOpen,
        open: openConsole,
        readCaptured: captureController.readCaptured,
        setFilter,
        setup,
    };
}
