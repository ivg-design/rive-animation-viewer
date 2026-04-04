import {
    formatCommandSummary,
    formatResultSummary,
    mcpLog,
    updateStatusIndicator,
} from './command-format.js';

async function decodeBridgeMessageData(data) {
    if (typeof data === 'string') {
        return JSON.parse(data);
    }

    if (data instanceof ArrayBuffer) {
        return JSON.parse(new TextDecoder().decode(data));
    }

    if (ArrayBuffer.isView(data)) {
        return JSON.parse(new TextDecoder().decode(data));
    }

    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return JSON.parse(await data.text());
    }

    if (data && typeof data.text === 'function') {
        return JSON.parse(await data.text());
    }

    if (data && typeof data === 'object') {
        return data;
    }

    throw new Error('Unsupported bridge payload type');
}

export function createMcpBridgeTransport({
    beforeConnect = async () => {},
    commandHandlers,
    connectTimeoutMs = 2000,
    getBridgeUrl,
    getEnabled,
    getReconnectDelay,
    getSocket,
    getState,
    getWatchdogIntervalMs = () => 1500,
    onConnected = () => {},
    onDisconnected = () => {},
    onReconnectDelayChange = () => {},
    setConnectPromise = () => {},
    setReconnectTimer = () => {},
    setSocket = () => {},
    setWatchdogTimer = () => {},
    windowRef = globalThis.window,
} = {}) {
    let connectTimeoutTimer = null;
    let connectStartedAt = 0;

    function syncState() {
        const state = getState();
        updateStatusIndicator(state, windowRef);
    }

    function clearConnectTimeout() {
        if (!connectTimeoutTimer) {
            return;
        }
        clearTimeout(connectTimeoutTimer);
        connectTimeoutTimer = null;
    }

    function armConnectTimeout(socket) {
        clearConnectTimeout();
        connectTimeoutTimer = setTimeout(() => {
            if (getSocket() !== socket) return;
            if (!socket || socket.readyState !== WebSocket.CONNECTING) return;
            try {
                socket.close();
            } catch {
                setSocket(null);
            }
        }, connectTimeoutMs);
    }

    async function connect() {
        if (!getEnabled()) return;
        const currentPromise = getState().connectPromise;
        if (currentPromise) return currentPromise;
        const socket = getSocket();
        if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
            return;
        }

        const promise = (async () => {
            await beforeConnect();
            syncState();

            let nextSocket;
            try {
                nextSocket = new WebSocket(getBridgeUrl());
                setSocket(nextSocket);
                connectStartedAt = Date.now();
                armConnectTimeout(nextSocket);
            } catch {
                scheduleReconnect();
                return;
            }

            nextSocket.onopen = () => {
                if (getSocket() !== nextSocket) {
                    try { nextSocket.close(); } catch { /* noop */ }
                    return;
                }
                try {
                    nextSocket.send(JSON.stringify({ bridgeHello: 'rav-app' }));
                } catch (error) {
                    console.warn('[rav-mcp-bridge] Failed to send bridge handshake', error);
                    nextSocket.close();
                    return;
                }
                clearConnectTimeout();
                onConnected();
                syncState();
                mcpLog('connected', `Bridge connected to MCP server on port ${getState().port}`, windowRef);
                console.log(`[rav-mcp-bridge] Connected to MCP server at ${getBridgeUrl()}`);
            };

            nextSocket.onmessage = async (event) => {
                if (getSocket() !== nextSocket) return;
                let message;
                try {
                    message = await decodeBridgeMessageData(event.data);
                } catch (error) {
                    console.warn('[rav-mcp-bridge] Invalid bridge payload from MCP server', error);
                    return;
                }

                const { id, command, params } = message;
                if (!id || !command) return;
                const handler = commandHandlers[command];
                if (!handler) {
                    mcpLog('error', `Unknown command: ${command}`, undefined, windowRef);
                    nextSocket.send(JSON.stringify({ id, error: `Unknown command: ${command}` }));
                    return;
                }

                mcpLog('recv', formatCommandSummary(command, params), undefined, windowRef);
                const startedAt = performance.now();
                try {
                    const result = await handler(params || {});
                    const elapsed = Math.round(performance.now() - startedAt);
                    mcpLog('reply', `${command.replace(/^rav_/, '')} → ${formatResultSummary(command, result)}  (${elapsed}ms)`, undefined, windowRef);
                    nextSocket.send(JSON.stringify({ id, result }));
                } catch (error) {
                    const elapsed = Math.round(performance.now() - startedAt);
                    mcpLog('error', `${command.replace(/^rav_/, '')} failed: ${error.message}  (${elapsed}ms)`, undefined, windowRef);
                    nextSocket.send(JSON.stringify({ id, error: error.message }));
                }
            };

            nextSocket.onclose = () => {
                if (getSocket() !== nextSocket) return;
                clearConnectTimeout();
                setSocket(null);
                const wasConnected = getState().connected;
                onDisconnected();
                syncState();
                if (wasConnected) {
                    mcpLog('disconnected', 'Bridge disconnected from MCP server', undefined, windowRef);
                    console.log('[rav-mcp-bridge] Disconnected from MCP server');
                }
                scheduleReconnect();
            };

            nextSocket.onerror = () => {
                /* onclose handles reconnect */
            };
        })();

        setConnectPromise(promise);
        try {
            await promise;
        } finally {
            setConnectPromise(null);
        }
    }

    function scheduleReconnect() {
        if (!getEnabled()) return;
        if (getState().reconnectTimer) return;
        const delay = Math.max(100, Math.min(getReconnectDelay(), getState().maxReconnectDelay));
        const timer = setTimeout(() => {
            setReconnectTimer(null);
            connect();
        }, delay);
        setReconnectTimer(timer);
        onReconnectDelayChange(Math.min(delay * 1.5, getState().maxReconnectDelay));
    }

    function disconnect() {
        setConnectPromise(null);
        if (getState().reconnectTimer) {
            clearTimeout(getState().reconnectTimer);
            setReconnectTimer(null);
        }
        clearConnectTimeout();
        const socket = getSocket();
        if (socket) {
            socket.onclose = null;
            socket.close(1000, 'Bridge disabled');
            setSocket(null);
        }
        onDisconnected();
    }

    function reconnectNow() {
        if (!getEnabled() || getState().connected) return;
        disconnect();
        onReconnectDelayChange(getState().baseReconnectDelay);
        connect();
    }

    function startWatchdog() {
        if (getState().watchdogTimer) return;
        const timer = setInterval(() => {
            if (!getEnabled() || getState().connected) return;
            const socket = getSocket();
            if (socket && socket.readyState === WebSocket.CONNECTING) {
                if ((Date.now() - connectStartedAt) >= connectTimeoutMs) {
                    try { socket.close(); } catch { setSocket(null); }
                }
                return;
            }
            if (!socket && !getState().reconnectTimer) {
                onReconnectDelayChange(getState().baseReconnectDelay);
                connect();
            }
        }, getWatchdogIntervalMs());
        setWatchdogTimer(timer);
    }

    return {
        connect,
        disconnect,
        reconnectNow,
        scheduleReconnect,
        startWatchdog,
        syncState,
    };
}
