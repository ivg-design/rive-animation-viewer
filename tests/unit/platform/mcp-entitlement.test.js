import { createEntitlementCommands } from '../../../src/app/platform/mcp/commands/entitlement/commands.js';

function harness({
    status = { machine_id: 'abcdefghijklmnopqrstuvwxyz', unlocked: false },
    verify = async () => ({ subject: 'ivg', scope: ['inspection.full'], expires: 0 }),
    inspection = { artboards: [] },
    analyze = async () => ({
        outputs: [{ format: 'html', path: '/tmp/out/rive-file.report.html', bytes: 100 }],
        summary: { rules_ran: 45, rules_skipped: 44, issues: { error: 0, warning: 1, review: 0, info: 0 }, health: 100 },
        summary_line: '45 rules ran, 44 skipped; issues: 0 error, 1 warning, 0 review, 0 info; health 100',
        duration_ms: 10,
    }),
    fileName,
} = {}) {
    const calls = [];
    const windowRef = {
        __TAURI_INTERNALS__: { invoke: vi.fn(async (command, args) => {
            calls.push({ command, args });
            if (command === 'entitlement_status') return status;
            if (command === 'entitlement_verify') return verify(args.request);
            if (command === 'analyzer_run') return analyze(args.request);
            throw new Error(`unexpected ${command}`);
        }) },
        _mcpGetFullInspection: vi.fn(async () => inspection),
        ...(fileName !== undefined ? { __riveAnimationCache: { getName: () => fileName } } : {}),
    };
    return { commands: createEntitlementCommands({ windowRef }), calls, windowRef };
}

describe('unlisted entitlement commands', () => {
    it('reports the stored machine state without a token, and persists/reports with one', async () => {
        const h = harness();
        expect(await h.commands.rav_entitlement_status({})).toEqual({ machine_id: 'abcdefghijklmnopqrstuvwxyz', unlocked: false });
        const result = await h.commands.rav_entitlement_status({ token: ' RAVK1.a.b ' });
        expect(result).toMatchObject({ unlocked: true, subject: 'ivg', scope: ['inspection.full'], persisted: true });
        expect(h.calls.at(-1)).toEqual({ command: 'entitlement_verify', args: { request: { token: 'RAVK1.a.b', scope: undefined } } });
    });

    it('explains a rejected token instead of throwing from status', async () => {
        const h = harness({ verify: async () => { throw new Error('Entitlement key is bound to a different machine or account'); } });
        expect(await h.commands.rav_entitlement_status({ token: 'RAVK1.x.y' })).toMatchObject({ unlocked: false, reason: expect.stringContaining('different machine') });
    });

    it('returns the full inspection only for a key granting the scope', async () => {
        const h = harness({ inspection: { scripts: { assets: [{ name: 'main' }] } } });
        const result = await h.commands.rav_inspect_full({ token: 'RAVK1.a.b' });
        expect(result).toEqual({ subject: 'ivg', inspection: { scripts: { assets: [{ name: 'main' }] } } });
        expect(h.calls.at(-1).args.request.scope).toBe('inspection.full');
        expect(h.windowRef._mcpGetFullInspection).toHaveBeenCalledOnce();
        const denied = harness({ verify: async () => { throw new Error('Entitlement key does not grant inspection.full'); } });
        await expect(denied.commands.rav_inspect_full({ token: 'RAVK1.a.b' })).rejects.toThrow('does not grant');
        expect(denied.windowRef._mcpGetFullInspection).not.toHaveBeenCalled();
        const locked = harness({ verify: async () => { throw new Error('No entitlement key is stored on this machine; pass token once to unlock'); } });
        await expect(locked.commands.rav_inspect_full({})).rejects.toThrow('pass token once to unlock');
    });

    it('documents the entitlement flow without exposing token material', async () => {
        const { readFileSync } = await import('node:fs');
        const readme = readFileSync('mcp-server/README.md', 'utf8');
        expect(readme).toMatch(/rav_entitlement_status/);
        expect(readme.toLowerCase()).toMatch(/activate once|stored for this machine/);
        const source = readFileSync('src/app/platform/mcp/commands/entitlement/commands.js', 'utf8');
        expect(source).not.toMatch(/RAVK1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    });

    it('reports an unlocked status without a token when the store already holds a key', async () => {
        const stored = { machine_id: 'abcdefghijklmnopqrstuvwxyz', unlocked: true, subject: 'ivg', scope: ['inspection.full'], expires: 0 };
        const h = harness({ status: stored });
        expect(await h.commands.rav_entitlement_status({})).toEqual(stored);
        expect(h.calls).toEqual([{ command: 'entitlement_status', args: {} }]);
    });

    it('inspects using a stored key when no token is passed', async () => {
        const h = harness();
        const result = await h.commands.rav_inspect_full({});
        expect(result).toEqual({ subject: 'ivg', inspection: { artboards: [] } });
        expect(h.calls.at(-1)).toEqual({ command: 'entitlement_verify', args: { request: { token: undefined, scope: 'inspection.full' } } });
    });

    it('reports an expired stored key as locked with a reason', async () => {
        const h = harness({ status: { machine_id: 'abcdefghijklmnopqrstuvwxyz', unlocked: false, reason: 'Entitlement key has expired' } });
        expect(await h.commands.rav_entitlement_status({})).toMatchObject({ unlocked: false, reason: expect.stringContaining('expired') });
    });

    it('analyzes the open file with default formats and no stem when no file name is exposed', async () => {
        const h = harness();
        const result = await h.commands.rav_analyze_full({ token: 'RAVK1.a.b', output_dir: '/tmp/out' });
        expect(result).toMatchObject({
            subject: 'ivg',
            summary_line: '45 rules ran, 44 skipped; issues: 0 error, 1 warning, 0 review, 0 info; health 100',
            outputs: [{ format: 'html', path: '/tmp/out/rive-file.report.html', bytes: 100 }],
        });
        expect(h.calls.at(-1)).toEqual({
            command: 'analyzer_run',
            args: { request: { inspection: { artboards: [] }, formats: ['html'], output_dir: '/tmp/out', title: undefined, stem: undefined } },
        });
    });

    it('derives a stem from the loaded file name and forwards explicit formats and title', async () => {
        const h = harness({ fileName: 'demo.riv' });
        await h.commands.rav_analyze_full({ formats: ['pdf', 'md'], output_dir: '/tmp/out', title: 'My Report' });
        expect(h.calls.at(-1).args.request).toEqual({
            inspection: { artboards: [] },
            formats: ['pdf', 'md'],
            output_dir: '/tmp/out',
            title: 'My Report',
            stem: 'demo',
        });
    });

    it('rejects when no file is loaded for analysis', async () => {
        const h = harness({ inspection: null });
        await expect(h.commands.rav_analyze_full({ output_dir: '/tmp/out' })).rejects.toThrow('Full inspection is unavailable.');
        expect(h.windowRef.__TAURI_INTERNALS__.invoke).not.toHaveBeenCalledWith('analyzer_run', expect.anything());
    });

    it('propagates a scope-denied error from analysis without calling the analyzer', async () => {
        const denied = harness({ verify: async () => { throw new Error('Entitlement key does not grant inspection.full'); } });
        await expect(denied.commands.rav_analyze_full({ output_dir: '/tmp/out' })).rejects.toThrow('does not grant');
        expect(denied.windowRef._mcpGetFullInspection).not.toHaveBeenCalled();
    });
});
