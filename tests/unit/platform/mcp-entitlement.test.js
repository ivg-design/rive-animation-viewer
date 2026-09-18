import { createEntitlementCommands } from '../../../src/app/platform/mcp/commands/entitlement/commands.js';

function harness({ verify = async () => ({ subject: 'ivg', scope: ['inspection.full'], expires: 0 }), inspection = { artboards: [] } } = {}) {
    const calls = [];
    const windowRef = {
        __TAURI_INTERNALS__: { invoke: vi.fn(async (command, args) => {
            calls.push({ command, args });
            if (command === 'entitlement_machine_id') return 'abcdefghijklmnopqrstuvwxyz';
            if (command === 'entitlement_verify') return verify(args.request);
            throw new Error(`unexpected ${command}`);
        }) },
        _mcpGetFullInspection: vi.fn(async () => inspection),
    };
    return { commands: createEntitlementCommands({ windowRef }), calls, windowRef };
}

describe('unlisted entitlement commands', () => {
    it('reports the machine binding without a token and validity with one', async () => {
        const h = harness();
        expect(await h.commands.rav_entitlement_status({})).toEqual({ machine_id: 'abcdefghijklmnopqrstuvwxyz', unlocked: false });
        expect(await h.commands.rav_entitlement_status({ token: ' RAVK1.a.b ' })).toMatchObject({ unlocked: true, subject: 'ivg', scope: ['inspection.full'] });
        expect(h.calls.at(-1)).toEqual({ command: 'entitlement_verify', args: { request: { token: 'RAVK1.a.b', scope: undefined } } });
    });
    it('explains a rejected token instead of throwing from status', async () => {
        const h = harness({ verify: async () => { throw new Error('Entitlement key is bound to a different machine or account'); } });
        expect(await h.commands.rav_entitlement_status({ token: 'RAVK1.x.y' })).toMatchObject({ unlocked: false, reason: expect.stringContaining('different machine') });
    });
    it('returns the full inspection only for a key granting the scope', async () => {
        const h = harness({ inspection: { scripts: { assets: [{ name: 'main' }] } } });
        await expect(h.commands.rav_inspect_full({})).rejects.toThrow('token is required');
        const result = await h.commands.rav_inspect_full({ token: 'RAVK1.a.b' });
        expect(result).toEqual({ subject: 'ivg', inspection: { scripts: { assets: [{ name: 'main' }] } } });
        expect(h.calls.at(-1).args.request.scope).toBe('inspection.full');
        expect(h.windowRef._mcpGetFullInspection).toHaveBeenCalledOnce();
        const denied = harness({ verify: async () => { throw new Error('Entitlement key does not grant inspection.full'); } });
        await expect(denied.commands.rav_inspect_full({ token: 'RAVK1.a.b' })).rejects.toThrow('does not grant');
        expect(denied.windowRef._mcpGetFullInspection).not.toHaveBeenCalled();
    });
    it('is not advertised in any tool catalog', async () => {
        const { readFileSync } = await import('node:fs');
        for (const file of ['mcp-server/tools/core-tools.js', 'mcp-server/tools/media-tools.json', 'src-tauri/src/bin/rav-mcp/tool_registry.rs', 'README.md', 'mcp-server/README.md', 'web/src/app/docs/mcp/page.tsx']) {
            expect(readFileSync(file, 'utf8')).not.toMatch(/rav_inspect_full|rav_entitlement_status/);
        }
    });
});
