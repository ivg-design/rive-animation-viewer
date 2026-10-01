import { readFileSync } from 'node:fs';
import { prepareRuntimeWasm } from '../../../src/app/platform/export/runtime-wasm.js';
import { createDemoExportController } from '../../../src/app/platform/export/demo-export.js';

const wasm = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]).buffer;
const wasmBase64 = 'AGFzbQEAAAA=';
const response = (buffer = wasm) => ({ ok: true, clone: () => ({ arrayBuffer: async () => buffer }) });

it.each(['canvas', 'webgl2'])('embeds WASM from the concrete %s JS version and shares export downloads', async (renderer) => {
    const fetchImpl = vi.fn(async () => response());
    const asset = { version: '2.42.0' };
    const values = await Promise.all([0, 1].map(() => prepareRuntimeWasm(renderer, asset, { fetchImpl, cachesRef: undefined })));
    expect(values).toEqual([wasmBase64, wasmBase64]);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`https://cdn.jsdelivr.net/npm/@rive-app/${renderer}@2.42.0/rive.wasm`, { cache: 'no-store' });
});

it('reuses the verified persistent cache while offline', async () => {
    const fetchImpl = vi.fn(() => { throw new Error('offline'); });
    const cache = { match: vi.fn(async () => response()), put: vi.fn() };
    await expect(prepareRuntimeWasm('webgl2', { version: '2.42.0' }, {
        fetchImpl, cachesRef: { open: async () => cache },
    })).resolves.toBe(wasmBase64);
    expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects unavailable/corrupt WASM and permits retry after a failed preparation', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce(response(new TextEncoder().encode('<html>error</html>').buffer))
        .mockResolvedValueOnce(response());
    const asset = { version: '2.42.0' };
    await expect(prepareRuntimeWasm('canvas', asset, { fetchImpl, cachesRef: undefined })).rejects.toThrow('503');
    await expect(prepareRuntimeWasm('canvas', asset, { fetchImpl, cachesRef: undefined })).rejects.toThrow('invalid');
    await expect(prepareRuntimeWasm('canvas', asset, { fetchImpl, cachesRef: undefined })).resolves.toBe(wasmBase64);
    await expect(prepareRuntimeWasm('canvas', { version: 'latest' }, { fetchImpl })).rejects.toThrow('resolved');
});

function exportController(prepareRuntimeWasm) {
    let current = Uint8Array.of(1).buffer;
    const invoke = vi.fn();
    return {
        invoke, replace: () => { current = Uint8Array.of(2).buffer; },
        controller: createDemoExportController({
            prepareRuntimeWasm,
            callbacks: { getTauriInvoker: () => invoke },
            getCurrentFileBuffer: () => current,
            getCurrentFileName: () => 'offline.riv',
            getRuntimeAsset: () => ({ text: 'runtime', version: '2.42.0' }),
        }),
    };
}

it('does not save an incomplete export when embedding fails', async () => {
    const h = exportController(async () => { throw new Error('WASM unavailable'); });
    await expect(h.controller.exportDemoToPath('/tmp/offline.html')).rejects.toThrow('WASM unavailable');
    expect(h.invoke).not.toHaveBeenCalled();
});

it('rejects a source change during WASM download but keeps live renderer preparation independent', async () => {
    let done;
    const prepare = vi.fn(() => new Promise(resolve => { done = resolve; }));
    const h = exportController(prepare);
    const pending = h.controller.exportDemoToPath('/tmp/offline.html');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    h.replace(); done(wasmBase64);
    await expect(pending).rejects.toThrow('source changed');
    expect(h.invoke).not.toHaveBeenCalled();
    prepare.mockClear();
    const live = await h.controller.buildRenderSurfaceContext();
    expect(live.payload.runtime_wasm_base64).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
});

it.each([true, false])('configures embedded bytes before playback with modern binary API=%s', (modern) => {
    const source = readFileSync('src-tauri/src/demo-template/js/core/load/embedded-runtime.js', 'utf8');
    const loader = { setWasmUrl: vi.fn(), setWasmFallbackUrl: vi.fn(), ...(modern ? { setWasmBinary: vi.fn() } : {}) };
    new Function('window', 'CONFIG', source)({ rive: { RuntimeLoader: loader } }, { runtimeWasmBase64: wasmBase64 });
    expect(loader.setWasmFallbackUrl).toHaveBeenCalledWith(null);
    if (modern) expect(new Uint8Array(loader.setWasmBinary.mock.calls[0][0])).toEqual(new Uint8Array(wasm));
    else expect(loader.setWasmUrl).toHaveBeenCalledWith(`data:application/wasm;base64,${wasmBase64}`);
});
