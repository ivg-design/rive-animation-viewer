import { createArtboardSwitcherController } from '../../../src/app/rive/artboard-switcher.js';
import { createRiveStack } from '../../../src/app/bootstrap/stacks/rive-stack.js';
import { createDemoExportController } from '../../../src/app/platform/export/demo-export.js';

const scope = (sourceIdentity, sessionId, runtimeKey = 'webgl2@2.42.0') => ({ sourceIdentity, sessionId, runtimeKey });
const lowerThirdState = { sessionId: 'lower-third-session', artboard: 'LowerThird',
    playback: { name: 'LowerThirdsSM', type: 'stateMachine' }, vmInstance: { key: 'LowerThirdVM' } };

function harness() {
    const documentRef = document.implementation.createHTMLDocument('selection');
    let requestedScope = scope('lower-third-bytes', null);
    let canonicalScope = scope('lower-third-bytes', lowerThirdState.sessionId);
    const controller = createArtboardSwitcherController({ elements: {}, documentRef,
        getCurrentFileName: () => 'TrackMap.riv', getCurrentFileUrl: () => 'blob:trackmap',
        getCurrentSourceScope: () => requestedScope, getCanonicalSourceScope: () => canonicalScope,
        isAuthoritativeChildMode: () => true });
    controller.setupArtboardSwitcher();
    return { controller, documentRef,
        setRequested: (value) => { requestedScope = value; },
        setCanonical: (value) => { canonicalScope = value; },
        emit: (state) => documentRef.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state })),
    };
}
function selectTrackMap(controller) {
    controller.resetForNewFile();
    controller.syncStateFromConfig({ artboard: 'TrackMap', configuredStateMachines: ['TrackMapSM'] });
    controller.syncStateAfterLoad({ artboard: { name: 'TrackMap' } }, { stateMachines: 'TrackMapSM' });
}

describe('canonical artboard source authority', () => {
    it('keeps TrackMap export preparation stable while the old LowerThird child ticks', async () => {
        const f = harness();
        expect(f.controller.syncStateFromCanonical(lowerThirdState)).toBe(true);
        f.setRequested(null); // New bytes staged; independent inspection is not ready yet.
        f.controller.resetForNewFile();
        f.emit(lowerThirdState);
        expect(f.controller.getStateSnapshot().currentArtboard).toBeNull();
        f.setRequested(scope('trackmap-bytes', null));
        selectTrackMap(f.controller);
        const buffer = Uint8Array.from([1, 2, 3]).buffer;
        let scheduled = false;
        const exporter = createDemoExportController({
            getCurrentFileBuffer: () => buffer, getCurrentFileName: () => 'TrackMap.riv',
            getArtboardStateSnapshot: () => {
                const snapshot = f.controller.getStateSnapshot();
                if (!scheduled) { scheduled = true; Promise.resolve().then(() => f.emit(lowerThirdState)); }
                return snapshot;
            },
            getRuntimeAsset: () => ({ text: 'runtime();', version: '2.42.0' }),
            callbacks: { ensureRuntime: async () => { f.emit(lowerThirdState); } },
        });
        await expect(exporter.buildRenderSurfaceContext()).resolves.toMatchObject({ payload: {
            artboard_name: 'TrackMap', state_machines: ['TrackMapSM'], view_model_instance_name: null,
        } });
        expect(f.controller.getStateSnapshot()).toMatchObject({ currentArtboard: 'TrackMap',
            currentPlaybackName: 'TrackMapSM', currentVmInstanceName: null });
    });

    it.each([
        [scope('changed-bytes-same-path', null), scope('old-bytes-same-path', 'old')],
        [scope('same-file', null, 'canvas@2.42.0'), scope('same-file', 'old')],
        [scope('same-file', null), null],
    ])('rejects canonical selection from another or unverified source/runtime %#', (requested, canonical) => {
        const f = harness(); selectTrackMap(f.controller);
        f.setRequested(requested); f.setCanonical(canonical);
        expect(f.controller.syncStateFromCanonical({ ...lowerThirdState, sessionId: 'old' })).toBe(false);
        expect(f.controller.getStateSnapshot().currentArtboard).toBe('TrackMap');
    });

    it('accepts the newly published session, rejects retired-session ticks, and allows same-file target changes', () => {
        const f = harness(); selectTrackMap(f.controller);
        f.setRequested(scope('trackmap-bytes', null));
        f.setCanonical(scope('trackmap-bytes', 'new-session'));
        expect(f.controller.syncStateFromCanonical({ sessionId: 'new-session', artboard: 'TrackMap',
            playback: { type: 'animation', name: 'Intro' }, vmInstance: { key: 'Preview' } })).toBe(true);
        expect(f.controller.syncStateFromCanonical({ ...lowerThirdState })).toBe(false);
        expect(f.controller.getStateSnapshot()).toMatchObject({ currentPlaybackName: 'Intro', currentVmInstanceName: 'Preview' });
        // Canonical same-file reset/selection changes must still reach the UI.
        expect(f.controller.syncStateFromCanonical({ sessionId: 'new-session', artboard: 'TrackMapDetail',
            playback: { type: 'stateMachine', name: 'DetailSM' }, vmInstance: { key: null } })).toBe(true);
        expect(f.controller.getStateSnapshot().currentArtboard).toBe('TrackMapDetail');
    });

    it('restores the previous canonical selection when a file transaction rolls back', () => {
        const f = harness(); selectTrackMap(f.controller);
        f.setRequested(scope('trackmap-bytes', null));
        expect(f.controller.syncStateFromCanonical(lowerThirdState)).toBe(false);
        f.setRequested(scope('lower-third-bytes', null));
        expect(f.controller.syncStateFromCanonical(lowerThirdState)).toBe(true);
        expect(f.controller.getStateSnapshot()).toMatchObject({ currentArtboard: 'LowerThird', currentVmInstanceName: 'LowerThirdVM' });
    });

    it('retains the export guard for a real target change during preparation', async () => {
        const f = harness(); selectTrackMap(f.controller);
        const buffer = Uint8Array.from([1, 2, 3]).buffer;
        const exporter = createDemoExportController({ getCurrentFileBuffer: () => buffer,
            getCurrentFileName: () => 'TrackMap.riv', getArtboardStateSnapshot: f.controller.getStateSnapshot,
            getRuntimeAsset: () => ({ text: 'runtime();', version: '2.42.0' }),
            callbacks: { ensureRuntime: async () => f.controller.syncStateFromConfig({ artboard: 'UserSelectedOtherBoard' }) },
        });
        await expect(exporter.buildRenderSurfaceContext()).rejects.toThrow('Export source changed during preparation.');
    });

    it('wires source authority into the real Rive stack artboard controller', () => {
        const stack = createRiveStack({ elements: {}, callbacks: {
            isAuthoritativeChildMode: () => true, getRiveInstance: () => null,
            getCurrentSourceScope: () => scope('trackmap-bytes', null),
            getCanonicalSourceScope: () => scope('lower-third-bytes', lowerThirdState.sessionId),
        } });
        expect(stack.syncArtboardStateFromCanonical(lowerThirdState)).toBe(false);
        expect(stack.getArtboardStateSnapshot().currentArtboard).toBeNull();
        stack.vmControlsController.stopVmControlSync();
    });
});
