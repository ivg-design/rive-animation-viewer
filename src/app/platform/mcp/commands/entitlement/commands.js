// Machine-bound entitlement commands. `rav_entitlement_status` is now
// advertised in tools/list so a client can always discover the unlock state
// and machine id; `rav_inspect_full` and `rav_analyze_full` are advertised
// only while the machine is unlocked, but all three remain dispatchable
// directly by exact name regardless of what tools/list currently reports.
import { getTauriInvoker } from '../../bridge-port.js';

const FULL_INSPECTION_SCOPE = 'inspection.full';
const DEFAULT_ANALYZER_FORMATS = ['html'];

// Best-effort stem for the analyzer's output filenames, derived from the
// loaded file's name (see rav_status's `file.name`, sourced the same way).
// Returns undefined when no file is loaded, letting the host fall back to
// its own default.
function deriveStem(windowRef) {
    const name = windowRef.__riveAnimationCache?.getName?.();
    if (typeof name !== 'string') return undefined;
    const base = (name.split('/').pop() || name).split('\\').pop() || name;
    const trimmed = base.trim();
    if (!trimmed) return undefined;
    const dot = trimmed.lastIndexOf('.');
    return dot > 0 ? trimmed.slice(0, dot) : trimmed;
}

export function createEntitlementCommands({ windowRef = globalThis.window } = {}) {
    async function invoke(command, request) {
        const fn = getTauriInvoker(windowRef);
        if (!fn) throw new Error('Entitlements are available only in desktop RAV.');
        return fn(command, request == null ? {} : { request });
    }
    function normalizeToken(token) {
        if (typeof token !== 'string') return undefined;
        const trimmed = token.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    // Verifies (and, on success, persists) a token against the host. Passing
    // no token tells the host to fall back to its stored key.
    async function verify(token, scope) {
        return invoke('entitlement_verify', { token: normalizeToken(token), scope });
    }
    return {
        // Without a token: report the persisted unlock state for this
        // machine. With a token: verify it, persist it on success (the
        // returned state carries `persisted: true`), and report the result;
        // on failure, `unlocked: false` with `reason` — the previously
        // stored state (if any) is left untouched.
        async rav_entitlement_status({ token } = {}) {
            if (token == null) return invoke('entitlement_status');
            const normalized = normalizeToken(token);
            const { machine_id } = await invoke('entitlement_status');
            if (!normalized) return { machine_id, unlocked: false, reason: 'token is required' };
            try {
                const entitlement = await verify(normalized);
                return {
                    machine_id,
                    unlocked: true,
                    subject: entitlement.subject,
                    scope: entitlement.scope,
                    expires: entitlement.expires,
                    persisted: true,
                };
            } catch (error) {
                return { machine_id, unlocked: false, reason: String(error?.message || error) };
            }
        },
        // Token is optional: when omitted, the host falls back to its stored
        // key. A supplied valid token is persisted too. The host rejects
        // with "No entitlement key is stored on this machine; pass token
        // once to unlock" when neither a token nor a stored key exists.
        async rav_inspect_full({ token } = {}) {
            const entitlement = await verify(token, FULL_INSPECTION_SCOPE);
            const inspection = await windowRef._mcpGetFullInspection?.();
            if (!inspection) throw new Error('Full inspection is unavailable.');
            return { subject: entitlement.subject, inspection };
        },
        // Same scope and token contract as rav_inspect_full. Renders the
        // current full inspection into one or more report files under
        // output_dir via the analyzer sidecar and returns the host's report.
        async rav_analyze_full({ token, formats, output_dir, title } = {}) {
            const entitlement = await verify(token, FULL_INSPECTION_SCOPE);
            const inspection = await windowRef._mcpGetFullInspection?.();
            if (!inspection) throw new Error('Full inspection is unavailable.');
            const report = await invoke('analyzer_run', {
                inspection,
                formats: Array.isArray(formats) && formats.length ? formats : DEFAULT_ANALYZER_FORMATS,
                output_dir,
                title,
                stem: deriveStem(windowRef),
            });
            return { subject: entitlement.subject, ...report };
        },
    };
}
