import {
    formatTimestamp,
    resolveEntryBadge,
    resolveEntryLevel,
} from '../formatting.js';

export function createErudaPresentationController({
    MutationObserverCtor = globalThis.MutationObserver,
    bindScrollContainer = () => {},
    documentRef = globalThis.document,
    elements,
    getCurrentLevel = () => 'all',
    getFollowLatest = () => true,
    getSearchNeedle = () => '',
    scrollConsoleToLatest = () => {},
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    state,
} = {}) {
    function getErudaLogContainers() {
        const output = elements.scriptConsoleOutput;
        if (!output) {
            return [];
        }
        const visibleLogs = output.querySelector('.luna-console-logs');
        if (visibleLogs) {
            return [visibleLogs];
        }

        const logsSpace = output.querySelector('.luna-console-logs-space');
        if (logsSpace) {
            return [logsSpace];
        }

        const fakeLogs = output.querySelector('.luna-console-fake-logs');
        return fakeLogs ? [fakeLogs] : [];
    }

    function getErudaRows(container) {
        if (!container) {
            return [];
        }
        return Array.from(container.querySelectorAll('.luna-console-log-container'));
    }

    function getErudaRowGroups(container) {
        const rows = getErudaRows(container);
        const groups = new Map();
        rows.forEach((row) => {
            const parent = row.parentElement;
            if (!parent) {
                return;
            }
            if (!groups.has(parent)) {
                groups.set(parent, []);
            }
            groups.get(parent).push(row);
        });
        return Array.from(groups.values());
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
        if (level === 'command' || level === 'result') {
            return resolveEntryBadge(level);
        }
        return resolveEntryBadge(level === 'info' ? 'log' : level);
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

    function searchMatch(row) {
        const needle = getSearchNeedle();
        if (!needle) {
            return true;
        }
        return readErudaRowText(row).toLowerCase().includes(needle);
    }

    function shouldShowErudaRow(row) {
        const currentLevel = getCurrentLevel();
        const rowLevel = classifyErudaRow(row);
        if (currentLevel === 'warning') {
            return rowLevel === 'warning' && searchMatch(row);
        }
        if (currentLevel === 'error') {
            return rowLevel === 'error' && searchMatch(row);
        }
        if (currentLevel === 'info') {
            return rowLevel !== 'warning' && rowLevel !== 'error' && searchMatch(row);
        }
        return searchMatch(row);
    }

    function applyErudaDomFilter() {
        getErudaLogContainers().forEach((container) => {
            getErudaRows(container).forEach((row) => {
                const nextHidden = !shouldShowErudaRow(row);
                if (row.hidden !== nextHidden) {
                    row.hidden = nextHidden;
                }
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
        const nextText = resolveErudaBadge(row);
        const nextLevel = level;
        const nextClassName = `rav-console-badge is-${resolveEntryLevel(level === 'info' ? 'log' : level)}`;

        if (badge.textContent !== nextText) {
            badge.textContent = nextText;
        }
        if (badge.dataset.level !== nextLevel) {
            badge.dataset.level = nextLevel;
        }
        if (badge.className !== nextClassName) {
            badge.className = nextClassName;
        }
    }

    function reorderRowsNewestFirst(container) {
        getErudaRowGroups(container).forEach((rows) => {
            if (rows.length < 2) {
                return;
            }
            const orderedRows = rows
                .slice()
                .sort((left, right) => Number(right.dataset.ravSeq || 0) - Number(left.dataset.ravSeq || 0));
            if (!orderedRows.some((row, index) => row !== rows[index])) {
                return;
            }
            orderedRows.forEach((row) => row.parentElement?.appendChild(row));
        });
    }

    function disconnectErudaObserver() {
        state.erudaObserver?.disconnect?.();
    }

    function reconnectErudaObserver() {
        if (!state.erudaObserver) {
            return;
        }
        getErudaLogContainers().forEach((container) => {
            state.erudaObserver.observe(container, { childList: true, subtree: true });
        });
    }

    function refreshErudaPresentation() {
        if (!state.erudaReady || state.erudaPresentationSyncing) {
            return;
        }

        state.erudaPresentationSyncing = true;
        disconnectErudaObserver();
        try {
            getErudaLogContainers().forEach((container) => {
                const rows = getErudaRows(container);
                rows.forEach(ensureRowTimestamp);
                rows.forEach(ensureRowBadge);
                reorderRowsNewestFirst(container);
            });
            bindScrollContainer();
            applyErudaDomFilter();

            if (getFollowLatest()) {
                setTimeoutFn?.(() => scrollConsoleToLatest(), 0);
            }
        } finally {
            state.erudaPresentationSyncing = false;
            reconnectErudaObserver();
        }
    }

    function observeErudaLogs() {
        disconnectErudaObserver();
        const containers = getErudaLogContainers();
        if (!containers.length || typeof MutationObserverCtor !== 'function') {
            return;
        }

        state.erudaObserver = new MutationObserverCtor(() => {
            refreshErudaPresentation();
        });

        reconnectErudaObserver();
    }

    return {
        applyErudaDomFilter,
        classifyErudaRow,
        getErudaLogContainers,
        getErudaRows,
        observeErudaLogs,
        readErudaRowText,
        refreshErudaPresentation,
    };
}
