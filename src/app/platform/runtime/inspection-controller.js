import { createInspectionService } from '../../rive/inspection/service.js';
import { createSourceScope } from '../../rive/inspection/source-scope.js';
import { createRenderSourceIdentityResolver } from '../export/render-source-identity.js';

export function createRuntimeInspectionController({ getCurrentFileBuffer, getCurrentFileName = () => '',
    getCurrentFilePreferenceId, getCurrentRuntime, getCurrentRuntimeVersion,
    windowRef = globalThis.window } = {}) {
    const service = createInspectionService();
    const resolveIdentity = createRenderSourceIdentityResolver();
    const identities = new WeakMap();
    const records = new WeakMap();
    let pendingAbort = null;
    const runtimeKey = () => `${getCurrentRuntime()}@${getCurrentRuntimeVersion()}`;
    const recordKey = () => JSON.stringify([getCurrentFilePreferenceId(), runtimeKey()]);

    function sourceIdentityFor(buffer, preferenceId) {
        let byPreference = identities.get(buffer);
        if (!byPreference) {
            byPreference = new Map();
            identities.set(buffer, byPreference);
        }
        if (!byPreference.has(preferenceId)) {
            const operation = resolveIdentity(buffer, preferenceId);
            byPreference.set(preferenceId, operation);
            operation.catch(() => {
                if (byPreference.get(preferenceId) === operation) byPreference.delete(preferenceId);
            });
        }
        return byPreference.get(preferenceId);
    }

    function getMetadata() {
        const buffer = getCurrentFileBuffer();
        return buffer ? records.get(buffer)?.get(recordKey()) || null : null;
    }

    async function inspect(_runtime) {
        pendingAbort?.abort();
        const abort = new AbortController();
        pendingAbort = abort;
        const buffer = getCurrentFileBuffer();
        const preferenceId = getCurrentFilePreferenceId();
        const filename = getCurrentFileName();
        const key = runtimeKey();
        const capturedRecordKey = recordKey();
        const assertCurrent = () => {
            if (abort.signal.aborted || buffer !== getCurrentFileBuffer() || capturedRecordKey !== recordKey()) {
                throw new Error('Inspection source changed during loading.');
            }
        };
        try {
            const sourceIdentity = await sourceIdentityFor(buffer, preferenceId);
            assertCurrent();
            const metadata = await service.inspect({
                buffer,
                filename,
                runtimeKey: key,
                signal: abort.signal,
                sourceIdentity,
            });
            assertCurrent();
            if (!records.has(buffer)) records.set(buffer, new Map());
            records.get(buffer).set(capturedRecordKey, metadata);
            return metadata;
        } finally { if (pendingAbort === abort) pendingAbort = null; }
    }

    function dispose() {
        pendingAbort?.abort();
        service.dispose();
        windowRef?.removeEventListener?.('beforeunload', dispose);
    }
    windowRef?.addEventListener?.('beforeunload', dispose, { once: true });
    async function getFullInspection() {
        const buffer = getCurrentFileBuffer();
        if (!buffer) throw new Error('No animation loaded');
        return service.inspectFull({ buffer, filename: getCurrentFileName() });
    }
    return {
        inspect, getMetadata, getFullInspection, dispose,
        getSourceScope(selection = {}, sessionId = null) {
            const metadata = getMetadata();
            return metadata ? createSourceScope({ ...metadata, sessionId,
                artboardKey: selection.currentArtboard, vmInstanceKey: selection.currentVmInstanceName }) : null;
        },
    };
}
