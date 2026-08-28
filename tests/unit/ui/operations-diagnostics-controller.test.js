import { createOperationsDiagnosticsController } from '../../../src/app/ui/operations/diagnostics-controller.js';

function makeElements() {
    const tags = {
        eventLogPanel: 'div', eventLogCount: 'span', eventLogBody: 'div', eventLogList: 'div',
        eventLogFilterControls: 'div', scriptConsoleSummaryRight: 'div', ravOperationsSummaryRight: 'div',
        ravOperationsTab: 'button', ravOperationsSearch: 'input', ravOperationsRefreshButton: 'button',
        ravOperationsCopyButton: 'button', ravOperationsClearButton: 'button', ravOperationsView: 'div', ravOperationsList: 'div',
    };
    return Object.fromEntries(Object.entries(tags).map(([key, tag]) => [key, document.createElement(tag)]));
}

describe('ui/operations/diagnostics-controller', () => {
    it('loads, renders, filters, copies, and subscribes to persisted operations', async () => {
        const elements = makeElements();
        const writeText = vi.fn();
        let onEntry;
        const listen = vi.fn(async (_name, callback) => {
            onEntry = callback;
            return vi.fn();
        });
        const invoke = vi.fn(async (command) => command === 'get_rav_operational_trace'
            ? { enabled: true, entries: [{ timestamp: 0, event: 'surface-created', pid: 7, details: { session: 'a' } }] }
            : undefined);
        const controller = createOperationsDiagnosticsController({
            elements,
            getTauriEventListener: async () => listen,
            getTauriInvoker: () => invoke,
            navigatorRef: { clipboard: { writeText } },
        });

        await expect(controller.setup()).resolves.toBe(true);
        expect(elements.ravOperationsTab.hidden).toBe(false);
        expect(elements.ravOperationsList.textContent).toContain('surface-created');
        expect(elements.eventLogCount.textContent).toBe('');
        await expect(controller.show()).resolves.toBe(true);
        expect(elements.eventLogCount.textContent).toBe('1');
        expect(elements.ravOperationsView.hidden).toBe(false);

        elements.ravOperationsSearch.value = 'session';
        elements.ravOperationsSearch.dispatchEvent(new Event('input'));
        expect(elements.ravOperationsList.textContent).toContain('surface-created');
        elements.ravOperationsSearch.value = 'missing';
        elements.ravOperationsSearch.dispatchEvent(new Event('input'));
        expect(elements.ravOperationsList.querySelector('.empty-state').textContent).toContain('match');

        elements.ravOperationsSearch.value = '';
        elements.ravOperationsSearch.dispatchEvent(new Event('input'));
        elements.ravOperationsCopyButton.click();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('surface-created'));

        onEntry({ payload: { timestamp: 1, event: 'frame-presented', pid: 7 } });
        expect(elements.ravOperationsList.textContent).toContain('frame-presented');
        expect(listen).toHaveBeenCalledWith('rav-operational-trace-entry', expect.any(Function));
    });

    it('does not erase the visible snapshot when clear persistence fails', async () => {
        const elements = makeElements();
        const invoke = vi.fn(async (command) => {
            if (command === 'get_rav_operational_trace') return { enabled: true, entries: [{ timestamp: 0, event: 'keep-me', pid: 1 }] };
            throw new Error('disk unavailable');
        });
        const controller = createOperationsDiagnosticsController({ elements, getTauriInvoker: () => invoke });
        await controller.setup();
        await controller.show();
        elements.ravOperationsClearButton.click();
        await Promise.resolve();
        expect(elements.ravOperationsList.textContent).toContain('keep-me');
    });
});
