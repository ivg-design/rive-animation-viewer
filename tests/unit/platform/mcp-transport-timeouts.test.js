import { resolveCommandTimeoutMs, SLOW_COMMAND_TIMEOUTS_MS } from '../../../src/app/platform/mcp/transport.js';

describe('mcp transport command deadlines', () => {
    it('keeps the default deadline for ordinary commands', () => {
        expect(resolveCommandTimeoutMs('rav_status', 20_000)).toBe(20_000);
        expect(resolveCommandTimeoutMs('', 20_000)).toBe(20_000);
    });
    it('extends the deadline for full inspection and analysis', () => {
        expect(resolveCommandTimeoutMs('rav_inspect_full', 20_000)).toBe(SLOW_COMMAND_TIMEOUTS_MS.rav_inspect_full);
        expect(resolveCommandTimeoutMs('rav_analyze_full', 20_000)).toBe(180_000);
        expect(resolveCommandTimeoutMs('rav_open_file', 20_000)).toBe(60_000);
    });
    it('ignores invalid overrides', () => {
        expect(resolveCommandTimeoutMs('x', 20_000, { x: -1 })).toBe(20_000);
        expect(resolveCommandTimeoutMs('x', 20_000, null)).toBe(20_000);
    });
});
