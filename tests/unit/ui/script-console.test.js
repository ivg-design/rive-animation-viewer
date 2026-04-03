import { getElements } from '../../../src/app/core/elements.js';
import { createScriptConsoleController } from '../../../src/app/ui/script-console.js';

function renderShell() {
    document.body.innerHTML = `
        <button id="toggle-script-console-btn"></button>
        <div id="event-log-panel">
            <div id="event-log-header"></div>
            <div id="event-log-filter-controls"></div>
            <div id="script-console-summary-right" hidden></div>
            <span id="event-log-title">EVENT CONSOLE</span>
            <span id="event-log-count">0</span>
            <div id="event-log-list"></div>
            <div id="script-console-view" hidden>
                <div id="script-console-output" style="height:140px; overflow:auto">
                    <div id="script-console-log-list"></div>
                </div>
                <input id="script-console-repl-input">
            </div>
        </div>
        <button id="script-console-filter-all"></button>
        <button id="script-console-filter-info"></button>
        <button id="script-console-filter-warning"></button>
        <button id="script-console-filter-error"></button>
        <input id="script-console-filter-search">
        <button id="script-console-follow-btn"></button>
        <button id="script-console-copy-btn"></button>
        <button id="script-console-clear-btn"></button>
    `;
    return getElements(document);
}

function createFakeEruda() {
    const logsSpace = document.createElement('div');
    logsSpace.className = 'luna-console-logs-space';
    logsSpace.scrollTop = 0;
    Object.defineProperty(logsSpace, 'clientHeight', {
        configurable: true,
        value: 100,
    });
    Object.defineProperty(logsSpace, 'scrollHeight', {
        configurable: true,
        get: () => 400,
    });

    const fakeLogs = document.createElement('div');
    fakeLogs.className = 'luna-console-fake-logs';

    const logs = document.createElement('div');
    logs.className = 'luna-console-logs';

    function appendLogRow(type, text) {
        function buildRow() {
            const row = document.createElement('div');
            row.className = 'luna-console-log-container';

            const item = document.createElement('div');
            item.className = `luna-console-${type} luna-console-log-item`;

            const content = document.createElement('div');
            content.className = 'luna-console-log-content';
            content.textContent = text;

            item.appendChild(content);
            row.appendChild(item);
            return row;
        }

        const visibleRow = buildRow();
        logs.appendChild(visibleRow);

        const fakeRow = buildRow();
        fakeLogs.appendChild(fakeRow);
    }

    function appendConsoleRow(type, args) {
        appendLogRow(type, args.join(' '));
    }

    function appendEvalRows(source) {
        appendLogRow('input', source);
        appendLogRow('output', `result:${source}`);
    }

    const tool = {
        _logger: {
            evaluate: vi.fn((source) => {
                appendEvalRows(source);
                return undefined;
            }),
            options: {},
            warn: vi.fn(),
        },
        clear: vi.fn(() => {
            logs.innerHTML = '';
            fakeLogs.innerHTML = '';
        }),
        config: {
            set: vi.fn(),
        },
        debug: vi.fn((...args) => appendConsoleRow('debug', args)),
        error: vi.fn((...args) => appendConsoleRow('error', args)),
        filter: vi.fn(),
        info: vi.fn((...args) => appendConsoleRow('info', args)),
        log: vi.fn((...args) => appendConsoleRow('log', args)),
        warn: vi.fn((...args) => appendConsoleRow('warn', args)),
    };

    const eruda = {
        destroy: vi.fn(),
        get: vi.fn(() => tool),
        init: vi.fn(({ container }) => {
            const erudaContainer = document.createElement('div');
            erudaContainer.className = 'eruda-container';

            const devTools = document.createElement('div');
            devTools.className = 'eruda-dev-tools';
            const consoleEl = document.createElement('div');
            consoleEl.className = 'eruda-console';
            const lunaConsole = document.createElement('div');
            lunaConsole.className = 'luna-console';

            logsSpace.appendChild(fakeLogs);
            logsSpace.appendChild(logs);
            lunaConsole.appendChild(logsSpace);
            consoleEl.appendChild(lunaConsole);
            devTools.appendChild(consoleEl);
            erudaContainer.appendChild(devTools);
            container.appendChild(erudaContainer);
        }),
        remove: vi.fn(),
        show: vi.fn(),
    };

    return { eruda, fakeLogs, logs, logsSpace, tool };
}

