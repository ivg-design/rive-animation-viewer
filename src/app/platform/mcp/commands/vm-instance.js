import { getAuthoritativeRenderSurface } from '../authoritative.js';

export function createVmInstanceCommands({
    getRenderSurfaceController,
    renderSurfaceController,
    windowRef = globalThis.window,
} = {}) {
    return {
        async rav_switch_vm_instance({ instance }) {
            if (instance === null || typeof instance === 'undefined' || instance === '') {
                throw new Error('instance is required');
            }
            if (typeof windowRef._mcpSwitchVmInstance !== 'function') {
                throw new Error('ViewModel instance switcher not available');
            }
            const normalizedInstance = typeof instance === 'string' ? instance.trim() : instance;
            // Accept both the public MCP token ("auto") and the exact value
            // emitted by RAV's native <select>.  Treating the UI sentinel as
            // an authored key reloads the correct auto-bound child but then
            // falsely rejects its canonical null acknowledgement.
            const autoRequested = typeof normalizedInstance === 'string'
                && (normalizedInstance.toLowerCase() === 'auto'
                    || normalizedInstance === '__rav_auto_bound__');
            const expectedKey = autoRequested ? null : String(instance);
            await windowRef._mcpSwitchVmInstance(autoRequested ? '__rav_auto_bound__' : expectedKey);
            const authoritative = getAuthoritativeRenderSurface({
                getRenderSurfaceController,
                renderSurfaceController,
                windowRef,
            });
            const actualKey = authoritative?.controller?.getCanonicalState?.()?.vmInstance?.key;
            const applied = autoRequested
                ? actualKey === null || typeof actualKey === 'undefined'
                : actualKey !== null
                    && typeof actualKey !== 'undefined'
                    && String(actualKey) === expectedKey;
            return {
                applied,
                instanceKey: actualKey ?? null,
                status: applied ? 'applied' : 'rejected',
            };
        },
    };
}
