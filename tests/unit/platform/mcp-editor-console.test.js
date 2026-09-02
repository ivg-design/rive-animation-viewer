import { createEditorConsoleCommands } from '../../../src/app/platform/mcp/commands/editor-console.js';

describe('platform/mcp/editor-console', () => {
    it('routes auto eval to the authoritative child and labels its exact session', async () => {
        const requestActiveCommand = vi.fn(async () => ({
            applied: true,
            result: { result: { id: 'child-runtime' } },
            status: 'applied',
        }));
        const controller = {
            getCanonicalState: () => ({ controlsHierarchy: { children: [] } }),
            getState: () => ({
                activeSessionId: 'surface-b',
                canAcceptCommands: true,
                isLoaded: true,
            }),
            requestActiveCommand,
            requestCommand: vi.fn(),
        };
        const commands = createEditorConsoleCommands({
            assertMcpScriptAccess: vi.fn(),
            renderSurfaceController: controller,
            windowRef: { riveInst: { id: 'host-runtime' } },
        });

        await expect(commands.rav_eval({ expression: 'window.riveInst' })).resolves.toEqual({
            requestedTarget: 'auto',
            result: { id: 'child-runtime' },
            sessionId: 'surface-b',
            surface: 'isolated-render-surface',
            target: 'playback',
        });
        expect(requestActiveCommand).toHaveBeenCalledWith('eval', { expression: 'window.riveInst' });
    });

    it('keeps explicit host eval diagnostic even while a child is authoritative', async () => {
        window.riveInst = { id: 'host-runtime' };
        const controller = {
            getCanonicalState: () => ({ controlsHierarchy: { children: [] } }),
            getState: () => ({ activeSessionId: 'surface-b', canAcceptCommands: true, isLoaded: true }),
            requestActiveCommand: vi.fn(),
            requestCommand: vi.fn(),
        };
        const commands = createEditorConsoleCommands({
            assertMcpScriptAccess: vi.fn(),
            renderSurfaceController: controller,
            windowRef: window,
        });

        await expect(commands.rav_eval({ expression: 'window.riveInst.id', target: 'host' })).resolves.toEqual({
            requestedTarget: 'host',
            result: 'host-runtime',
            sessionId: null,
            surface: 'host-webview',
            target: 'host',
        });
        expect(controller.requestActiveCommand).not.toHaveBeenCalled();
    });

    it('does not fall back to host when playback is required or loses authority', async () => {
        const hostMarker = vi.fn();
        window.hostMarker = hostMarker;
        const commandsWithoutChild = createEditorConsoleCommands({
            assertMcpScriptAccess: vi.fn(),
            windowRef: window,
        });
        await expect(commandsWithoutChild.rav_eval({
            expression: 'window.hostMarker()',
            target: 'playback',
        })).rejects.toThrow('No active authoritative playback surface is available');
        expect(hostMarker).not.toHaveBeenCalled();

        const controller = {
            getCanonicalState: () => ({ controlsHierarchy: { children: [] } }),
            getState: () => ({ activeSessionId: 'surface-b', canAcceptCommands: true, isLoaded: true }),
            requestActiveCommand: vi.fn(async () => ({ applied: false, status: 'unavailable' })),
            requestCommand: vi.fn(),
        };
        const commandsWithChild = createEditorConsoleCommands({
            assertMcpScriptAccess: vi.fn(),
            renderSurfaceController: controller,
            windowRef: window,
        });
        await expect(commandsWithChild.rav_eval({ expression: 'window.hostMarker()' }))
            .rejects.toThrow('Playback eval was not applied: unavailable');
        expect(hostMarker).not.toHaveBeenCalled();
    });

    it('checks Script Access before resolving target or touching a surface', async () => {
        const getRenderSurfaceController = vi.fn(() => {
            throw new Error('must not resolve');
        });
        const commands = createEditorConsoleCommands({
            assertMcpScriptAccess: () => { throw new Error('MCP script access is disabled'); },
            getRenderSurfaceController,
            windowRef: window,
        });

        await expect(commands.rav_eval({ expression: '1 + 1', target: 'playback' }))
            .rejects.toThrow('MCP script access is disabled');
        expect(getRenderSurfaceController).not.toHaveBeenCalled();
    });

    it('bounds host eval string previews', async () => {
        const commands = createEditorConsoleCommands({
            assertMcpScriptAccess: vi.fn(),
            windowRef: window,
        });
        const response = await commands.rav_eval({ expression: '"x".repeat(9000)', target: 'host' });

        expect(response.result.length).toBeLessThan(8300);
        expect(response.result).toContain('808 more characters');
    });

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

    it('awaits the packaged runtime transition bridge before acknowledging MCP', async () => {
        document.body.innerHTML = `
            <select id="runtime-select"><option value="webgl2">WebGL2</option><option value="canvas">Canvas</option></select>
        `;
        const setRuntime = vi.fn(async (runtime) => ({ changed: true, runtime }));
        const commands = createEditorConsoleCommands({
            documentRef: document,
            windowRef: { _mcpSetRuntime: setRuntime },
        });

        await expect(commands.rav_set_runtime({ runtime: 'canvas' })).resolves.toEqual({
            changed: true,
            ok: true,
            runtime: 'canvas',
        });
        expect(setRuntime).toHaveBeenCalledWith('canvas');
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
