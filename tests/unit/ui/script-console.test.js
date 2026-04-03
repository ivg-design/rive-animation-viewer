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

    it('opens in javascript-console mode, executes code, and renders newest output at the top', async () => {
        const elements = renderShell();
        const renderEventLog = vi.fn();
        const controller = createScriptConsoleController({
            callbacks: {
                renderEventLog,
            },
            elements,
        });

        controller.installCapture();
        controller.setup();

        elements.toggleScriptConsoleButton.click();
        console.info('mirrored output');
        await controller.exec('1 + 1');

        expect(document.body.classList.contains('js-console-mode')).toBe(true);
        expect(elements.eventLogTitle.textContent).toBe('JAVASCRIPT CONSOLE');
        expect(elements.scriptConsoleView.hidden).toBe(false);
        expect(elements.eventLogFilterControls.hidden).toBe(true);

        const firstRow = elements.scriptConsoleLogList.querySelector('.console-log-row');
        expect(firstRow?.textContent).toContain('RESULT');

        elements.toggleScriptConsoleButton.click();
        expect(controller.isOpen()).toBe(false);
        expect(elements.eventLogTitle.textContent).toBe('EVENT CONSOLE');
        expect(renderEventLog).toHaveBeenCalled();
    });

    it('applies filters, supports copy, clears output, and updates follow state on scroll', async () => {
        const elements = renderShell();
        const controller = createScriptConsoleController({ elements });

        controller.installCapture();
        controller.setup();
        await controller.open();

        console.warn('needle warning');
        console.info('other info');

        elements.scriptConsoleFilterWarning.click();
        expect(elements.scriptConsoleLogList.textContent).toContain('needle warning');
        expect(elements.scriptConsoleLogList.textContent).not.toContain('other info');

        elements.scriptConsoleFilterSearch.value = 'needle';
        elements.scriptConsoleFilterSearch.dispatchEvent(new Event('input'));
        expect(elements.scriptConsoleLogList.textContent).toContain('needle warning');

        elements.scriptConsoleCopyButton.click();
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalled();

        elements.scriptConsoleOutput.scrollTop = 40;
        elements.scriptConsoleOutput.dispatchEvent(new Event('scroll'));
        expect(controller.isFollowingLatest()).toBe(false);

        elements.scriptConsoleFollowButton.click();
        expect(controller.isFollowingLatest()).toBe(true);

        elements.scriptConsoleClearButton.click();
        expect(elements.scriptConsoleLogList.textContent).toContain('No console output matches current filters.');
    });

    it('supports REPL history navigation and reports execution failures', async () => {
        const elements = renderShell();
        const execLogEvent = vi.fn();
        const controller = createScriptConsoleController({
            callbacks: { logEvent: execLogEvent },
            elements,
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

        await expect(controller.exec('throw new Error("boom")')).resolves.toEqual({
            code: 'throw new Error("boom")',
            error: 'boom',
            ok: false,
        });
        expect(execLogEvent).toHaveBeenCalledWith('ui', 'console-exec-failed', 'boom');
    });
});
