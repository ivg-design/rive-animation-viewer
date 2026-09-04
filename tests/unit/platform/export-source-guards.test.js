import { createDemoExportController } from '../../../src/app/platform/export/demo-export.js';
import { createRenderSourceIdentityResolver } from '../../../src/app/platform/export/render-source-identity.js';

const entries = [{ descriptor: { source: 'view-model', path: 'svg', kind: 'string' }, kind: 'string', value: 'A-svg' }];
async function harness() {
    let buffer = new Uint8Array([1, 2]).buffer;
    let name = 'A.riv'; let runtime = 'webgl2'; let selection = { currentArtboard: 'Main', currentVmInstanceName: 'VM' };
    const sourceIdentity = await createRenderSourceIdentityResolver()(buffer, name);
    let active = { sourceIdentity, runtimeKey: 'webgl2@2.42.0', artboardKey: 'Main', vmInstanceKey: 'VM', sessionId: 'A' };
    const callbacks = { ensureRuntime: vi.fn(async () => {}) };
    const controller = createDemoExportController({ callbacks,
        getCurrentFileName: () => name, getCurrentFileBuffer: () => buffer, getCurrentFilePreferenceId: () => name,
        getCurrentRuntime: () => runtime, getRuntimeAsset: () => ({ version: '2.42.0', text: 'runtime' }),
        getArtboardStateSnapshot: () => selection, getControlSnapshotScope: () => active,
        getInspectionMetadata: () => ({ sourceIdentity: active.sourceIdentity, artboards: [] }),
        captureVmControlSnapshot: () => entries, getSelectedControlKeys: () => ['vm:svg:string'] });
    return { controller, callbacks, setBuffer: (value) => { buffer = value; }, setName: (value) => { name = value; },
        setRuntime: (value) => { runtime = value; }, setSelection: (value) => { selection = value; },
        mutateBytes: () => { new Uint8Array(buffer)[0] = 8; }, setActive: (value) => { active = value; } };
}

describe('export snapshot source', () => {
    it('preserves controls for same-source renderer rebuilds', async () => {
        const f = await harness();
        expect(JSON.parse((await f.controller.buildRenderSurfaceContext()).payload.control_snapshot)).toEqual(entries);
    });
    it.each(['new-file', 'same-path-new-bytes', 'mutated-buffer', 'runtime', 'artboard', 'vm'])
    ('does not put A values into a %s context', async (change) => {
        const f = await harness();
        if (change === 'new-file') f.setName('B.riv');
        if (change === 'same-path-new-bytes') f.setBuffer(new Uint8Array([3, 4]).buffer);
        if (change === 'mutated-buffer') f.mutateBytes();
        if (change === 'runtime') f.setRuntime('canvas');
        if (change === 'artboard') f.setSelection({ currentArtboard: 'Other', currentVmInstanceName: 'VM' });
        if (change === 'vm') f.setSelection({ currentArtboard: 'Main', currentVmInstanceName: 'Other' });
        expect(JSON.parse((await f.controller.buildRenderSurfaceContext()).payload.control_snapshot)).toEqual([]);
    });
    it('rejects an async load superseded while runtime preparation is pending', async () => {
        const f = await harness();
        f.callbacks.ensureRuntime.mockImplementation(async () => { f.setName('B.riv'); });
        await expect(f.controller.buildRenderSurfaceContext()).rejects.toThrow('source changed');
    });
    it('rejects in-place byte changes during async export preparation', async () => {
        const f = await harness(); f.callbacks.ensureRuntime.mockImplementation(async () => { f.mutateBytes(); });
        await expect(f.controller.buildRenderSurfaceContext()).rejects.toThrow('bytes changed');
    });
    it('rejects superseded snippet setup before reading controls', async () => {
        const f = await harness(); f.callbacks.ensureRuntime.mockImplementation(async () => { f.setName('B.riv'); });
        await expect(f.controller.generateWebInstantiationCode()).rejects.toThrow('Snippet source changed');
    });
});
