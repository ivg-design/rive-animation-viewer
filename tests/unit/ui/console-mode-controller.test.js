import { createConsoleModeController } from '../../../src/app/ui/console/console-mode-controller.js';

describe('ui/console/console-mode-controller', () => {
    it('syncs chip state across closed, events, and js modes', async () => {
        const elements = {
            consoleModeChip: document.createElement('button'),
            consoleModeChipLabel: document.createElement('span'),
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
        expect(elements.consoleModeChipLabel.textContent).toBe('OPEN CONSOLE');

        await controller.setConsoleMode('events');
        expect(elements.consoleModeChipLabel.textContent).toBe('EVENTS');
        expect(eventLogController.collapsed).toBe(false);
        expect(scriptConsoleController.openState).toBe(false);

        await controller.setConsoleMode('js');
        expect(elements.consoleModeChipLabel.textContent).toBe('JS');
        expect(scriptConsoleController.openState).toBe(true);

        controller.handleEventLogCollapsedChange(true);
        expect(elements.consoleModeChipLabel.textContent).toBe('OPEN CONSOLE');
    });
});
