// Loader for the file-inspection parser. The parser itself is a separately
// distributed module staged into `./private/` at build time
// (`scripts/private-modules.mjs`); this public tree only carries the loader.
// When the module is absent every inspection rejects with one clear error and
// nothing else in the application changes shape.
const PRIVATE_CLIENT_URL = new URL('./private/client.js', import.meta.url);

export const INSPECTION_MODULE_MISSING = 'This build does not include the file inspection module.';

function unavailableError(cause) {
    const error = new Error(INSPECTION_MODULE_MISSING);
    error.name = 'InspectionUnavailableError';
    if (cause) error.cause = cause;
    return error;
}

export function createParserClient({
    importModule = (url) => import(/* @vite-ignore */ url.href),
    moduleUrl = PRIVATE_CLIENT_URL,
    options = {},
} = {}) {
    let loading = null;
    let inner = null;
    let disposed = false;

    function load() {
        if (!loading) {
            loading = importModule(moduleUrl).then((module) => {
                if (typeof module?.createParserClient !== 'function') throw unavailableError();
                inner = module.createParserClient(options);
                if (disposed) inner.dispose?.();
                return inner;
            }, (cause) => { throw unavailableError(cause); });
        }
        return loading;
    }

    return {
        async parse(buffer, request) {
            const client = await load();
            return client.parse(buffer, request);
        },
        reset() { inner?.reset?.(); },
        dispose() {
            disposed = true;
            inner?.dispose?.();
        },
    };
}
