import { loadScript, reparentErudaContainer, sleep } from './runtime.js';

export async function loadErudaConsole({
    captureController,
    configureConsoleTool = () => {},
    elements,
    ensureConsoleTool = () => null,
    erudaPresentation,
    erudaVendorPath,
    getFollowLatest = () => true,
    getWindowEruda = () => null,
    onConsoleReady = () => {},
    onFailure = () => {},
    onScrollContainerReady = () => {},
    scrollConsoleToLatest = () => {},
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    state,
    windowRef = globalThis.window,
    documentRef = globalThis.document,
} = {}) {
    if (!windowRef?.eruda) {
        await loadScript(erudaVendorPath, documentRef);
    }
    if (!getWindowEruda()) {
        throw new Error('Eruda failed to load');
    }

    const host = elements.scriptConsoleOutput;
    if (!host) {
        throw new Error('No console host element');
    }

    host.innerHTML = '';
    try {
        windowRef.eruda.destroy?.();
    } catch {
        /* noop */
    }

    windowRef.eruda.init({
        container: host,
        inline: true,
        autoScale: false,
        useShadowDom: false,
        tool: ['console'],
        defaults: { theme: 'dark' },
    });

    windowRef.eruda.show('console');
    try {
        windowRef.eruda.remove?.('settings');
    } catch {
        /* noop */
    }

    reparentErudaContainer(host, documentRef);
    await sleep(60, setTimeoutFn);
    reparentErudaContainer(host, documentRef);
    windowRef.eruda.show('console');

    state.consoleTool = ensureConsoleTool();
    if (!state.consoleTool) {
        throw new Error('Console tool not found');
    }

    configureConsoleTool(state.consoleTool);
    captureController.flushToEruda();
    state.erudaReady = true;
    erudaPresentation.observeErudaLogs();
    onScrollContainerReady();
    erudaPresentation.refreshErudaPresentation();
    onConsoleReady();

    if (getFollowLatest()) {
        setTimeoutFn?.(() => scrollConsoleToLatest(), 30);
    }

    return true;
}
