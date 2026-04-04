const MCP_SCRIPT_ACCESS_STORAGE_KEY = 'rav-mcp-script-access-enabled';

export function isMcpScriptAccessEnabled(windowRef = globalThis.window) {
    if (typeof windowRef?.__RAV_MCP_SCRIPT_ACCESS__ === 'boolean') {
        return windowRef.__RAV_MCP_SCRIPT_ACCESS__;
    }
    try {
        return windowRef?.localStorage?.getItem(MCP_SCRIPT_ACCESS_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function assertMcpScriptAccess(commandName, windowRef = globalThis.window) {
    if (isMcpScriptAccessEnabled(windowRef)) {
        return;
    }
    throw new Error(
        `MCP script access is disabled. Enable Script Access in the MCP setup dialog to use ${commandName}.`,
    );
}
