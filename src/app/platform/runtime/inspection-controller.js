import { createInspectionService } from '../../rive/inspection/service.js';
import { createSourceScope } from '../../rive/inspection/source-scope.js';
import { createRenderSourceIdentityResolver } from '../export/render-source-identity.js';

export function createRuntimeInspectionController({ getCurrentFileBuffer, getCurrentFilePreferenceId,
    getCurrentRuntime, getCurrentRuntimeVersion, windowRef = globalThis.window } = {}) {
    const service = createInspectionService();
    const resolveIdentity = createRenderSourceIdentityResolver();
    const records = new WeakMap();
    let pendingAbort = null;
    const runtimeKey = () => `${getCurrentRuntime()}@${getCurrentRuntimeVersion()}`;
    const recordKey = () => JSON.stringify([getCurrentFilePreferenceId(), runtimeKey()]);

    function getMetadata() {
        const buffer = getCurrentFileBuffer();
        return buffer ? records.get(buffer)?.get(recordKey()) || null : null;
    }

    async function inspect(runtime) {
        pendingAbort?.abort();
        const abort = new AbortController();
        pendingAbort = abort;
        const buffer = getCurrentFileBuffer();
        const preferenceId = getCurrentFilePreferenceId();
        const key = runtimeKey();
        const capturedRecordKey = recordKey();
        const assertCurrent = () => {
            if (abort.signal.aborted || buffer !== getCurrentFileBuffer() || capturedRecordKey !== recordKey()) {
                throw new Error('Inspection source changed during loading.');
            }
        };
        try {
            const sourceIdentity = await resolveIdentity(buffer, preferenceId);
            assertCurrent();
            const metadata = await service.inspect({ buffer, sourceIdentity, runtimeKey: key, runtime, signal: abort.signal });
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
    return {
        inspect, getMetadata, dispose,
        getSourceScope(selection = {}, sessionId = null) {
            const metadata = getMetadata();
            return metadata ? createSourceScope({ ...metadata, sessionId,
                artboardKey: selection.currentArtboard, vmInstanceKey: selection.currentVmInstanceName }) : null;
        },
    };
}
