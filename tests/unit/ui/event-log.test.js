import { createEventLogController } from '../../../src/app/ui/event-log.js';

function buildElements() {
    document.body.innerHTML = `
        <div id="center-panel"></div>
        <div id="event-log-panel"></div>
        <div id="event-log-header">
            <div class="event-log-summary-right"></div>
        </div>
        <button id="event-filter-native"></button>
        <button id="event-filter-rive-user"></button>
        <button id="event-filter-ui"></button>
        <button id="event-filter-mcp"></button>
        <input id="event-filter-search" />
        <button id="event-log-clear-btn"></button>
        <button id="show-event-log-btn"></button>
        <div id="event-log-count"></div>
        <div id="event-log-list"></div>
    `;

    return {
        centerPanel: document.getElementById('center-panel'),
        eventLogPanel: document.getElementById('event-log-panel'),
        eventLogHeader: document.getElementById('event-log-header'),
        eventFilterNative: document.getElementById('event-filter-native'),
        eventFilterRiveUser: document.getElementById('event-filter-rive-user'),
        eventFilterUi: document.getElementById('event-filter-ui'),
        eventFilterMcp: document.getElementById('event-filter-mcp'),
        eventFilterSearch: document.getElementById('event-filter-search'),
        eventLogClearButton: document.getElementById('event-log-clear-btn'),
        showEventLogButton: document.getElementById('show-event-log-btn'),
        eventLogCount: document.getElementById('event-log-count'),
        eventLogList: document.getElementById('event-log-list'),
    };
}

describe('ui/event-log', () => {
    it('renders events and exposes snapshots', () => {
        const handleResize = vi.fn();
        const controller = createEventLogController({
            elements: buildElements(),
            handleResize,
        });

        controller.setupEventLog();
        controller.logEvent('ui', 'ready', 'Viewer ready');
        controller.logEvent('mcp', 'connected', 'Bridge connected', { port: 9274 });

        expect(controller.getEntriesSnapshot()).toHaveLength(2);
        expect(document.getElementById('event-log-count').textContent).toBe('2');
        expect(document.getElementById('event-log-list').textContent).toContain('Bridge connected');
    });

    it('filters, clears, and toggles collapse state', () => {
        const handleResize = vi.fn();
        const controller = createEventLogController({
            elements: buildElements(),
            handleResize,
        });

        controller.setupEventLog();
        controller.logEvent('native', 'load', 'Native load');
        controller.logEvent('mcp', 'recv', 'MCP command');

        document.getElementById('event-filter-mcp').click();
        expect(document.getElementById('event-log-list').textContent).not.toContain('MCP command');

        document.getElementById('event-filter-search').value = 'native';
        document.getElementById('event-filter-search').dispatchEvent(new Event('input'));
        expect(document.getElementById('event-log-list').textContent).toContain('Native load');

        document.getElementById('event-log-header').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('center-panel').classList.contains('event-log-collapsed')).toBe(true);
        expect(handleResize).toHaveBeenCalled();

        document.getElementById('event-filter-search').value = '';
        document.getElementById('event-filter-search').dispatchEvent(new Event('input'));
        document.getElementById('event-log-clear-btn').click();
        expect(controller.getEntriesSnapshot()).toHaveLength(1);
        expect(document.getElementById('event-log-list').textContent).toContain('Event log cleared.');
    });
});
