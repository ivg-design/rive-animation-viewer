import { loadAuthoritativeRiveSurface } from '../../../src/app/rive/instances/authoritative-load.js';

function harness({ editorConfig = {}, overrides = null, detected = 'Main SM', activated = true, metadata = null, current = true } = {}) {
    const calls = { detect: [], fromConfig: [], afterLoad: [], populate: 0, activate: [] };
    const result = loadAuthoritativeRiveSurface({
        activateAuthoritativeSurface: async (options) => { calls.activate.push(options); return activated; },
        configOverrides: overrides,
        detectDefaultStateMachineName: async (runtime, options) => { calls.detect.push({ runtime, options }); return detected; },
        fileBuffer: new ArrayBuffer(2), fileName: 'demo.riv', fileUrl: 'blob:demo', forceAutoplay: false,
        getEditorConfig: () => editorConfig,
        inspectionMetadata: metadata ?? { artboards: [{ name: 'Intro' }, { name: 'Main', isDefault: true }] },
        isCurrentLoad: () => current,
        populateArtboardSwitcher: () => { calls.populate += 1; },
        runtimeAsset: { id: 'asset' }, runtimeVersion: '2.42.1',
        syncArtboardStateAfterLoad: (instance, config) => calls.afterLoad.push({ instance, config }),
        syncArtboardStateFromConfig: (state) => calls.fromConfig.push(state),
    });
    return { result, calls };
}

describe('authoritative desktop load', () => {
    it('seeds the default artboard from inspection, detects a state machine, and activates with autoplay', async () => {
        const h = harness();
        await expect(h.result).resolves.toMatchObject({ fileName: 'demo.riv', config: { artboard: 'Main', autoplay: true } });
        expect(h.calls.detect[0].options).toMatchObject({ artboardName: 'Main', fileUrl: 'blob:demo' });
        expect(h.calls.fromConfig[0]).toMatchObject({ artboard: 'Main', configuredStateMachines: ['Main SM'], hasConfiguredAnimation: false });
        expect(h.calls.afterLoad[0].instance).toBeNull();
        expect(h.calls.populate).toBe(1);
        expect(h.calls.activate).toEqual([{ autoplay: true }]);
    });
    it('honours explicit selection overrides, drops the conflicting editor selection, and does not detect', async () => {
        const h = harness({ editorConfig: { stateMachine: 'Editor SM', autoplay: false }, overrides: { animations: ['idle'], autoplay: true } });
        const value = await h.result;
        expect(value.config.stateMachine).toBeUndefined();
        expect(value.config.stateMachines).toBeUndefined();
        expect(h.calls.detect).toEqual([]);
        expect(h.calls.fromConfig[0]).toMatchObject({ animations: ['idle'], hasConfiguredAnimation: true });
        expect(h.calls.activate).toEqual([{ autoplay: true }]);
    });
    it('keeps a paused editor config paused and returns false when the load was superseded', async () => {
        const paused = harness({ editorConfig: { autoplay: false } });
        await paused.result;
        expect(paused.calls.activate).toEqual([{ autoplay: false }]);
        const stale = harness({ current: false });
        await expect(stale.result).resolves.toBe(false);
        expect(stale.calls.activate).toEqual([]);
    });
    it('fails when the playback surface does not activate', async () => {
        await expect(harness({ activated: false }).result).rejects.toThrow('did not complete activation');
    });
});
