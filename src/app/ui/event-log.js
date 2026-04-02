const EVENT_LOG_LIMIT = 500;

export function createEventLogController({
    elements,
    handleResize,
    onCollapsedChange = () => {},
}) {
    const eventLogEntries = [];
    const eventFilterState = {
        native: true,
        riveUser: true,
        ui: true,
        mcp: true,
        search: '',
    };
    let eventLogSequence = 0;

    function syncFilterToggle(element, active) {
        element.classList.toggle('is-active', active);
        element.setAttribute('aria-pressed', String(active));
    }

    function setupEventLog() {
        const nativeToggle = elements.eventFilterNative;
        const riveUserToggle = elements.eventFilterRiveUser;
        const uiToggle = elements.eventFilterUi;
        const mcpToggle = elements.eventFilterMcp;
        const searchInput = elements.eventFilterSearch;
        const clearButton = elements.eventLogClearButton;
        if (!nativeToggle || !riveUserToggle || !uiToggle || !searchInput || !clearButton) {
            return;
        }

        syncFilterToggle(nativeToggle, eventFilterState.native);
        syncFilterToggle(riveUserToggle, eventFilterState.riveUser);
        syncFilterToggle(uiToggle, eventFilterState.ui);
        if (mcpToggle) syncFilterToggle(mcpToggle, eventFilterState.mcp);
        searchInput.value = '';

        nativeToggle.addEventListener('click', () => {
            eventFilterState.native = !eventFilterState.native;
            syncFilterToggle(nativeToggle, eventFilterState.native);
            renderEventLog();
        });
        riveUserToggle.addEventListener('click', () => {
            eventFilterState.riveUser = !eventFilterState.riveUser;
            syncFilterToggle(riveUserToggle, eventFilterState.riveUser);
            renderEventLog();
        });
        uiToggle.addEventListener('click', () => {
            eventFilterState.ui = !eventFilterState.ui;
            syncFilterToggle(uiToggle, eventFilterState.ui);
            renderEventLog();
        });
        if (mcpToggle) {
            mcpToggle.addEventListener('click', () => {
                eventFilterState.mcp = !eventFilterState.mcp;
                syncFilterToggle(mcpToggle, eventFilterState.mcp);
                renderEventLog();
            });
        }
        searchInput.addEventListener('input', () => {
            eventFilterState.search = searchInput.value.trim().toLowerCase();
            renderEventLog();
        });
        clearButton.addEventListener('click', () => {
            resetEventLog();
            logEvent('ui', 'log-cleared', 'Event log cleared.');
        });

        if (elements.showEventLogButton) {
            elements.showEventLogButton.hidden = true;
        }

        if (elements.eventLogHeader && elements.eventLogPanel && elements.centerPanel) {
            elements.eventLogHeader.addEventListener('click', (event) => {
                if (event.target.closest('.event-log-summary-right')) return;
                setCollapsed(!isCollapsed());
            });
        }
    }

    function isCollapsed() {
        return Boolean(
            elements.centerPanel?.classList.contains('event-log-collapsed')
            || elements.eventLogPanel?.classList.contains('collapsed'),
        );
    }

    function setCollapsed(collapsed) {
        const nextCollapsed = Boolean(collapsed);
        elements.centerPanel?.classList.toggle('event-log-collapsed', nextCollapsed);
        elements.eventLogPanel?.classList.toggle('collapsed', nextCollapsed);
        if (elements.showEventLogButton) {
            elements.showEventLogButton.hidden = !nextCollapsed;
        }
        handleResize();
        setTimeout(handleResize, 300);
        onCollapsedChange(nextCollapsed);
    }

    function resetEventLog() {
        eventLogEntries.length = 0;
        eventLogSequence = 0;
        renderEventLog();
    }

    function logEvent(source, type, message, payload) {
        eventLogEntries.unshift({
            id: ++eventLogSequence,
            source,
            type,
            message,
            payload,
            timestamp: Date.now(),
        });
        if (eventLogEntries.length > EVENT_LOG_LIMIT) {
            eventLogEntries.length = EVENT_LOG_LIMIT;
        }
        renderEventLog();
    }

    function renderEventLog() {
        const list = elements.eventLogList;
        const count = elements.eventLogCount;
        if (!list || !count) {
            return;
        }

        const filtered = eventLogEntries.filter((entry) => {
            if (entry.source === 'native' && !eventFilterState.native) return false;
            if (entry.source === 'rive-user' && !eventFilterState.riveUser) return false;
            if (entry.source === 'ui' && !eventFilterState.ui) return false;
            if (entry.source === 'mcp' && !eventFilterState.mcp) return false;
            if (eventFilterState.search) {
                const haystack = `${entry.source} ${entry.type} ${entry.message} ${entry.payload ? safeJson(entry.payload) : ''}`.toLowerCase();
                if (!haystack.includes(eventFilterState.search)) {
                    return false;
                }
            }
            return true;
        });

        count.textContent = String(filtered.length);
        list.innerHTML = '';
        if (!filtered.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No events match current filters.';
            list.appendChild(empty);
            return;
        }

        filtered.forEach((entry) => {
            const row = document.createElement('div');
            row.className = 'event-log-row';

            const time = document.createElement('span');
            time.className = 'event-row-time';
            time.textContent = formatEventTime(entry.timestamp);

            const source = document.createElement('span');
            source.className = `event-row-kind ${entry.source}`;
            source.textContent = entry.source === 'rive-user' ? 'USER' : entry.source.toUpperCase();

            const message = document.createElement('span');
            message.className = 'event-row-message';
            message.textContent = formatEventRowMessage(entry);
            message.title = message.textContent;

            row.appendChild(time);
            row.appendChild(source);
            row.appendChild(message);
            list.appendChild(row);
        });
    }

    function formatEventRowMessage(entry) {
        const parts = [];
        if (entry.type) parts.push(entry.type);
        if (entry.message && entry.message !== entry.type) parts.push(entry.message);
        if (entry.payload) {
            const payload = entry.payload;
            if (typeof payload === 'object' && payload !== null) {
                const keys = Object.keys(payload).filter((key) => key !== 'type' && key !== 'name');
                if (keys.length) {
                    const values = keys.map((key) => {
                        const value = payload[key];
                        if (typeof value === 'number') return `${key}: ${roundNum(value)}`;
                        if (typeof value === 'string') return `${key}: ${value}`;
                        return `${key}: ${JSON.stringify(value)}`;
                    });
                    parts.push(values.join('  '));
                }
            } else {
                parts.push(String(payload));
            }
        }
        return parts.join(' • ');
    }

    function roundNum(value) {
        if (Number.isInteger(value)) return String(value);
        return Number(value.toFixed(3)).toString();
    }

    function formatEventTime(timestamp) {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const centiseconds = String(Math.floor(date.getMilliseconds() / 10)).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}.${centiseconds}`;
    }

    function safeJson(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }

    function getEntriesSnapshot() {
        return eventLogEntries.slice();
    }

    function getFilterStateSnapshot() {
        return { ...eventFilterState };
    }

    return {
        getEntriesSnapshot,
        getFilterStateSnapshot,
        isCollapsed,
        logEvent,
        resetEventLog,
        renderEventLog,
        setCollapsed,
        setupEventLog,
    };
}