function immediateSetTimeout(callback) {
    callback();
    return 1;
}

describe('ui/script-console', () => {
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
        delete window.riveInst;
        delete window.eruda;
        document.body.className = '';
        document.body.innerHTML = '';
    });

    it('captures console output and restores console methods on destroy', () => {
        const elements = renderShell();
        const controller = createScriptConsoleController({
            elements,
            setTimeoutFn: immediateSetTimeout,
        });
        const originalLog = window.console.log;

        controller.installCapture();
        const wrappedLog = window.console.log;

        expect(wrappedLog).not.toBe(originalLog);
        console.log('alpha', 7);

        const captured = controller.readCaptured(5);
        expect(captured.total).toBe(1);
        expect(captured.entries[0].args).toEqual(['alpha', 7]);

        controller.destroy();
        expect(window.console.log).not.toBe(wrappedLog);
    });

    it('opens in javascript-console mode, executes code, and renders newest output at the top', async () => {
        const elements = renderShell();
        const renderEventLog = vi.fn();
        const { eruda, tool } = createFakeEruda();
        window.eruda = eruda;
        const controller = createScriptConsoleController({
            callbacks: {
                renderEventLog,
            },
            elements,
            setTimeoutFn: immediateSetTimeout,
        });

        controller.installCapture();
        controller.setup();

        await controller.open();
        console.info('mirrored output');
        await controller.exec('1 + 1');

        expect(document.body.classList.contains('js-console-mode')).toBe(true);
        expect(elements.eventLogTitle.textContent).toBe('JAVASCRIPT CONSOLE');
        expect(elements.scriptConsoleView.hidden).toBe(false);
        expect(elements.eventLogFilterControls.hidden).toBe(true);
        expect(tool._logger.evaluate).toHaveBeenCalledWith('1 + 1');
        expect(tool.info).toHaveBeenCalledWith('mirrored output');

        elements.toggleScriptConsoleButton.click();
        expect(controller.isOpen()).toBe(false);
        expect(elements.eventLogTitle.textContent).toBe('EVENT CONSOLE');
        expect(renderEventLog).toHaveBeenCalled();
    });

    it('applies filters, supports copy, clears output, and updates follow state on the live eruda scroller', async () => {
        const elements = renderShell();
        const { eruda, logs, tool } = createFakeEruda();
        window.eruda = eruda;
        const controller = createScriptConsoleController({
            elements,
            setTimeoutFn: immediateSetTimeout,
        });

        controller.installCapture();
        controller.setup();
        await controller.open();

        console.warn('needle warning');
        console.info('other info');
        await controller.exec('1 + 1');

        elements.scriptConsoleFilterWarning.click();
        let visibleRows = Array.from(logs.children).filter((row) => !row.hidden);
        expect(visibleRows).toHaveLength(1);
        expect(visibleRows[0].textContent).toContain('needle warning');

        elements.scriptConsoleFilterSearch.value = 'other';
        elements.scriptConsoleFilterSearch.dispatchEvent(new Event('input'));
        visibleRows = Array.from(logs.children).filter((row) => !row.hidden);
        expect(visibleRows).toHaveLength(0);

        elements.scriptConsoleFilterSearch.value = '';
        elements.scriptConsoleFilterSearch.dispatchEvent(new Event('input'));
        elements.scriptConsoleFilterAll.click();
        visibleRows = Array.from(logs.children).filter((row) => !row.hidden);
        expect(visibleRows.some((row) => row.textContent.includes('1 + 1'))).toBe(true);
        expect(visibleRows.some((row) => row.textContent.includes('other info'))).toBe(true);

        elements.scriptConsoleCopyButton.click();
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
        expect(navigator.clipboard.writeText.mock.calls.at(-1)[0]).toContain('LOG other info');
        expect(navigator.clipboard.writeText.mock.calls.at(-1)[0]).toContain('CMD 1 + 1');

        const scrollContainer = elements.scriptConsoleOutput.querySelector('.luna-console-logs-space');
        scrollContainer.scrollTop = 40;
        scrollContainer.dispatchEvent(new Event('scroll'));
        expect(controller.isFollowingLatest()).toBe(false);

        elements.scriptConsoleFollowButton.click();
        expect(controller.isFollowingLatest()).toBe(true);
        expect(scrollContainer.scrollTop).toBe(0);

        elements.scriptConsoleClearButton.click();
        expect(tool.clear).toHaveBeenCalled();
        expect(controller.readCaptured(10).total).toBe(0);
    });

    it('supports REPL history navigation and reports execution failures', async () => {
        const elements = renderShell();
        const execLogEvent = vi.fn();
        const { eruda, tool } = createFakeEruda();
        window.eruda = eruda;
        const controller = createScriptConsoleController({
            callbacks: { logEvent: execLogEvent },
            elements,
            setTimeoutFn: immediateSetTimeout,
        });

        controller.installCapture();
        controller.setup();
        await controller.open();

        const input = elements.scriptConsoleReplInput;
        input.value = 'const value = 5;';
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        await Promise.resolve();

        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
        expect(input.value).toBe('const value = 5;');

        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
        expect(input.value).toBe('');

        tool._logger.evaluate.mockImplementationOnce(() => {
            throw new Error('boom');
        });
        await expect(controller.exec('throw new Error("boom")')).resolves.toEqual({
            code: 'throw new Error("boom")',
            error: 'boom',
            ok: false,
        });
        expect(execLogEvent).toHaveBeenCalledWith('ui', 'console-exec-failed', 'boom');
    });

    it('delegates object inspection to eruda instead of emitting a summarized result row', async () => {
        const elements = renderShell();
        const { eruda, tool } = createFakeEruda();
        const fakeRiveInst = {
            artboard: { name: 'Cards' },
            stateMachineNames: ['Cards SM'],
            animationNames: ['idle'],
            isPlaying: true,
            isStopped: false,
            viewModelInstance: {},
        };
        window.riveInst = fakeRiveInst;
        const windowRef = {
            console: window.console,
            eruda,
            riveInst: fakeRiveInst,
        };
        const controller = createScriptConsoleController({
            elements,
            setTimeoutFn: immediateSetTimeout,
            windowRef,
        });

        controller.setup();
        await controller.open();
        await expect(controller.exec('riveInst')).resolves.toEqual({
            code: 'riveInst',
            ok: true,
        });
        expect(tool._logger.evaluate).toHaveBeenCalledWith('riveInst');
        expect(controller.readCaptured(5).entries[0].method).toBe('command');
    });

    it('prepends timestamps and keeps the newest eruda rows at the top', async () => {
        const elements = renderShell();
        const { eruda, logs } = createFakeEruda();
        const controller = createScriptConsoleController({
            elements,
            setTimeoutFn: immediateSetTimeout,
            windowRef: {
                ...window,
                console: window.console,
                eruda,
            },
        });

        controller.installCapture();
        controller.setup();
        await controller.open();

        console.info('first');
        console.info('second');
        await Promise.resolve();
        await Promise.resolve();

        const rows = Array.from(logs.children);
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('second');
        expect(rows[0].querySelector('.rav-console-time')).toBeTruthy();
        expect(rows[0].querySelector('.rav-console-badge')?.textContent).toBe('LOG');
        expect(rows[1].textContent).toContain('first');
        expect(rows[1].querySelector('.rav-console-time')).toBeTruthy();
        expect(rows[1].querySelector('.rav-console-badge')?.textContent).toBe('LOG');
    });

    it('normalizes command and result chrome with shared badges', async () => {
        const elements = renderShell();
        const { eruda, logs } = createFakeEruda();
        const controller = createScriptConsoleController({
            elements,
            setTimeoutFn: immediateSetTimeout,
            windowRef: {
                ...window,
                console: window.console,
                eruda,
            },
        });

        controller.setup();
        await controller.open();
        await controller.exec('riveInst');

        const rows = Array.from(logs.children);
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.rav-console-badge')?.textContent).toBe('RESULT');
        expect(rows[1].querySelector('.rav-console-badge')?.textContent).toBe('CMD');
    });
});
