function formatTime(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '--:--:--.--';
    const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
    return `${time}.${String(Math.floor(date.getMilliseconds() / 10)).padStart(2, '0')}`;
}

function formatDetails(details) {
    if (!details || typeof details !== 'object' || !Object.keys(details).length) return '';
    try {
        return JSON.stringify(details);
    } catch {
        return '[unavailable details]';
    }
}

export function createOperationsDiagnosticsController({
    documentRef = globalThis.document,
    elements,
    getTauriEventListener = async () => null,
    getTauriInvoker = () => null,
    navigatorRef = globalThis.navigator,
    onOpenChange = () => {},
} = {}) {
    let entries = [];
    let enabled = false;
    let initialized = false;
    let open = false;
    let search = '';
    let unlisten = null;

    function visibleEntries() {
        if (!search) return entries;
        return entries.filter((entry) => (
            `${entry.event || ''} ${entry.build || ''} ${entry.pid || ''} ${formatDetails(entry.details)}`
                .toLowerCase()
                .includes(search)
        ));
    }

    function render() {
        const list = elements?.ravOperationsList;
        if (!list) return;
        const filtered = visibleEntries();
        if (elements.eventLogCount && open) elements.eventLogCount.textContent = String(filtered.length);
        list.replaceChildren();
        if (!filtered.length) {
            const empty = documentRef.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = enabled
                ? 'No RAV operations match the current search.'
                : 'RAV operational tracing is unavailable in this build.';
            list.append(empty);
            return;
        }
        filtered.forEach((entry) => {
            const row = documentRef.createElement('div');
            row.className = 'event-log-row rav-operation-row';
            const time = documentRef.createElement('span');
            time.className = 'event-row-time';
            time.textContent = formatTime(entry.timestamp);
            const source = documentRef.createElement('span');
            source.className = 'event-row-kind rav';
            source.textContent = 'RAV';
            const message = documentRef.createElement('span');
            message.className = 'event-row-message';
            const details = formatDetails(entry.details);
            message.textContent = [entry.event, `pid:${entry.pid}`, details].filter(Boolean).join(' • ');
            message.title = message.textContent;
            row.append(time, source, message);
            list.append(row);
        });
        if (open) {
            const container = elements.eventLogBody;
            if (container) container.scrollTop = container.scrollHeight;
        }
    }

    function syncUi() {
        elements?.eventLogPanel?.classList.toggle('rav-console-mode', open);
        if (elements?.ravOperationsSummaryRight) elements.ravOperationsSummaryRight.hidden = !open;
        if (elements?.ravOperationsView) elements.ravOperationsView.hidden = !open;
        if (elements?.eventLogList) elements.eventLogList.hidden = open;
        if (elements?.eventLogFilterControls) elements.eventLogFilterControls.hidden = open;
        if (open && elements?.scriptConsoleSummaryRight) elements.scriptConsoleSummaryRight.hidden = true;
        render();
    }

    async function refresh() {
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') return false;
        try {
            const snapshot = await invoke('get_rav_operational_trace');
            enabled = snapshot?.enabled === true;
            entries = Array.isArray(snapshot?.entries) ? snapshot.entries.slice() : [];
            if (elements?.ravOperationsTab) elements.ravOperationsTab.hidden = !enabled;
            render();
            return enabled;
        } catch {
            enabled = false;
            entries = [];
            if (elements?.ravOperationsTab) elements.ravOperationsTab.hidden = true;
            render();
            return false;
        }
    }

    async function setup() {
        if (initialized) return enabled;
        initialized = true;
        elements?.ravOperationsSearch?.addEventListener('input', () => {
            search = String(elements.ravOperationsSearch.value || '').trim().toLowerCase();
            render();
        });
        elements?.ravOperationsRefreshButton?.addEventListener('click', () => void refresh());
        elements?.ravOperationsCopyButton?.addEventListener('click', async () => {
            const text = visibleEntries().map((entry) => (
                `[${formatTime(entry.timestamp)}] RAV ${entry.event || ''} pid:${entry.pid || ''} ${formatDetails(entry.details)}`
            ).trim()).join('\n');
            if (text) {
                await Promise.resolve(navigatorRef?.clipboard?.writeText?.(text)).catch(() => {});
            }
        });
        elements?.ravOperationsClearButton?.addEventListener('click', async () => {
            const invoke = getTauriInvoker();
            if (typeof invoke !== 'function') return;
            try {
                await invoke('clear_rav_operational_trace');
                entries = [];
                render();
            } catch {
                // Keep the visible snapshot when persistence could not be cleared.
            }
        });
        const listen = await getTauriEventListener();
        if (typeof listen === 'function') {
            try {
                unlisten = await Promise.resolve(listen('rav-operational-trace-entry', (event) => {
                    const entry = event?.payload;
                    if (!entry || typeof entry !== 'object') return;
                    entries.push(entry);
                    if (entries.length > 1_000) entries.splice(0, entries.length - 1_000);
                    render();
                }));
            } catch {
                unlisten = null;
            }
        }
        return refresh();
    }

    async function show() {
        if (!initialized) await setup();
        if (!enabled) return false;
        open = true;
        syncUi();
        onOpenChange(true);
        return true;
    }

    function close() {
        if (!open) return;
        open = false;
        syncUi();
        onOpenChange(false);
    }

    function dispose() {
        close();
        unlisten?.();
        unlisten = null;
    }

    return {
        close,
        dispose,
        isEnabled: () => enabled,
        isOpen: () => open,
        refresh,
        setup,
        show,
    };
}
