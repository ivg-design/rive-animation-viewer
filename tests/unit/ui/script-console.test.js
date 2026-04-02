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
                <div id="script-console-output"></div>
                <input id="script-console-repl-input">
            </div>
        </div>
        <button id="script-console-filter-all"></button>
        <button id="script-console-filter-info"></button>
        <button id="script-console-filter-warning"></button>
        <button id="script-console-filter-error"></button>
        <input id="script-console-filter-search">
        <button id="script-console-copy-btn"></button>
        <button id="script-console-clear-btn"></button>
    `;
    return getElements(document);
}

function installFakeEruda() {
    const consoleTool = {
        clear: vi.fn(),
        config: {
            set: vi.fn(),
        },
        debug: vi.fn(),
        dir: vi.fn(),
        error: vi.fn(),
        filter: vi.fn(),
        info: vi.fn(),
        log: vi.fn(),
        warn: vi.fn(),
        _logger: {
            evaluate: vi.fn(),
            options: {},
            warn: vi.fn(),
        },
    };

    window.eruda = {
        destroy: vi.fn(),
        get: vi.fn(() => consoleTool),
        init: vi.fn(({ container }) => {
            container.innerHTML = `
                <div class="eruda-container">
                    <div class="eruda-dev-tools">
                        <div class="eruda-console">
                            <div class="luna-console luna-console-theme-light">
                                <div class="luna-console-logs"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }),
        remove: vi.fn(),
        show: vi.fn(),
    };

    return consoleTool;
}

function immediateTimer(callback) {
    callback();
    return 0;
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
        document.querySelectorAll('script[data-src="/vendor/eruda.js"]').forEach((node) => node.remove());
        delete window.eruda;
        document.body.className = '';
        document.body.innerHTML = '';
    });

    it('captures console output and restores console methods on destroy', () => {
        const elements = renderShell();
        const controller = createScriptConsoleController({ elements });
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

    it('opens in javascript-console mode, mirrors logs into eruda, and executes code', async () => {
        const elements = renderShell();
        const consoleTool = installFakeEruda();
        const renderEventLog = vi.fn();
        const controller = createScriptConsoleController({
            callbacks: {
                renderEventLog,
            },
            elements,
            setTimeoutFn: immediateTimer,
        });

        controller.installCapture();
        controller.setup();

        elements.toggleScriptConsoleButton.click();
        await Promise.resolve();
        await Promise.resolve();
        console.info('mirrored output');

        expect(document.body.classList.contains('js-console-mode')).toBe(true);
        expect(elements.eventLogTitle.textContent).toBe('JAVASCRIPT CONSOLE');
        expect(elements.scriptConsoleView.hidden).toBe(false);
        expect(elements.eventLogFilterControls.hidden).toBe(true);
        expect(consoleTool.config.set).toHaveBeenCalledWith('overrideConsole', false);
        expect(consoleTool.info).toHaveBeenCalledWith('mirrored output');

        await expect(controller.exec('1 + 1')).resolves.toEqual({ ok: true, code: '1 + 1' });
        expect(consoleTool._logger.evaluate).toHaveBeenCalledWith('1 + 1');

        elements.toggleScriptConsoleButton.click();
        expect(controller.isOpen()).toBe(false);
        expect(elements.eventLogTitle.textContent).toBe('EVENT CONSOLE');
        expect(renderEventLog).toHaveBeenCalled();
    });

    it('applies filters, supports copy, and clears the eruda console', async () => {
        const elements = renderShell();
        const consoleTool = installFakeEruda();
        const controller = createScriptConsoleController({
            elements,
            setTimeoutFn: immediateTimer,
        });

        controller.installCapture();
        controller.setup();
        await controller.open();

        console.warn('needle warning');
        elements.scriptConsoleFilterWarning.click();
        expect(consoleTool.filter).toHaveBeenCalled();

        const warningFilter = consoleTool.filter.mock.calls.at(-1)[0];
        expect(warningFilter({ type: 'warn', text: 'needle warning' })).toBe(true);
        expect(warningFilter({ type: 'info', text: 'needle warning' })).toBe(false);

        elements.scriptConsoleFilterSearch.value = '';
        elements.scriptConsoleFilterAll.click();
        const showAllFilter = consoleTool.filter.mock.calls.at(-1)[0];
        expect(showAllFilter({ type: 'info', text: 'anything' })).toBe(true);

        elements.scriptConsoleCopyButton.click();
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalled();

        elements.scriptConsoleClearButton.click();
        expect(consoleTool.clear).toHaveBeenCalled();
    });

    it('loads eruda through the vendor script path and supports REPL history navigation', async () => {
        const elements = renderShell();
        const consoleTool = installFakeEruda();
        delete window.eruda;
        const controller = createScriptConsoleController({
            elements,
            setTimeoutFn: immediateTimer,
        });
        const appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            window.eruda = {
                destroy: vi.fn(),
                get: vi.fn(() => consoleTool),
                init: vi.fn(({ container }) => {
                    container.innerHTML = '<div class="eruda-container"><div class="luna-console luna-console-theme-light"><div class="luna-console-logs"></div></div></div>';
                }),
                remove: vi.fn(),
                show: vi.fn(),
            };
            node.dataset.loaded = 'true';
            node.onload();
            return node;
        });

        controller.installCapture();
        controller.setup();
        controller.setup();
        await controller.open();

        expect(appendChild).toHaveBeenCalledTimes(1);

        const input = elements.scriptConsoleReplInput;
        input.value = 'first()';
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        await Promise.resolve();
        expect(consoleTool._logger.evaluate).toHaveBeenCalledWith('first()');

        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
        expect(input.value).toBe('first()');

        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
        expect(input.value).toBe('');

        appendChild.mockRestore();
    });

    it('logs failures when the console cannot load or execute', async () => {
        const elements = renderShell();
        const execLogEvent = vi.fn();
        const controller = createScriptConsoleController({
            callbacks: { logEvent: execLogEvent },
            elements,
            setTimeoutFn: immediateTimer,
        });

        controller.setup();
        expect(await controller.exec('')).toEqual({ ok: false, error: 'code is required' });

        window.eruda = {
            destroy: vi.fn(),
            get: vi.fn(() => ({ _logger: {} })),
            init: vi.fn(({ container }) => {
                container.innerHTML = '<div class="eruda-container"><div class="luna-console"><div class="luna-console-logs"></div></div></div>';
            }),
            remove: vi.fn(),
            show: vi.fn(),
        };

        await expect(controller.exec('2 + 2')).resolves.toEqual({
            code: '2 + 2',
            error: 'Console evaluator is unavailable',
            ok: false,
        });
        expect(execLogEvent).toHaveBeenCalledWith('ui', 'console-exec-failed', 'Console evaluator is unavailable');

        controller.destroy();
        document.body.innerHTML = '';

        const failedElements = renderShell();
        const openLogEvent = vi.fn();
        const failedWindow = {
            console: window.console,
        };
        const failedController = createScriptConsoleController({
            callbacks: { logEvent: openLogEvent },
            elements: failedElements,
            setTimeoutFn: immediateTimer,
            windowRef: failedWindow,
        });
        const appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            node.onerror();
            return node;
        });

        failedController.setup();
        await failedController.open().catch((error) => {
            openLogEvent('ui', 'console-open-failed', error.message);
        });
        expect(appendChild).toHaveBeenCalledTimes(1);
        expect(openLogEvent).toHaveBeenCalledWith('ui', 'console-open-failed', 'Failed to load /vendor/eruda.js');
        appendChild.mockRestore();
    });
});
