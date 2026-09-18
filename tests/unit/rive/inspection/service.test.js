import { createInspectionService } from '../../../../src/app/rive/inspection/service.js';
import inspectionFixture from './fixtures/inspection-metadata.json' with { type: 'json' };
import { createRiveInstanceController } from '../../../../src/app/rive/instance-controller.js';
import { getInspectionMetadata } from '../../../../src/app/rive/runtime-compatibility.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function fixture({ fail = false, timing = true } = {}) {
    const result = structuredClone(timing ? inspectionFixture.timed : inspectionFixture.untimed);
    const parserClient = {
        dispose: vi.fn(),
        parse: fail ? vi.fn(async () => { throw new Error('parser failure'); }) : vi.fn(async () => result),
        reset: vi.fn(),
    };
    const buffer = Uint8Array.from([1, 2, 3]).buffer;
    const createParserClient = vi.fn(() => parserClient);
    return {
        buffer,
        createParserClient,
        parserClient,
        request: { buffer, filename: 'fixture.riv', sourceIdentity: 'file-A', runtimeKey: 'webgl2@2.42.0' },
    };
}

describe('file inspection service', () => {
    it('parses copied bytes once per file and reuses the result across playback runtimes', async () => {
        const f = fixture();
        const service = createInspectionService({ createParserClient: f.createParserClient });
        const metadata = await service.inspect(f.request);
        expect(f.parserClient.parse.mock.calls[0][0]).not.toBe(f.buffer);
        expect(new Uint8Array(f.parserClient.parse.mock.calls[0][0])).toEqual(new Uint8Array([1, 2, 3]));
        expect(f.parserClient.parse.mock.calls[0][1]).toMatchObject({ filename: 'fixture.riv' });
        expect(metadata.artboards[0].animations[0]).toMatchObject({ fps: 30, durationFrames: 90, durationSeconds: 3,
            workStartFrame: 15, workEndFrame: 60, workAreaEnabled: true });
        expect(metadata.artboards[0].stateMachines).toEqual([{ name: 'Machine' }]);
        expect(Object.isFrozen(metadata.artboards[0].stateMachines[0])).toBe(true);
        expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
        expect(await service.inspect(f.request)).toBe(metadata);
        const canvasMetadata = await service.inspect({ ...f.request, runtimeKey: 'canvas@2.42.0' });
        expect(canvasMetadata).not.toBe(metadata);
        expect(canvasMetadata.runtimeKey).toBe('canvas@2.42.0');
        expect(canvasMetadata.artboards).toBe(metadata.artboards);
        expect(f.parserClient.parse).toHaveBeenCalledTimes(1);
        await service.inspect({ ...f.request, sourceIdentity: 'file-B' });
        expect(f.parserClient.parse).toHaveBeenCalledTimes(2);
    });
    it('keeps unavailable timing explicitly unknown', async () => {
        const f = fixture({ timing: false });
        const result = await createInspectionService({ createParserClient: f.createParserClient }).inspect(f.request);
        expect(result.artboards[0].animations[0]).toMatchObject({ fps: null, durationFrames: null, durationSeconds: null });
    });
    it('does not cache parser failures', async () => {
        const f = fixture({ fail: true });
        const service = createInspectionService({ createParserClient: f.createParserClient });
        await expect(service.inspect(f.request)).rejects.toThrow('parser failure');
        expect(service.peek('file-A', 'webgl2@2.42.0')).toBeNull();
        await expect(service.inspect(f.request)).rejects.toThrow('parser failure');
        expect(f.parserClient.parse).toHaveBeenCalledTimes(2);
    });
    it.each(['abort', 'clear', 'dispose'])('rejects a late parser result after %s and never publishes metadata', async (mode) => {
        const f = fixture(); const load = deferred(); const abort = new AbortController();
        f.parserClient.parse.mockReturnValue(load.promise);
        const service = createInspectionService({ createParserClient: f.createParserClient });
        const pending = service.inspect({ ...f.request, signal: abort.signal });
        await Promise.resolve();
        if (mode === 'abort') abort.abort(); else service[mode]();
        load.resolve(structuredClone(inspectionFixture.timed));
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(service.peek('file-A', 'webgl2@2.42.0')).toBeNull();
        if (mode === 'clear') expect(f.parserClient.reset).toHaveBeenCalledOnce();
        if (mode === 'dispose') expect(f.parserClient.dispose).toHaveBeenCalledOnce();
    });
    it('shares pending inspection and bounds cached file results', async () => {
        const f = fixture(); const service = createInspectionService({
            createParserClient: f.createParserClient,
            maxEntries: 1,
        });
        const [a, b] = await Promise.all([service.inspect(f.request), service.inspect(f.request)]);
        expect(a).toBe(b); expect(f.parserClient.parse).toHaveBeenCalledTimes(1);
        await service.inspect({ ...f.request, sourceIdentity: 'file-B' });
        expect(service.peek('file-A', 'webgl2@2.42.0')).toBeNull();
    });
    it('never touches a selected Rive runtime or live player during inspection', async () => {
        const f = fixture();
        const forbidden = vi.fn(() => { throw new Error('selected runtime forbidden'); });
        const request = { ...f.request };
        Object.defineProperty(request, 'runtime', { get: forbidden });
        await createInspectionService({ createParserClient: f.createParserClient }).inspect(request);
        expect(forbidden).not.toHaveBeenCalled();
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
