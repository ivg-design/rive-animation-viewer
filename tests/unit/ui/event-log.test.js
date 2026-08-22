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

    it('renders events in natural order and exposes snapshots', () => {
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
        const rows = Array.from(document.querySelectorAll('#event-log-list .event-log-row'));
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('Viewer ready');
        expect(rows[1].textContent).toContain('Bridge connected');
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

    it('retains and filters entries without building row DOM while collapsed', () => {
        const controller = createEventLogController({
            elements: buildElements(),
            handleResize: vi.fn(),
        });

        controller.setupEventLog();
        controller.logEvent('native', 'load', 'Native load');
        controller.setCollapsed(true);
        controller.logEvent('mcp', 'recv', 'MCP command');

        expect(controller.getEntriesSnapshot()).toHaveLength(2);
        expect(document.getElementById('event-log-count').textContent).toBe('2');
        expect(document.getElementById('event-log-list').childElementCount).toBe(0);

        document.getElementById('event-filter-mcp').click();
        expect(document.getElementById('event-log-count').textContent).toBe('1');
        expect(document.getElementById('event-log-list').childElementCount).toBe(0);

        controller.setCollapsed(false);
        const rows = document.querySelectorAll('#event-log-list .event-log-row');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('Native load');
        expect(document.getElementById('event-log-list').textContent).not.toContain('MCP command');
    });

    it('keeps the hidden events view DOM-free until it becomes visible again', () => {
        const elements = buildElements();
        const controller = createEventLogController({
            elements,
            handleResize: vi.fn(),
        });

        controller.setupEventLog();
        controller.logEvent('ui', 'ready', 'Viewer ready');
        expect(elements.eventLogList.querySelectorAll('.event-log-row')).toHaveLength(1);

        elements.eventLogList.hidden = true;
        elements.eventLogPanel.classList.add('script-console-mode');
        controller.renderEventLog();
        controller.logEvent('ui', 'next', 'Buffered behind script console');

        expect(controller.getEntriesSnapshot()).toHaveLength(2);
        expect(elements.eventLogCount.textContent).toBe('2');
        expect(elements.eventLogList.childElementCount).toBe(0);

        elements.eventLogList.hidden = false;
        elements.eventLogPanel.classList.remove('script-console-mode');
        controller.renderEventLog();
        expect(elements.eventLogList.querySelectorAll('.event-log-row')).toHaveLength(2);
        expect(elements.eventLogList.textContent).toContain('Buffered behind script console');
    });

    it('resets retained entries without creating collapsed DOM and follows on reopen', () => {
        const elements = buildElements();
        const controller = createEventLogController({
            elements,
            handleResize: vi.fn(),
        });

        controller.setupEventLog();
        const body = elements.eventLogBody;
        Object.defineProperty(body, 'clientHeight', { configurable: true, value: 140 });
        Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 440 });
        controller.setCollapsed(true);
        controller.logEvent('ui', 'ready', 'Viewer ready');
        body.scrollTop = 17;
        controller.resetEventLog();
        controller.logEvent('ui', 'next', 'Latest retained entry');

        expect(controller.getEntriesSnapshot()).toHaveLength(1);
        expect(elements.eventLogCount.textContent).toBe('1');
        expect(elements.eventLogList.childElementCount).toBe(0);
        expect(body.scrollTop).toBe(17);

        controller.setCollapsed(false);
        expect(elements.eventLogList.querySelectorAll('.event-log-row')).toHaveLength(1);
        expect(elements.eventLogList.textContent).toContain('Latest retained entry');
        expect(body.scrollTop).toBe(300);
    });

    it('turns follow off when scrolled away from the bottom and back on when toggled', () => {
        const controller = createEventLogController({
            elements: buildElements(),
            handleResize: vi.fn(),
        });

        controller.setupEventLog();
        const body = document.getElementById('event-log-body');
        Object.defineProperty(body, 'clientHeight', { configurable: true, value: 140 });
        let scrollHeight = 440;
        Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => scrollHeight });
        controller.logEvent('ui', 'ready', 'Viewer ready');
        controller.logEvent('ui', 'next', 'Another entry');
        body.scrollTop = 32;
        body.dispatchEvent(new Event('scroll'));
        expect(controller.isFollowingLatest()).toBe(false);

        document.getElementById('event-log-follow-btn').click();
        expect(controller.isFollowingLatest()).toBe(true);
        expect(body.scrollTop).toBe(scrollHeight - body.clientHeight);
    });
});
