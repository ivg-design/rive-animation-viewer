import { createEventLogController } from '../../../src/app/ui/event-log.js';

function buildElements() {
    document.body.innerHTML = `
        <div id="center-panel"></div>
        <div id="event-log-panel"></div>
        <div id="event-log-header">
            <div class="event-log-summary-right"></div>
        </div>
        <button id="event-log-follow-btn"></button>
        <button id="event-filter-native"></button>
        <button id="event-filter-rive-user"></button>
        <button id="event-filter-ui"></button>
        <button id="event-filter-mcp"></button>
        <input id="event-filter-search" />
        <button id="event-log-copy-btn"></button>
        <button id="event-log-clear-btn"></button>
        <button id="show-event-log-btn"></button>
        <div id="event-log-count"></div>
        <div id="event-log-body" style="height:140px; overflow:auto">
            <div id="event-log-list"></div>
        </div>
    `;

    return {
        centerPanel: document.getElementById('center-panel'),
        eventLogPanel: document.getElementById('event-log-panel'),
        eventLogHeader: document.getElementById('event-log-header'),
        eventLogFollowButton: document.getElementById('event-log-follow-btn'),
        eventFilterNative: document.getElementById('event-filter-native'),
        eventFilterRiveUser: document.getElementById('event-filter-rive-user'),
        eventFilterUi: document.getElementById('event-filter-ui'),
        eventFilterMcp: document.getElementById('event-filter-mcp'),
        eventFilterSearch: document.getElementById('event-filter-search'),
        eventLogCopyButton: document.getElementById('event-log-copy-btn'),
        eventLogClearButton: document.getElementById('event-log-clear-btn'),
        showEventLogButton: document.getElementById('show-event-log-btn'),
        eventLogCount: document.getElementById('event-log-count'),
        eventLogBody: document.getElementById('event-log-body'),
        eventLogList: document.getElementById('event-log-list'),
    };
}

describe('ui/event-log', () => {
    let originalClipboard;

    beforeEach(() => {
        originalClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: originalClipboard,
        });
    });

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

    it('renders cyclic payloads without crashing the event log', () => {
        const controller = createEventLogController({
            elements: buildElements(),
            handleResize: vi.fn(),
        });

        controller.setupEventLog();
        const payload = { name: 'bridge-state' };
        payload.self = payload;
        expect(() => controller.logEvent('mcp', 'recv', 'Bridge payload', payload)).not.toThrow();
        expect(document.getElementById('event-log-list').textContent).toContain('Bridge payload');
        expect(document.getElementById('event-log-list').textContent).toContain('[Circular]');
    });

    it('filters, clears, and toggles collapse state', () => {
        const handleResize = vi.fn();
        const onCollapsedChange = vi.fn();
        const controller = createEventLogController({
            elements: buildElements(),
            handleResize,
            onCollapsedChange,
        });

        controller.setupEventLog();
        controller.logEvent('native', 'load', 'Native load');
        controller.logEvent('mcp', 'recv', 'MCP command');

        document.getElementById('event-filter-mcp').click();
        expect(document.getElementById('event-log-list').textContent).not.toContain('MCP command');

        document.getElementById('event-filter-search').value = 'native';
        document.getElementById('event-filter-search').dispatchEvent(new Event('input'));
        expect(document.getElementById('event-log-list').textContent).toContain('Native load');

        controller.setCollapsed(true);
        expect(controller.isCollapsed()).toBe(true);
        expect(handleResize).toHaveBeenCalled();
        expect(onCollapsedChange).toHaveBeenCalledWith(true);

        controller.setCollapsed(false);
        expect(controller.isCollapsed()).toBe(false);

        document.getElementById('event-filter-search').value = '';
        document.getElementById('event-filter-search').dispatchEvent(new Event('input'));
        document.getElementById('event-log-copy-btn').click();
        document.getElementById('event-log-clear-btn').click();
        expect(controller.getEntriesSnapshot()).toHaveLength(1);
        expect(document.getElementById('event-log-list').textContent).toContain('Event log cleared.');
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('turns follow off when scrolled away and back on when toggled', () => {
        const controller = createEventLogController({
            elements: buildElements(),
            handleResize: vi.fn(),
        });

        controller.setupEventLog();
        controller.logEvent('ui', 'ready', 'Viewer ready');
        const body = document.getElementById('event-log-body');
        body.scrollTop = 32;
        body.dispatchEvent(new Event('scroll'));
        expect(controller.isFollowingLatest()).toBe(false);

        document.getElementById('event-log-follow-btn').click();
        expect(controller.isFollowingLatest()).toBe(true);
    });
});
