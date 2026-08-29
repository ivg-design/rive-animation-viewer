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
    commandTimeoutMs = 20_000,
    connectTimeoutMs = 2000,
    getBridgeUrl,
    getAppKind = () => 'legacy',
    getEnabled,
    getReconnectDelay,
    getSocket,
    getState,
    getWatchdogIntervalMs = () => 1500,
    onConnected = () => {},
    onConnecting = () => {},
    onConnectionError = () => {},
    onClientPresenceChange = () => {},
    onCommandEnd = () => {},
    onCommandStart = () => {},
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

    function runCommandWithDeadline(handler, params) {
        let timeoutId = null;
        const timeout = new Promise((_resolve, reject) => {
            timeoutId = windowRef.setTimeout(() => {
                reject(new Error('MCP command timed out before the app completed it.'));
            }, commandTimeoutMs);
        });
        return Promise.race([
            Promise.resolve().then(() => handler(params)),
            timeout,
        ]).finally(() => {
            if (timeoutId !== null) windowRef.clearTimeout(timeoutId);
        });
    }

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
            try {
                await beforeConnect();
            } catch {
                onConnectionError();
                syncState();
                scheduleReconnect();
                return;
            }
            onConnecting();
            syncState();

            let nextSocket;
            try {
                nextSocket = new WebSocket(getBridgeUrl());
                setSocket(nextSocket);
                connectStartedAt = Date.now();
                armConnectTimeout(nextSocket);
            } catch {
                onConnectionError();
                syncState();
                scheduleReconnect();
                return;
            }

            nextSocket.onopen = () => {
                if (getSocket() !== nextSocket) {
                    try { nextSocket.close(); } catch { /* noop */ }
                    return;
                }
                try {
                    nextSocket.send(JSON.stringify({
                        appKind: getAppKind(),
                        bridgeHello: 'rav-app',
                    }));
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

                if (message?.bridgeEvent === 'mcp-client-state') {
                    onClientPresenceChange({
                        clientCount: Number(message.clientCount || 0),
                        connected: Boolean(message.connected),
                    });
                    syncState();
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
                onCommandStart(command);
                const startedAt = performance.now();
                try {
                    const result = await runCommandWithDeadline(handler, params || {});
                    const elapsed = Math.round(performance.now() - startedAt);
                    mcpLog('reply', `${command.replace(/^rav_/, '')} → ${formatResultSummary(command, result)}  (${elapsed}ms)`, undefined, windowRef);
                    nextSocket.send(JSON.stringify({ id, result }));
                    onCommandEnd(command);
                } catch (error) {
                    const elapsed = Math.round(performance.now() - startedAt);
                    mcpLog('error', `${command.replace(/^rav_/, '')} failed: ${error.message}  (${elapsed}ms)`, undefined, windowRef);
                    nextSocket.send(JSON.stringify({ id, error: error.message }));
                    onCommandEnd(command);
                }
            };

            nextSocket.onclose = () => {
                if (getSocket() !== nextSocket) return;
                clearConnectTimeout();
                setSocket(null);
                const wasConnected = getState().connected;
                onDisconnected({ unexpected: getEnabled(), wasConnected });
                syncState();
                if (wasConnected) {
                    mcpLog('disconnected', 'Bridge disconnected from MCP server', undefined, windowRef);
                    console.log('[rav-mcp-bridge] Disconnected from MCP server');
                }
                scheduleReconnect();
            };

            nextSocket.onerror = () => {
                if (getSocket() !== nextSocket) return;
                onConnectionError();
                syncState();
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
        onDisconnected({ unexpected: false, wasConnected: getState().connected });
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
