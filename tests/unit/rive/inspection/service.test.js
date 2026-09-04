import { createInspectionService } from '../../../../src/app/rive/inspection/service.js';
import { createRiveInstanceController } from '../../../../src/app/rive/instance-controller.js';
import { getInspectionMetadata } from '../../../../src/app/rive/runtime-compatibility.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function fixture({ fail = false, timing = true } = {}) {
    const order = [];
    const animation = { name: 'Intro', ...(timing ? { fps: 30, duration: 90, workStart: 15, workEnd: 60, enableWorkArea: true } : {}), delete: vi.fn() };
    const definition = { name: 'Machine', delete: vi.fn() };
    const artboard = { name: 'Main', animationCount: () => 1, animationByIndex: () => animation,
        stateMachineCount: () => 1, stateMachineByIndex: () => definition, delete: vi.fn(() => order.push('artboard')) };
    const file = { artboardCount: () => 1, artboardByIndex: () => artboard, delete: vi.fn(() => order.push('file')) };
    const machine = { inputCount: () => 1, input: () => { if (fail) throw new Error('input failure'); return { name: 'go', type: 58 }; },
        delete: vi.fn(() => order.push('machine')) };
    const runtime = { load: vi.fn(async () => file), StateMachineInstance: vi.fn(function () { return machine; }) };
    const buffer = Uint8Array.from([1, 2, 3]).buffer;
    return { animation, definition, artboard, file, machine, order, runtime, buffer,
        request: { buffer, sourceIdentity: 'file-A', runtimeKey: 'webgl2@2.42.0', runtime } };
}

describe('independent inspection', () => {
    it('loads copied bytes in an owned file, freezes plain metadata and caches per source/runtime', async () => {
        const f = fixture();
        const service = createInspectionService();
        const metadata = await service.inspect(f.request);
        expect(f.runtime.load.mock.calls[0][0].buffer).not.toBe(f.buffer);
        expect(f.runtime.load).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), undefined, false);
        expect(metadata.artboards[0].animations[0]).toMatchObject({ fps: 30, durationFrames: 90, durationSeconds: 3,
            workStartFrame: 15, workEndFrame: 60, workAreaEnabled: true });
        expect(metadata.artboards[0].stateMachines).toEqual([{ name: 'Machine', inputs: [{ name: 'go', type: 58 }] }]);
        expect(Object.isFrozen(metadata.artboards[0].stateMachines[0].inputs[0])).toBe(true);
        expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
        expect(await service.inspect(f.request)).toBe(metadata);
        expect(f.runtime.load).toHaveBeenCalledTimes(1);
        expect(f.order).toEqual(['machine', 'artboard', 'file']);
        expect(f.definition.delete).not.toHaveBeenCalled();
        expect(f.animation.delete).not.toHaveBeenCalled();
        await service.inspect({ ...f.request, runtimeKey: 'canvas@2.42.0' });
        await service.inspect({ ...f.request, sourceIdentity: 'file-B' });
        expect(f.runtime.load).toHaveBeenCalledTimes(3);
    });
    it('keeps unavailable timing explicitly unknown', async () => {
        const f = fixture({ timing: false });
        const result = await createInspectionService().inspect(f.request);
        expect(result.artboards[0].animations[0]).toMatchObject({ fps: null, durationFrames: null, durationSeconds: null });
    });
    it('disposes every owned object after traversal failure and does not cache it', async () => {
        const f = fixture({ fail: true });
        const service = createInspectionService();
        await expect(service.inspect(f.request)).rejects.toThrow('input failure');
        expect(f.order).toEqual(['machine', 'artboard', 'file']);
        expect(service.peek('file-A', 'webgl2@2.42.0')).toBeNull();
        await expect(service.inspect(f.request)).rejects.toThrow('input failure');
        expect(f.file.delete).toHaveBeenCalledTimes(2);
    });
    it.each(['abort', 'clear', 'dispose'])('cleans a late parsed file on %s and never publishes metadata', async (mode) => {
        const f = fixture(); const load = deferred(); const abort = new AbortController();
        f.runtime.load.mockReturnValue(load.promise);
        const service = createInspectionService();
        const pending = service.inspect({ ...f.request, signal: abort.signal });
        await Promise.resolve();
        if (mode === 'abort') abort.abort(); else service[mode]();
        load.resolve(f.file);
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(f.file.delete).toHaveBeenCalledOnce();
        expect(f.artboard.delete).not.toHaveBeenCalled();
        expect(service.peek('file-A', 'webgl2@2.42.0')).toBeNull();
    });
    it('shares pending inspection without retaining native objects and bounds cached results', async () => {
        const f = fixture(); const service = createInspectionService({ maxEntries: 1 });
        const [a, b] = await Promise.all([service.inspect(f.request), service.inspect(f.request)]);
        expect(a).toBe(b); expect(f.runtime.load).toHaveBeenCalledTimes(1);
        await service.inspect({ ...f.request, sourceIdentity: 'file-B' });
        expect(service.peek('file-A', 'webgl2@2.42.0')).toBeNull();
    });
    it('rejects unsupported runtimes without reading a live player or invoking a fallback', async () => {
        const f = fixture(); const contents = vi.fn(() => { throw new Error('live contents forbidden'); });
        const runtime = { Rive: vi.fn(), get contents() { return contents(); } };
        await expect(createInspectionService().inspect({ ...f.request, runtime })).rejects.toThrow('unavailable');
        expect(contents).not.toHaveBeenCalled(); expect(runtime.Rive).not.toHaveBeenCalled();
    });
    it('awaits inspection before player creation and binds metadata before user/UI callbacks', async () => {
        document.body.innerHTML = '<div id="canvas"></div>';
        const ready = deferred(); const metadata = { artboards: [{ name: 'Main' }] };
        const instance = { cleanup: vi.fn(), resizeDrawingSurfaceToCanvas: vi.fn(), on: vi.fn(), off: vi.fn() };
        const runtime = { Rive: vi.fn(function () { return instance; }), Layout: class {} };
        const observed = vi.fn(() => expect(getInspectionMetadata(instance)).toBe(metadata));
        const controller = createRiveInstanceController({
            callbacks: { ensureRuntime: async () => runtime, inspectFile: () => ready.promise,
                populateArtboardSwitcher: observed, renderVmInputControls: observed },
            elements: { canvasContainer: document.getElementById('canvas') },
            getEditorConfig: () => ({ animations: 'Intro', onLoad: observed }),
        });
        const loading = controller.loadRiveAnimation('blob:inspection', 'a.riv');
        await Promise.resolve(); expect(runtime.Rive).not.toHaveBeenCalled();
        ready.resolve(metadata); await loading;
        runtime.Rive.mock.calls[0][0].onLoad();
        expect(observed).toHaveBeenCalledTimes(3);
        controller.cleanupInstance();
    });
});
