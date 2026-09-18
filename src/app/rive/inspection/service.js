import { createParserClient as createBundledParserClient } from './parser-client.js';

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

export function createInspectionService({
    createParserClient = createBundledParserClient,
    maxEntries = 8,
} = {}) {
    const cache = new Map();
    const views = new Map();
    const pending = new Map();
    const parserClient = createParserClient();
    const limit = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 8;
    let generation = 0;
    let disposed = false;
    const viewKeyFor = (sourceIdentity, runtimeKey) => JSON.stringify([sourceIdentity, runtimeKey]);

    function viewFor(sourceIdentity, runtimeKey, base) {
        const key = viewKeyFor(sourceIdentity, runtimeKey);
        if (!views.has(key)) {
            views.set(key, freezePlain({ sourceIdentity, runtimeKey, ...base }));
        }
        return views.get(key);
    }

    function trimCache() {
        while (cache.size > limit) {
            const expiredSource = cache.keys().next().value;
            cache.delete(expiredSource);
            [...views.keys()].forEach((key) => {
                if (JSON.parse(key)[0] === expiredSource) views.delete(key);
            });
        }
    }

    function inspect({ buffer, filename = '', sourceIdentity, runtimeKey, signal } = {}) {
        if (disposed || signal?.aborted) return Promise.reject(abortError());
        if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || !sourceIdentity || !runtimeKey) {
            return Promise.reject(new Error('Inspection requires bytes, source identity, and a pinned runtime key.'));
        }
        if (cache.has(sourceIdentity)) {
            return Promise.resolve(viewFor(sourceIdentity, runtimeKey, cache.get(sourceIdentity)));
        }
        // Signal-bearing requests own cancellation independently of other callers.
        if (!signal && pending.has(sourceIdentity)) {
            return pending.get(sourceIdentity).then((base) => viewFor(sourceIdentity, runtimeKey, base));
        }
        const copiedBuffer = buffer.slice(0);
        const epoch = generation;
        const assertCurrent = () => {
            if (disposed || signal?.aborted || epoch !== generation) throw abortError();
        };
        const operation = (async () => {
            const result = await parserClient.parse(copiedBuffer, { filename, signal });
            assertCurrent();
            return freezePlain(result);
        })().then((base) => {
            assertCurrent();
            cache.set(sourceIdentity, base);
            trimCache();
            return base;
        });
        if (!signal) {
            pending.set(sourceIdentity, operation);
            const remove = () => {
                if (pending.get(sourceIdentity) === operation) pending.delete(sourceIdentity);
            };
            operation.then(remove, remove);
        }
        return operation.then((base) => viewFor(sourceIdentity, runtimeKey, base));
    }

    // Complete parser output for an entitled caller. Never cached or frozen:
    // it is large, per-request, and must not feed the normalized views.
    function inspectFull({ buffer, filename = '', signal } = {}) {
        if (disposed || signal?.aborted) return Promise.reject(abortError());
        if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) {
            return Promise.reject(new Error('Inspection requires file bytes.'));
        }
        return parserClient.parse(buffer.slice(0), { filename, raw: true, signal });
    }

    function clear() {
        generation += 1;
        cache.clear();
        views.clear();
        pending.clear();
        parserClient.reset?.();
    }
    return {
        inspect,
        inspectFull,
        peek: (sourceIdentity, runtimeKey) => {
            const base = cache.get(sourceIdentity);
            return base ? viewFor(sourceIdentity, runtimeKey, base) : null;
        },
        clear,
        dispose() {
            disposed = true;
            generation += 1;
            cache.clear();
            views.clear();
            pending.clear();
            parserClient.dispose?.();
        },
    };
}
