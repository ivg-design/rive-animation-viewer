import { MCP_SCRIPT_ACCESS_STORAGE_KEY } from '../core/constants.js';
import {
    buildClaudeCodeCommand,
    buildClaudeDesktopSnippet,
    buildCodexSnippet,
    buildGenericSnippet,
    setCopyHandlers,
} from './mcp/snippets.js';

export function createMcpSetupController({
    elements,
    getBridgeEnabled = () => true,
    getBridgeConnected = () => false,
    getTauriInvoker,
    initLucideIcons,
    windowRef = globalThis.window,
}) {
    let handlersBound = false;
    let mcpServerResolvedPath = null;
    let currentPort = 9274;
    let refreshPromise = null;
    const targetStatusElements = new Map([
        ['codex', elements.mcpClientStatusCodex],
        ['claude-code', elements.mcpClientStatusClaudeCode],
        ['claude-desktop', elements.mcpClientStatusClaudeDesktop],
    ]);
    const targetInstallButtons = new Map([
        ['codex', elements.mcpInstallCodexButton],
        ['claude-code', elements.mcpInstallClaudeCodeButton],
        ['claude-desktop', elements.mcpInstallClaudeDesktopButton],
    ]);
    const targetRemoveButtons = new Map([
        ['codex', elements.mcpRemoveCodexButton],
        ['claude-code', elements.mcpRemoveClaudeCodeButton],
        ['claude-desktop', elements.mcpRemoveClaudeDesktopButton],
    ]);

    async function invokeDesktop(command, args = {}) {
        const invoke = getTauriInvoker();
        if (!invoke) {
            return null;
        }
        try {
            return await invoke(command, args);
        } catch (error) {
            console.warn(`[rive-viewer] ${command} failed:`, error);
            return null;
        }
    }

    function isScriptAccessEnabled() {
        try {
            return windowRef.localStorage?.getItem(MCP_SCRIPT_ACCESS_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

    function setScriptAccessEnabled(enabled) {
        const normalized = Boolean(enabled);
        try {
            windowRef.localStorage?.setItem(MCP_SCRIPT_ACCESS_STORAGE_KEY, normalized ? 'true' : 'false');
        } catch {
            /* noop */
        }
        windowRef.__RAV_MCP_SCRIPT_ACCESS__ = normalized;
        windowRef.dispatchEvent?.(new CustomEvent('rav:mcp-script-access-changed', {
            detail: { enabled: normalized },
        }));
        renderScriptAccessState(normalized);
    }

    function renderScriptAccessState(enabled = isScriptAccessEnabled()) {
        const toggle = elements.mcpScriptAccessToggle;
        const note = elements.mcpScriptAccessNote;
        if (toggle) {
            toggle.textContent = enabled ? 'ON' : 'OFF';
            toggle.classList.toggle('is-enabled', enabled);
            toggle.setAttribute('aria-pressed', String(enabled));
            toggle.title = enabled
                ? 'MCP clients can run JavaScript and apply editor code.'
                : 'MCP clients are limited to read-only and safe control tools.';
        }
        if (note) {
            note.textContent = enabled
                ? 'MCP script access is enabled. Agents can run JavaScript with rav_eval, rav_console_exec, and rav_apply_code.'
                : 'Read-only MCP mode. Enable this to allow MCP clients to run JavaScript with rav_eval, rav_console_exec, and rav_apply_code.';
        }
    }

    function renderBundledServerStatus(serverPath) {
        const statusEl = elements.mcpNodeStatus;
        const labelEl = elements.mcpNodeLabel;
        if (!statusEl || !labelEl) {
            return;
        }

        statusEl.classList.remove('is-installed', 'is-disabled', 'is-missing', 'is-connected');
        if (serverPath) {
            statusEl.classList.add(getBridgeEnabled() ? 'is-installed' : 'is-disabled');
            statusEl.classList.toggle('is-connected', Boolean(getBridgeConnected()));
            labelEl.textContent = getBridgeEnabled() ? 'MCP ready' : 'MCP disabled';
            statusEl.title = getBridgeConnected()
                ? 'The app is actively connected to the bundled MCP bridge.'
                : 'The bundled MCP bridge is ready and listening for MCP clients.';
            return;
        }

        statusEl.classList.add('is-missing');
        labelEl.textContent = 'Bundled MCP sidecar not found in the app resources';
        statusEl.title = 'Bundled MCP sidecar not found in the app resources.';
    }

    function populateSnippets(serverPath, port) {
        const resolvedPath = serverPath || '/path/to/Rive Animation Viewer.app/Contents/Resources/resources/rav-mcp';
        const resolvedPort = Number.isInteger(port) && port > 0 ? port : 9274;

        if (elements.mcpServerPathDisplay) {
            elements.mcpServerPathDisplay.textContent = resolvedPath;
        }
        if (elements.snippetClaudeCode) {
            elements.snippetClaudeCode.textContent = buildClaudeCodeCommand(resolvedPath, resolvedPort);
        }
        if (elements.snippetClaudeDesktop) {
            elements.snippetClaudeDesktop.textContent = buildClaudeDesktopSnippet(resolvedPath, resolvedPort);
        }
        if (elements.snippetCodex) {
            elements.snippetCodex.textContent = buildCodexSnippet(resolvedPath, resolvedPort);
        }
        if (elements.snippetGeneric) {
            elements.snippetGeneric.textContent = buildGenericSnippet(resolvedPath, resolvedPort);
        }
    }

    function renderClientStatus(target) {
        const statusEl = targetStatusElements.get(target.id);
        const installButtonEl = targetInstallButtons.get(target.id);
        const removeButtonEl = targetRemoveButtons.get(target.id);
        if (!statusEl || !installButtonEl || !removeButtonEl) {
            return;
        }

        statusEl.classList.remove('is-installed', 'is-available', 'is-missing');
        installButtonEl.disabled = false;
        removeButtonEl.hidden = true;
        removeButtonEl.disabled = true;

        if (target.installed && target.configured !== false) {
            statusEl.classList.add('is-installed');
            statusEl.textContent = 'Installed';
            installButtonEl.textContent = 'REINSTALL';
            removeButtonEl.hidden = false;
            removeButtonEl.disabled = false;
        } else if (target.installed) {
            statusEl.classList.add('is-available');
            statusEl.textContent = 'Installed';
            installButtonEl.textContent = 'REINSTALL';
            removeButtonEl.hidden = false;
            removeButtonEl.disabled = false;
        } else if (target.available) {
            statusEl.classList.add('is-available');
            statusEl.textContent = 'Detected';
            installButtonEl.textContent = 'ADD';
        } else {
            statusEl.classList.add('is-missing');
            statusEl.textContent = 'Not detected';
            installButtonEl.textContent = 'UNAVAILABLE';
            installButtonEl.disabled = true;
        }

        const detailParts = [
            target.detail,
            target.configured === false ? `Configured for a different MCP path or port` : null,
            target.cliPath || target.cli_path,
            target.configPath || target.config_path,
        ].filter(Boolean);
        const detail = detailParts.join(' • ');
        statusEl.title = detail;
        installButtonEl.title = detail || `Install ${target.label}`;
        removeButtonEl.title = detail || `Remove ${target.label}`;
    }

    async function refreshSetupStatus() {
        if (refreshPromise) {
            return refreshPromise;
        }
        refreshPromise = (async () => {
        const setupStatus = await invokeDesktop('get_mcp_setup_status');
        mcpServerResolvedPath = setupStatus?.serverPath || setupStatus?.server_path || mcpServerResolvedPath;
        currentPort = setupStatus?.port || currentPort;
        renderBundledServerStatus(mcpServerResolvedPath);
        populateSnippets(mcpServerResolvedPath, currentPort);
        if (elements.mcpPortInput) {
            elements.mcpPortInput.value = String(currentPort);
        }
        renderScriptAccessState();
        if (elements.mcpPortApplyButton) {
            const tauriAvailable = Boolean(getTauriInvoker());
            elements.mcpPortInput.disabled = !tauriAvailable;
            elements.mcpPortApplyButton.disabled = !tauriAvailable;
            elements.mcpPortApplyButton.title = tauriAvailable
                ? 'Apply a new MCP websocket port'
                : 'Available in the desktop app';
        }

        if (elements.mcpClaudeDesktopCopy) {
            const claudeDesktop = (setupStatus?.targets || []).find((target) => target.id === 'claude-desktop');
            const configPath = claudeDesktop?.configPath || claudeDesktop?.config_path;
            elements.mcpClaudeDesktopCopy.textContent = configPath
                ? `Add to ${configPath}:`
                : 'Add to the Claude Desktop MCP config file:';
        }

        for (const target of setupStatus?.targets || []) {
            renderClientStatus(target);
        }
        })();
        try {
            await refreshPromise;
        } finally {
            refreshPromise = null;
        }
    }

    function setPortHandlers() {
        const input = elements.mcpPortInput;
        const button = elements.mcpPortApplyButton;
        if (!input || !button) {
            return;
        }

        const applyPort = async () => {
            const nextPort = Number.parseInt(String(input.value || '').trim(), 10);
            if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
                input.value = String(currentPort);
                return;
            }

            const originalText = button.textContent;
            button.disabled = true;
            button.textContent = 'SETTING';
            const resolvedPort = await invokeDesktop('set_mcp_port', { port: nextPort });
            if (resolvedPort) {
                currentPort = Number(resolvedPort) || nextPort;
                input.value = String(currentPort);
            }
            button.textContent = originalText;
            await refreshSetupStatus();
        };

        button.onclick = () => {
            applyPort().catch(() => {
                button.textContent = 'FAILED';
                setTimeout(() => {
                    button.textContent = 'SET';
                    button.disabled = false;
                    input.value = String(currentPort);
                }, 1600);
            });
        };
        input.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                button.click();
            }
        };
    }

    function setInstallHandlers() {
        for (const [target, button] of targetInstallButtons.entries()) {
            if (!button) {
                continue;
            }
            button.onclick = async () => {
                button.disabled = true;
                const originalText = button.textContent;
                button.textContent = 'ADDING';
                const result = await invokeDesktop('install_mcp_client', { target, port: currentPort });
                if (!result?.installed) {
                    button.textContent = 'FAILED';
                    setTimeout(() => {
                        button.textContent = originalText;
                        button.disabled = false;
                    }, 1600);
                    return;
                }
                await refreshSetupStatus();
            };
        }
    }

    function setScriptAccessHandlers() {
        const toggle = elements.mcpScriptAccessToggle;
        if (!toggle) {
            return;
        }
        toggle.onclick = () => {
            setScriptAccessEnabled(!isScriptAccessEnabled());
        };
        renderScriptAccessState();
    }

    function setRemoveHandlers() {
        for (const [target, button] of targetRemoveButtons.entries()) {
            if (!button) {
                continue;
            }
            button.onclick = async () => {
                button.disabled = true;
                const originalText = button.textContent;
                button.textContent = 'REMOVING';
                const result = await invokeDesktop('remove_mcp_client', { target });
                if (result?.installed !== false) {
                    button.textContent = 'FAILED';
                    setTimeout(() => {
                        button.textContent = originalText;
                        button.disabled = false;
                    }, 1600);
                    return;
                }
                await refreshSetupStatus();
            };
        }
    }

    async function showMcpSetup() {
        const dialog = elements.mcpSetupDialog;
        if (!dialog) {
            return;
        }

        if (!handlersBound) {
            setCopyHandlers(dialog, document, navigator);
            setPortHandlers();
            setScriptAccessHandlers();
            setInstallHandlers();
            setRemoveHandlers();
            handlersBound = true;
        }

        dialog.showModal();
        initLucideIcons();
        elements.mcpNodeLabel && (elements.mcpNodeLabel.textContent = getBridgeEnabled() ? 'MCP ready' : 'MCP disabled');
        windowRef.setTimeout(() => {
            void refreshSetupStatus();
        }, 0);
    }

    return {
        showMcpSetup,
    };
}
