import { RUNTIME_CACHE_NAME, RUNTIME_PACKAGE_NAMES, parseSemverParts } from '../../core/constants.js';
import { arrayBufferToBase64 } from './demo-payload.js';

const pendingAssets = new WeakMap();

// Download at export time, using the concrete version of the embedded JS.
// Neither the saved file nor its runtime bootstrap needs a CDN afterward.
export async function prepareRuntimeWasm(runtimeName, asset, {
    fetchImpl = globalThis.fetch?.bind(globalThis),
    cachesRef = globalThis.caches,
} = {}) {
    const packageName = RUNTIME_PACKAGE_NAMES[runtimeName];
    if (!packageName || !asset || !parseSemverParts(asset.version)) {
        throw new Error('Offline export requires a resolved Rive runtime version.');
    }
    if (pendingAssets.has(asset)) return pendingAssets.get(asset);
    const promise = (async () => {
        const url = `https://cdn.jsdelivr.net/npm/${packageName}@${asset.version}/rive.wasm`;
        let cache = null;
        try { cache = await cachesRef?.open(RUNTIME_CACHE_NAME); } catch { /* cache is optional */ }
        let response = await cache?.match(url);
        if (!response) {
            response = await fetchImpl(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`Could not embed the Rive WASM runtime (${response.status}).`);
        }
        const buffer = await response.clone().arrayBuffer();
        if (!WebAssembly.validate(buffer)) throw new Error('Downloaded Rive WASM runtime is invalid.');
        try { await cache?.put(url, response); } catch { /* export still owns the verified bytes */ }
        return arrayBufferToBase64(buffer);
    })();
    pendingAssets.set(asset, promise);
    try { return await promise; }
    catch (error) {
        pendingAssets.delete(asset);
        throw new Error(`Offline export could not prepare ${runtimeName}@${asset.version}: ${error.message || error}`);
    }
}
