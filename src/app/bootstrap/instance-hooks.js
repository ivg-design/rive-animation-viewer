export function createInstanceHooks({
    getCurrentMcpPort,
    getDemoExportController,
    getInstanceController,
    getTauriInvoker,
    setCurrentMcpPort,
    windowRef = globalThis.window,
} = {}) {
    function initLucideIcons() {
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }

    function getRiveInstance() {
        return getInstanceController()?.getRiveInstance() ?? null;
    }

    async function loadRiveAnimation(fileUrl, fileName, options = {}) {
        const instanceController = getInstanceController();
        if (!instanceController) {
            throw new Error('Rive instance controller is not initialized');
        }
        return instanceController.loadRiveAnimation(fileUrl, fileName, options);
    }

    async function createDemoBundle() {
        return getDemoExportController()?.createDemoBundle();
    }

    function handleResize() {
        getInstanceController()?.handleResize();
    }

    function cleanupInstance() {
        getInstanceController()?.cleanupInstance();
    }

    async function syncMcpPortFromDesktop() {
        const invoke = getTauriInvoker();
        if (!invoke) {
            return getCurrentMcpPort();
        }

        try {
            const resolvedPort = await invoke('get_mcp_port');
            if (Number.isFinite(Number(resolvedPort)) && Number(resolvedPort) > 0) {
                setCurrentMcpPort(Number(resolvedPort));
                try {
                    windowRef.localStorage?.setItem('rav-mcp-port', String(getCurrentMcpPort()));
                } catch {
                    /* noop */
                }
                windowRef.__RAV_MCP_PORT__ = getCurrentMcpPort();
                windowRef._mcpBridge?.setPort?.(getCurrentMcpPort());
            }
        } catch (error) {
            console.warn('[rive-viewer] failed to resolve MCP port:', error);
        }

        return getCurrentMcpPort();
    }

    return {
        cleanupInstance,
        createDemoBundle,
        getRiveInstance,
        handleResize,
        initLucideIcons,
        loadRiveAnimation,
        syncMcpPortFromDesktop,
    };
}
