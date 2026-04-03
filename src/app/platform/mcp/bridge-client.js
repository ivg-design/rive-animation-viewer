import {
    DEFAULT_MCP_BRIDGE_PORT,
    getTauriInvoker,
    invokeDesktop,
    normalizeBridgePort,
    persistBridgePort,
    readInitialBridgePort,
} from './bridge-port.js';
import { createMcpCommandHandlers } from './command-handlers.js';
import { assertMcpScriptAccess } from './script-access.js';
import { createMcpBridgeTransport } from './transport.js';
import { buildViewModelSnapshot } from './view-model-snapshot.js';

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 4000;
const CONNECT_TIMEOUT_MS = 2000;
const WATCHDOG_INTERVAL_MS = 1500;

const state = {
    baseReconnectDelay: RECONNECT_DELAY_MS,
    bridgePortSyncPromise: null,
    connected: false,
    connectPromise: null,
    connectionAttempts: 0,
    enabled: true,
    maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
    port: readInitialBridgePort(window),
    reconnectDelay: RECONNECT_DELAY_MS,
    reconnectTimer: null,
    socket: null,
    watchdogTimer: null,
};

function getBridgeUrl() {
    return `ws://127.0.0.1:${state.port}`;
}

async function syncBridgePortFromDesktop() {
    if (state.bridgePortSyncPromise) {
        return state.bridgePortSyncPromise;
    }

    state.bridgePortSyncPromise = (async () => {
        const resolvedPort = await invokeDesktop('get_mcp_port', {}, window);
        if (resolvedPort === null || resolvedPort === undefined || resolvedPort === '') {
            return state.port;
        }
        const normalizedPort = normalizeBridgePort(resolvedPort);
        if (normalizedPort !== state.port) {
            state.port = normalizedPort;
            persistBridgePort(state.port, window);
        }
        return state.port;
    })();

    try {
        return await state.bridgePortSyncPromise;
    } finally {
        state.bridgePortSyncPromise = null;
    }
}

const commandHandlers = createMcpCommandHandlers({
    assertMcpScriptAccess,
    buildViewModelSnapshot,
    documentRef: document,
    windowRef: window,
});

const transport = createMcpBridgeTransport({
    beforeConnect: () => {
        state.connectionAttempts += 1;
        if (!getTauriInvoker(window)) {
            return undefined;
        }
        return syncBridgePortFromDesktop();
    },
    commandHandlers,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    getBridgeUrl,
    getEnabled: () => state.enabled,
    getReconnectDelay: () => state.reconnectDelay,
    getSocket: () => state.socket,
    getState: () => state,
    getWatchdogIntervalMs: () => WATCHDOG_INTERVAL_MS,
    onConnected: () => {
        state.connected = true;
        state.reconnectDelay = state.baseReconnectDelay;
    },
    onDisconnected: () => {
        state.connected = false;
    },
    onReconnectDelayChange: (delay) => {
        state.reconnectDelay = delay;
    },
    setConnectPromise: (promise) => {
        state.connectPromise = promise;
    },
    setReconnectTimer: (timer) => {
        state.reconnectTimer = timer;
    },
    setSocket: (socket) => {
        state.socket = socket;
    },
    setWatchdogTimer: (timer) => {
        state.watchdogTimer = timer;
    },
    windowRef: window,
});

window._mcpBridge = {
    commands: commandHandlers,
    get connected() { return state.connected; },
    get connectionAttempts() { return state.connectionAttempts; },
    get enabled() { return state.enabled; },
    get port() { return state.port; },
    get state() { return !state.enabled ? 'off' : state.connected ? 'connected' : 'waiting'; },

    enable() {
        if (state.enabled) {
            return;
        }
        state.enabled = true;
        state.reconnectDelay = state.baseReconnectDelay;
        transport.syncState();
        transport.connect();
    },

    disable() {
        if (!state.enabled) {
            return;
        }
        state.enabled = false;
        transport.disconnect();
        transport.syncState();
        void invokeDesktop('stop_mcp_bridge', {}, window);
    },

    toggle() {
        if (state.enabled) {
            this.disable();
        } else {
            this.enable();
        }
    },

    reconnect() {
        if (state.connectPromise && !state.socket) {
            state.reconnectDelay = state.baseReconnectDelay;
            transport.syncState();
            return state.connectPromise;
        }
        transport.disconnect();
        state.reconnectDelay = state.baseReconnectDelay;
        return transport.connect();
    },

    setPort(nextPort) {
        const normalizedPort = normalizeBridgePort(nextPort);
        if (normalizedPort === state.port) {
            return state.port;
        }
        state.port = normalizedPort;
        persistBridgePort(state.port, window);
        if (state.enabled) {
            if (state.connectPromise && !state.socket) {
                state.reconnectDelay = state.baseReconnectDelay;
                transport.syncState();
                return state.port;
            }
            transport.disconnect();
            state.reconnectDelay = state.baseReconnectDelay;
            void transport.connect();
        } else {
            transport.syncState();
        }
        return state.port;
    },
};

window.addEventListener('focus', () => transport.reconnectNow());
window.addEventListener('pageshow', () => transport.reconnectNow());
window.addEventListener('online', () => transport.reconnectNow());
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        transport.reconnectNow();
    }
});

transport.syncState();
transport.startWatchdog();
transport.connect();
