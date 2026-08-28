import { createConsoleModeController } from '../../../src/app/ui/console/console-mode-controller.js';

describe('ui/console/console-mode-controller', () => {
    it('syncs chip state across closed, events, and js modes', async () => {
        const elements = {
            consoleModeChip: document.createElement('button'),
            consoleModeChipLabel: document.createElement('span'),
            eventConsoleTab: document.createElement('button'),
            scriptConsoleTab: document.createElement('button'),
            ravOperationsTab: document.createElement('button'),
        };
        const eventLogController = {
            collapsed: false,
            isCollapsed() {
                return this.collapsed;
            },
            setCollapsed(next) {
                this.collapsed = next;
            },
        };
        const scriptConsoleController = {
            openState: false,
            isOpen() {
                return this.openState;
            },
            async open() {
                this.openState = true;
            },
            close() {
                this.openState = false;
            },
        };

        const controller = createConsoleModeController({
            elements,
            eventLogController,
            scriptConsoleController,
        });

        await controller.setConsoleMode('closed');
        expect(elements.consoleModeChipLabel.textContent).toBe('OPEN');
        expect(elements.consoleModeChip.dataset.consoleMode).toBe('closed');

        await controller.setConsoleMode('events');
        expect(elements.consoleModeChipLabel.textContent).toBe('CLOSE');
        expect(elements.consoleModeChip.dataset.consoleMode).toBe('open');
        expect(eventLogController.collapsed).toBe(false);
        expect(scriptConsoleController.openState).toBe(false);

        await controller.setConsoleMode('js');
        expect(elements.consoleModeChipLabel.textContent).toBe('CLOSE');
        expect(scriptConsoleController.openState).toBe(true);
        expect(elements.scriptConsoleTab.classList.contains('is-active')).toBe(true);
        expect(elements.ravOperationsTab.classList.contains('is-active')).toBe(false);

        const operationsDiagnosticsController = {
            openState: false,
            isOpen() {
                return this.openState;
            },
            async show() {
                this.openState = true;
                return true;
            },
            close() {
                this.openState = false;
            },
        };
        const ravController = createConsoleModeController({
            elements,
            eventLogController,
            operationsDiagnosticsController,
            scriptConsoleController,
        });
        await ravController.activateRavMode();
        expect(operationsDiagnosticsController.openState).toBe(true);
        expect(scriptConsoleController.openState).toBe(false);
        expect(elements.ravOperationsTab.classList.contains('is-active')).toBe(true);
        expect(elements.ravOperationsTab.getAttribute('aria-pressed')).toBe('true');

        await ravController.setConsoleMode('closed');
        expect(operationsDiagnosticsController.openState).toBe(false);
        expect(elements.ravOperationsTab.classList.contains('is-active')).toBe(false);
    });

    it('reports unavailable RAV mode and restores the event view after a failed activation', async () => {
        const elements = {
            consoleModeChip: document.createElement('button'),
            consoleModeChipLabel: document.createElement('span'),
            eventConsoleTab: document.createElement('button'),
            ravOperationsTab: document.createElement('button'),
        };
        const eventLogController = {
            collapsed: true,
            isCollapsed() { return this.collapsed; },
            setCollapsed(next) { this.collapsed = next; },
        };
        const scriptConsoleController = {
            isOpen: () => false,
            close: vi.fn(),
        };
        const showError = vi.fn();
        const controller = createConsoleModeController({
            callbacks: { showError, logEvent: vi.fn() },
            elements,
            eventLogController,
            operationsDiagnosticsController: { show: vi.fn(async () => false), close: vi.fn(), isOpen: () => false },
            scriptConsoleController,
        });

        await expect(controller.activateRavMode()).rejects.toThrow('unavailable');
        expect(showError).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
        expect(elements.eventConsoleTab.classList.contains('is-active')).toBe(true);
        expect(elements.ravOperationsTab.classList.contains('is-active')).toBe(false);

        eventLogController.collapsed = true;
        controller.handleEventLogCollapsedChange(true);
        expect(elements.consoleModeChipLabel.textContent).toBe('OPEN');
    });
});
