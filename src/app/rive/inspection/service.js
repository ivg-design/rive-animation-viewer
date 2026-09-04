import { inspectNativeFile } from './native-metadata.js';

function freezePlain(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freezePlain);
        Object.freeze(value);
    }
    return value;
}

function abortError() {
    const error = new Error('Rive inspection cancelled.');
    error.name = 'AbortError';
    return error;
}

async function resolveRuntime(runtime) {
    if (typeof runtime?.RuntimeLoader?.awaitInstance === 'function') return runtime.RuntimeLoader.awaitInstance();
    if (typeof runtime?.RuntimeLoader?.getInstance === 'function') {
        return new Promise((resolve) => runtime.RuntimeLoader.getInstance(resolve));
    }
    // Also accepts the low-level runtime, never a live Rive/RiveFile wrapper.
    if (typeof runtime?.load === 'function' && typeof runtime?.StateMachineInstance === 'function') return runtime;
    throw new Error('Independent Rive inspection is unavailable for this runtime.');
}

export function createInspectionService({ maxEntries = 8 } = {}) {
    const cache = new Map();
    const pending = new Map();
    const limit = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 8;
    let generation = 0;
    let disposed = false;
    const keyFor = (sourceIdentity, runtimeKey) => JSON.stringify([sourceIdentity, runtimeKey]);

    function inspect({ buffer, sourceIdentity, runtimeKey, runtime, signal } = {}) {
        if (disposed || signal?.aborted) return Promise.reject(abortError());
        if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || !sourceIdentity || !runtimeKey) {
            return Promise.reject(new Error('Inspection requires bytes, source identity, and a pinned runtime key.'));
        }
        const key = keyFor(sourceIdentity, runtimeKey);
        if (cache.has(key)) return Promise.resolve(cache.get(key));
        // Signal-bearing requests own cancellation independently of other callers.
        if (!signal && pending.has(key)) return pending.get(key);
        const copiedBytes = new Uint8Array(buffer.slice(0));
        const epoch = generation;
        const assertCurrent = () => {
            if (disposed || signal?.aborted || epoch !== generation) throw abortError();
        };
        const operation = (async () => {
            let file = null;
            try {
                const nativeRuntime = await resolveRuntime(runtime);
                assertCurrent();
                // A fresh parse is the isolation boundary. Do not use a player's
                // file, RiveFile reference, or contents getter, even on failure.
                file = await nativeRuntime.load(copiedBytes, undefined, false);
                assertCurrent();
                if (!file) throw new Error('Independent Rive inspection failed to parse the file.');
                const result = freezePlain({ sourceIdentity, runtimeKey,
                    artboards: inspectNativeFile(file, nativeRuntime, assertCurrent) });
                assertCurrent();
                return result;
            } finally { file?.delete(); }
        })().then((result) => {
            assertCurrent();
            cache.set(key, result);
            while (cache.size > limit) cache.delete(cache.keys().next().value);
            return result;
        });
        if (!signal) {
            pending.set(key, operation);
            const remove = () => { if (pending.get(key) === operation) pending.delete(key); };
            operation.then(remove, remove);
        }
        return operation;
    }

    function clear() { generation += 1; cache.clear(); pending.clear(); }
    return {
        inspect,
        peek: (sourceIdentity, runtimeKey) => cache.get(keyFor(sourceIdentity, runtimeKey)) || null,
        clear,
        dispose() { disposed = true; clear(); },
    };
}
