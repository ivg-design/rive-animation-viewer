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
const PORT_SYNC_TIMEOUT_MS = 800;
const COMMAND_ACTIVITY_WINDOW_MS = 30_000;
const restrictedMcpMode = window.__RAV_UPDATER_ACCEPTANCE__ === true
    || window.__RAV_TELEMETRY_ACCEPTANCE__ === true;

const state = {
    activeCommandCount: 0,
    activityTimer: null,
    baseReconnectDelay: RECONNECT_DELAY_MS,
    bridgePortSyncPromise: null,
    connected: false,
    connectionPhase: 'waiting',
    connectPromise: null,
    connectionAttempts: 0,
    enabled: !restrictedMcpMode,
    maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
    lastCommandAt: null,
    mcpClientCount: 0,
    port: readInitialBridgePort(window),
    reconnectDelay: RECONNECT_DELAY_MS,
    reconnectTimer: null,
    socket: null,
    watchdogTimer: null,
};

function getIndicatorState() {
    if (!state.enabled) {
        return 'off';
    }
    if (state.connectionPhase === 'error') {
        return 'error';
    }
    if (!state.connected) {
        return 'waiting';
    }
    const hasRecentCommand = Number.isFinite(state.lastCommandAt)
        && (Date.now() - state.lastCommandAt) < COMMAND_ACTIVITY_WINDOW_MS;
    return state.activeCommandCount > 0 || hasRecentCommand ? 'active' : 'idle';
}

function syncIndicator() {
    transport.syncState();
}

function clearCommandActivity() {
    if (state.activityTimer) {
        window.clearTimeout(state.activityTimer);
        state.activityTimer = null;
    }
    state.activeCommandCount = 0;
    state.lastCommandAt = null;
}

function armCommandActivityExpiry() {
    if (state.activityTimer) {
        window.clearTimeout(state.activityTimer);
    }
    state.activityTimer = window.setTimeout(() => {
        state.activityTimer = null;
        syncIndicator();
    }, COMMAND_ACTIVITY_WINDOW_MS);
}

function markCommandStart() {
    if (!state.enabled || !state.connected) {
        return;
    }
    state.activeCommandCount += 1;
    state.lastCommandAt = Date.now();
    armCommandActivityExpiry();
    syncIndicator();
}

function markCommandEnd() {
    state.activeCommandCount = Math.max(0, state.activeCommandCount - 1);
    syncIndicator();
}

function updateClientPresence({ clientCount = 0, connected = false } = {}) {
    state.mcpClientCount = connected ? Math.max(1, clientCount) : Math.max(0, clientCount);
    syncIndicator();
}

function getBridgeUrl() {
    return `ws://127.0.0.1:${state.port}`;
}

async function syncBridgePortFromDesktop() {
    if (state.bridgePortSyncPromise) {
        return state.bridgePortSyncPromise;
    }

    state.bridgePortSyncPromise = (async () => {
        const resolvedPort = await Promise.race([
            invokeDesktop('get_mcp_port', {}, window),
            new Promise((resolve) => {
                window.setTimeout(() => resolve(null), PORT_SYNC_TIMEOUT_MS);
            }),
        ]);
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
    getCanvasBackgroundStateSnapshot: () => window._mcpGetCanvasBackgroundState?.(),
    getRenderSurfaceController: () => window._mcpGetRenderSurfaceController?.(),
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
    getState: () => ({ ...state, indicatorState: getIndicatorState() }),
    getWatchdogIntervalMs: () => WATCHDOG_INTERVAL_MS,
    onConnected: () => {
        clearCommandActivity();
        state.connected = true;
        state.connectionPhase = 'connected';
        state.reconnectDelay = state.baseReconnectDelay;
    },
    onConnecting: () => {
        state.connected = false;
        state.connectionPhase = 'waiting';
    },
    onConnectionError: () => {
        state.connected = false;
        state.connectionPhase = 'error';
    },
    onClientPresenceChange: ({ clientCount, connected }) => {
        updateClientPresence({ clientCount, connected });
    },
    onCommandEnd: () => {
        markCommandEnd();
    },
    onCommandStart: () => {
        markCommandStart();
    },
    onDisconnected: ({ unexpected = false } = {}) => {
        clearCommandActivity();
        state.mcpClientCount = 0;
        state.connected = false;
        state.connectionPhase = unexpected && state.enabled ? 'error' : 'waiting';
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
    get indicatorState() { return getIndicatorState(); },
    get port() { return state.port; },
    get state() {
        return !state.enabled
            ? 'off'
            : state.connectionPhase === 'error'
                ? 'error'
                : state.connected
                    ? 'connected'
                    : 'waiting';
    },

    enable() {
        if (restrictedMcpMode || state.enabled) {
            return;
        }
        state.enabled = true;
        clearCommandActivity();
        state.connectionPhase = 'waiting';
        state.mcpClientCount = 0;
        state.reconnectDelay = state.baseReconnectDelay;
        transport.syncState();
        transport.connect();
    },

    async disable() {
        if (!state.enabled) {
            return true;
        }
        state.enabled = false;
        clearCommandActivity();
        state.connectionPhase = 'waiting';
        state.mcpClientCount = 0;
        transport.disconnect();
        transport.syncState();
        if (!getTauriInvoker(window)) {
            return true;
        }
        return invokeDesktop('stop_mcp_bridge', {}, window);
    },

    async toggle() {
        if (restrictedMcpMode) {
            return false;
        }
        if (state.enabled) {
            return this.disable();
        } else {
            this.enable();
            return true;
        }
    },

    reconnect() {
        if (restrictedMcpMode) {
            return Promise.resolve(false);
        }
        state.connectionPhase = 'waiting';
        transport.disconnect();
        state.reconnectDelay = state.baseReconnectDelay;
        return transport.connect();
    },

    setPort(nextPort) {
        if (restrictedMcpMode) {
            return state.port;
        }
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
            state.connectionPhase = 'waiting';
            transport.disconnect();
            state.reconnectDelay = state.baseReconnectDelay;
            void transport.connect();
        } else {
            transport.syncState();
        }
        return state.port;
    },
};

transport.syncState();
if (!restrictedMcpMode) {
    window.addEventListener('focus', () => transport.reconnectNow());
    window.addEventListener('pageshow', () => transport.reconnectNow());
    window.addEventListener('online', () => transport.reconnectNow());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            transport.reconnectNow();
        }
    });
    transport.startWatchdog();
    transport.connect();
}
