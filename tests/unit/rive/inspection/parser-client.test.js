import { createParserClient, INSPECTION_MODULE_MISSING } from '../../../../src/app/rive/inspection/parser-client.js';

describe('inspection parser loader', () => {
    it('delegates to the staged module once it is loaded', async () => {
        const inner = { parse: vi.fn(async () => ({ ok: true })), reset: vi.fn(), dispose: vi.fn() };
        const importModule = vi.fn(async () => ({ createParserClient: () => inner }));
        const client = createParserClient({ importModule, options: { workerUrl: 'x' } });
        client.reset(); // before load: nothing to reset, no throw
        await expect(client.parse(new ArrayBuffer(2), { filename: 'a.riv' })).resolves.toEqual({ ok: true });
        await client.parse(new ArrayBuffer(2), { filename: 'b.riv' });
        expect(importModule).toHaveBeenCalledOnce();
        expect(inner.parse).toHaveBeenCalledTimes(2);
        client.reset(); client.dispose();
        expect(inner.reset).toHaveBeenCalledOnce();
        expect(inner.dispose).toHaveBeenCalledOnce();
    });
    it('rejects every inspection with one clear error when the module is absent', async () => {
        const importModule = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
        const client = createParserClient({ importModule });
        await expect(client.parse(new ArrayBuffer(1), {})).rejects.toMatchObject({ name: 'InspectionUnavailableError', message: INSPECTION_MODULE_MISSING });
        await expect(client.parse(new ArrayBuffer(1), {})).rejects.toThrow(INSPECTION_MODULE_MISSING);
        expect(importModule).toHaveBeenCalledOnce();
        expect(() => { client.reset(); client.dispose(); }).not.toThrow();
    });
    it('treats a module without a client factory as absent', async () => {
        const client = createParserClient({ importModule: async () => ({}) });
        await expect(client.parse(new ArrayBuffer(1), {})).rejects.toThrow(INSPECTION_MODULE_MISSING);
    });
    it('disposes a client that finishes loading after dispose', async () => {
        const inner = { parse: vi.fn(async () => 1), dispose: vi.fn() };
        const client = createParserClient({ importModule: async () => ({ createParserClient: () => inner }) });
        const pending = client.parse(new ArrayBuffer(1), {});
        client.dispose();
        await pending;
        expect(inner.dispose).toHaveBeenCalledOnce();
    });
});
