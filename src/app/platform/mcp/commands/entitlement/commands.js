// Unlisted commands. They are not advertised by tools/list and are documented
// nowhere public; a caller needs the exact name and a machine-bound key.
import { getTauriInvoker } from '../../bridge-port.js';

const FULL_INSPECTION_SCOPE = 'inspection.full';

export function createEntitlementCommands({ windowRef = globalThis.window } = {}) {
    async function invoke(command, request) {
        const fn = getTauriInvoker(windowRef);
        if (!fn) throw new Error('Entitlements are available only in desktop RAV.');
        return fn(command, request == null ? {} : { request });
    }
    async function verify(token, scope) {
        if (typeof token !== 'string' || !token.trim()) throw new Error('token is required');
        return invoke('entitlement_verify', { token: token.trim(), scope });
    }
    return {
        async rav_entitlement_status({ token } = {}) {
            const machine_id = await invoke('entitlement_machine_id');
            if (token == null) return { machine_id, unlocked: false };
            try {
                const entitlement = await verify(token);
                return { machine_id, unlocked: true, subject: entitlement.subject, scope: entitlement.scope, expires: entitlement.expires };
            } catch (error) {
                return { machine_id, unlocked: false, reason: String(error?.message || error) };
            }
        },
        async rav_inspect_full({ token } = {}) {
            const entitlement = await verify(token, FULL_INSPECTION_SCOPE);
            const inspection = await windowRef._mcpGetFullInspection?.();
            if (!inspection) throw new Error('Full inspection is unavailable.');
            return { subject: entitlement.subject, inspection };
        },
    };
}
