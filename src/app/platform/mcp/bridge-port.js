export const DEFAULT_MCP_BRIDGE_PORT = 9274;

export function normalizeBridgePort(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
        ? parsed
        : DEFAULT_MCP_BRIDGE_PORT;
}

export function readInitialBridgePort(windowRef = globalThis.window) {
    const explicitPort = windowRef?.__RAV_MCP_PORT__;
    if (explicitPort) {
        return normalizeBridgePort(explicitPort);
    }
    try {
        return normalizeBridgePort(windowRef?.localStorage?.getItem('rav-mcp-port'));
    } catch {
        return DEFAULT_MCP_BRIDGE_PORT;
    }
}

export function persistBridgePort(port, windowRef = globalThis.window) {
    try {
        windowRef?.localStorage?.setItem('rav-mcp-port', String(port));
    } catch {
        /* noop */
    }
    if (windowRef) {
        windowRef.__RAV_MCP_PORT__ = port;
    }
}

export function getTauriInvoker(windowRef = globalThis.window) {
    if (windowRef?.__TAURI_INTERNALS__?.invoke) {
        return windowRef.__TAURI_INTERNALS__.invoke.bind(windowRef.__TAURI_INTERNALS__);
    }
    if (windowRef?.__TAURI__?.core?.invoke) {
        return windowRef.__TAURI__.core.invoke.bind(windowRef.__TAURI__.core);
    }
    if (windowRef?.__TAURI__?.invoke) {
        return windowRef.__TAURI__.invoke.bind(windowRef.__TAURI__);
    }
    return null;
}

export async function invokeDesktop(command, args = {}, windowRef = globalThis.window) {
    const invoke = getTauriInvoker(windowRef);
    if (!invoke) {
        return null;
    }
    try {
        return await invoke(command, args);
    } catch (error) {
        console.warn(`[rav-mcp-bridge] ${command} failed:`, error);
        return null;
    }
}
