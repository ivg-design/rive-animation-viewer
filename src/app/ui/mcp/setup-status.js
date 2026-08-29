const MCP_SETUP_STATUS_RETRY_DELAYS_MS = [50, 150, 400, 800];

function isConfirmedMissingSidecarError(error) {
    const message = String(error?.message || error || '');
    return /MCP server not found beside the application executable/i.test(message);
}

export function resolveMcpBridgePort(value, fallback) {
    const port = Number(value);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

export function renderMcpEndpointStatus({
    bridgeConnected,
    bridgeEnabled,
    confirmedMissing = false,
    currentPort,
    desktop,
    labelEl,
    serverPath,
    statusEl,
}) {
    if (!statusEl || !labelEl) return;
    statusEl.classList.remove('is-installed', 'is-disabled', 'is-missing', 'is-connected');
    if (!desktop) {
        if (!bridgeEnabled) {
            statusEl.classList.add('is-disabled');
            labelEl.textContent = 'MCP disabled';
            statusEl.title = 'The local MCP bridge is disabled for this browser session.';
        } else if (bridgeConnected) {
            statusEl.classList.add('is-installed', 'is-connected');
            labelEl.textContent = 'Local MCP bridge ready';
            statusEl.title = `This browser session is connected to the local MCP bridge on port ${currentPort}.`;
        } else {
            labelEl.textContent = 'Waiting for local MCP bridge...';
            statusEl.title = `This browser session is waiting for the local MCP bridge on port ${currentPort}.`;
        }
        return;
    }
    if (serverPath) {
        statusEl.classList.add(bridgeEnabled ? 'is-installed' : 'is-disabled');
        statusEl.classList.toggle('is-connected', bridgeConnected);
        labelEl.textContent = bridgeEnabled ? 'MCP ready' : 'MCP disabled';
        statusEl.title = bridgeConnected
            ? 'The app is actively connected to the bundled MCP bridge.'
            : 'The bundled MCP bridge is ready and listening for MCP clients.';
        return;
    }
    if (confirmedMissing) {
        statusEl.classList.add('is-missing');
        labelEl.textContent = 'Bundled MCP sidecar not found beside the app executable';
        statusEl.title = 'Bundled MCP sidecar not found beside the app executable.';
        return;
    }
    labelEl.textContent = 'Checking bundled MCP sidecar...';
    statusEl.title = 'Waiting for the desktop MCP setup service to become available.';
}

export function createMcpSetupStatusResolver({
    getTauriInvoker,
    isDesktop,
    scheduleTimeout = globalThis.setTimeout,
}) {
    const waitForRetry = (delayMs) => (
        typeof scheduleTimeout === 'function'
            ? new Promise((resolve) => scheduleTimeout(resolve, delayMs))
            : Promise.resolve()
    );

    return async function requestSetupStatus() {
        if (!isDesktop()) return { confirmedMissing: false, setupStatus: null };
        let lastError = null;
        for (let attempt = 0; attempt <= MCP_SETUP_STATUS_RETRY_DELAYS_MS.length; attempt += 1) {
            const invoke = getTauriInvoker();
            if (typeof invoke === 'function') {
                try {
                    const setupStatus = await invoke('get_mcp_setup_status', {});
                    if (setupStatus?.serverPath || setupStatus?.server_path) {
                        return { confirmedMissing: false, setupStatus };
                    }
                } catch (error) {
                    lastError = error;
                    if (isConfirmedMissingSidecarError(error)) {
                        console.warn('[rive-viewer] get_mcp_setup_status failed:', error);
                        return { confirmedMissing: true, setupStatus: null };
                    }
                }
            }
            if (attempt < MCP_SETUP_STATUS_RETRY_DELAYS_MS.length) {
                await waitForRetry(MCP_SETUP_STATUS_RETRY_DELAYS_MS[attempt]);
            }
        }
        if (lastError) console.warn('[rive-viewer] get_mcp_setup_status failed:', lastError);
        return { confirmedMissing: false, setupStatus: null };
    };
}
