import { createEditorConsoleCommands } from '../../../src/app/platform/mcp/commands/editor-console.js';

describe('platform/mcp/editor-console', () => {
    it('drives fit and nine-way alignment through the same change events as the toolbar', async () => {
        document.body.innerHTML = `
            <select id="layout-select"><option value="contain">Contain</option><option value="cover">Cover</option></select>
            <select id="alignment-select"><option value="center">Center</option><option value="bottomRight">Bottom right</option></select>
        `;
        const fit = document.getElementById('layout-select');
        const alignment = document.getElementById('alignment-select');
        const fitChanges = vi.fn();
        const alignmentChanges = vi.fn();
        fit.addEventListener('change', fitChanges);
        alignment.addEventListener('change', alignmentChanges);
        const commands = createEditorConsoleCommands({ documentRef: document, windowRef: {} });

        await expect(commands.rav_set_layout({ fit: 'cover' })).resolves.toEqual({ ok: true, fit: 'cover' });
        await expect(commands.rav_set_alignment({ alignment: 'bottomRight' })).resolves.toEqual({ ok: true, alignment: 'bottomRight' });

        expect(fit.value).toBe('cover');
        expect(alignment.value).toBe('bottomRight');
        expect(fitChanges).toHaveBeenCalledOnce();
        expect(alignmentChanges).toHaveBeenCalledOnce();
    });

    it('returns the latest event entries in chronological order', async () => {
        const windowRef = {
            _mcpGetEventLog: () => [
                { source: 'ui', type: 'info', message: 'first' },
                { source: 'render', type: 'info', message: 'second' },
                { source: 'ui', type: 'info', message: 'third' },
            ],
        };
        const commands = createEditorConsoleCommands({ windowRef });

        await expect(commands.rav_get_event_log({ limit: 2 })).resolves.toEqual({
            total: 3,
            returned: 2,
            entries: [
                { source: 'render', type: 'info', message: 'second' },
                { source: 'ui', type: 'info', message: 'third' },
            ],
        });
    });

    it('filters before selecting the latest window and preserves total semantics', async () => {
        const windowRef = {
            _mcpGetEventLog: () => [
                { source: 'ui', type: 'info', message: 'first' },
                { source: 'render', type: 'info', message: 'second' },
                { source: 'ui', type: 'info', message: 'third' },
                { source: 'ui', type: 'info', message: 'fourth' },
            ],
        };
        const commands = createEditorConsoleCommands({ windowRef });

        await expect(commands.rav_get_event_log({ limit: 2, source: 'ui' })).resolves.toEqual({
            total: 4,
            returned: 2,
            entries: [
                { source: 'ui', type: 'info', message: 'third' },
                { source: 'ui', type: 'info', message: 'fourth' },
            ],
        });
    });

    it('returns no entries for a zero limit', async () => {
        const windowRef = {
            _mcpGetEventLog: () => [{ source: 'ui', type: 'info', message: 'first' }],
        };
        const commands = createEditorConsoleCommands({ windowRef });

        await expect(commands.rav_get_event_log({ limit: 0 })).resolves.toEqual({
            total: 1,
            returned: 0,
            entries: [],
        });
    });
});
