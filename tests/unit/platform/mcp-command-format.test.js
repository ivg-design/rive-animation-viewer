import { updateStatusIndicator } from '../../../src/app/platform/mcp/command-format.js';

describe('platform/mcp/command-format', () => {
    it('normalizes bridge transport state objects into chip states', () => {
        const update = vi.fn();
        const windowRef = { _mcpUpdateStatus: update };

        updateStatusIndicator({ enabled: true, connected: true }, windowRef);
        updateStatusIndicator({ enabled: true, connected: true, indicatorState: 'active' }, windowRef);
        updateStatusIndicator({ enabled: true, connected: false }, windowRef);
        updateStatusIndicator({ enabled: false, connected: false }, windowRef);
        updateStatusIndicator('connected', windowRef);

        expect(update.mock.calls).toEqual([
            ['idle'],
            ['active'],
            ['waiting'],
            ['off'],
            ['connected'],
        ]);
    });
});
