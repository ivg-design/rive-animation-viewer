import { MCP_SCRIPT_ACCESS_STORAGE_KEY } from '../core/constants.js';
import {
    buildClaudeCodeCommand,
    buildClaudeDesktopSnippet,
    buildCodexSnippet,
    buildGenericSnippet,
    setCopyHandlers,
} from './mcp/snippets.js';
import { measureDialogOverlay } from './overlay/dialog-bounds.js';

export function createMcpSetupController({
    elements,
    getBridgeEnabled = () => true,
    getBridgeConnected = () => false,
    getTauriInvoker,
    initLucideIcons,
    requestUiOverlay = null,
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

    async function invokeDesktopStrict(command, args = {}) {
        const invoke = getTauriInvoker();
        if (typeof invoke !== 'function') {
            throw new Error('The desktop MCP bridge is unavailable.');
        }
        return await invoke(command, args);
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
        labelEl.textContent = 'Bundled MCP sidecar not found beside the app executable';
        statusEl.title = 'Bundled MCP sidecar not found beside the app executable.';
    }

    function populateSnippets(serverPath, port) {
        const resolvedPath = serverPath || '/path/to/Rive Animation Viewer.app/Contents/MacOS/rav-mcp';
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

    function captureOverlayState() {
        const targetLabels = {
            'claude-code': 'Claude Code (CLI)',
            'claude-desktop': 'Claude Desktop',
            codex: 'Codex (CLI/Desktop)',
        };
        const snippetElements = {
            'claude-code': elements.snippetClaudeCode,
            'claude-desktop': elements.snippetClaudeDesktop,
            codex: elements.snippetCodex,
        };
        return {
            node: {
                className: elements.mcpNodeStatus?.className || '',
                label: elements.mcpNodeLabel?.textContent || 'MCP unavailable',
                path: elements.mcpServerPathDisplay?.textContent || '',
                port: Number(elements.mcpPortInput?.value) || currentPort,
                portDraft: elements.mcpPortInput?.value ?? String(currentPort),
            },
            scriptAccess: {
                enabled: isScriptAccessEnabled(),
                note: elements.mcpScriptAccessNote?.textContent || '',
            },
            targets: Array.from(targetStatusElements.keys()).map((id) => ({
                id,
                installDisabled: Boolean(targetInstallButtons.get(id)?.disabled),
                installLabel: targetInstallButtons.get(id)?.textContent || 'INSTALL',
                label: targetLabels[id],
                removeHidden: Boolean(targetRemoveButtons.get(id)?.hidden),
                snippet: snippetElements[id]?.textContent || '',
                status: targetStatusElements.get(id)?.textContent || 'Detecting…',
                statusClassName: targetStatusElements.get(id)?.className || '',
            })),
            genericSnippet: elements.snippetGeneric?.textContent || '',
            claudeDesktopCopy: elements.mcpClaudeDesktopCopy?.textContent || '',
        };
    }

    async function applyPort(nextValue) {
        const nextPort = Number.parseInt(String(nextValue || '').trim(), 10);
        if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) return false;
        const resolvedPort = Number(await invokeDesktopStrict('set_mcp_port', { port: nextPort }));
        if (!Number.isInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) {
            throw new Error('RAV did not confirm the requested MCP port.');
        }
        currentPort = resolvedPort;
        if (elements.mcpPortInput) elements.mcpPortInput.value = String(currentPort);
        await refreshSetupStatus();
        return true;
    }

    async function handleOverlayAction({ action, value }) {
        if (action === 'script-access-toggle') {
            setScriptAccessEnabled(!isScriptAccessEnabled());
            return null;
        }
        if (action === 'port-apply') {
            if (!await applyPort(value)) {
                throw new Error('Enter a valid MCP port between 1 and 65535.');
            }
            return null;
        }
        if (action === 'port-draft') {
            if (elements.mcpPortInput) elements.mcpPortInput.value = String(value || '');
            return null;
        }
        if (action === 'client-install' && targetInstallButtons.has(value)) {
            const result = await invokeDesktopStrict('install_mcp_client', { target: value, port: currentPort });
            if (result?.installed !== true) {
                throw new Error(`RAV did not confirm installation for ${value}.`);
            }
            await refreshSetupStatus();
            return null;
        }
        if (action === 'client-remove' && targetRemoveButtons.has(value)) {
            const result = await invokeDesktopStrict('remove_mcp_client', { target: value });
            if (result?.installed !== false) {
                throw new Error(`RAV did not confirm removal for ${value}.`);
            }
            await refreshSetupStatus();
            return null;
        }
        if (action === 'copy') {
            const state = captureOverlayState();
            const text = value === 'server-path'
                ? state.node.path
                : value === 'generic'
                ? state.genericSnippet
                    : state.targets.find((target) => target.id === value)?.snippet;
            if (!text) {
                throw new Error('The requested MCP configuration is unavailable.');
            }
            const writeText = windowRef.navigator?.clipboard?.writeText;
            if (typeof writeText !== 'function') {
                throw new Error('Clipboard access is unavailable.');
            }
            await writeText.call(windowRef.navigator.clipboard, text);
        }
        return null;
    }

    function setPortHandlers() {
        const input = elements.mcpPortInput;
        const button = elements.mcpPortApplyButton;
        if (!input || !button) {
            return;
        }

        const applyCurrentPort = async () => {
            if (!await applyPort(input.value)) {
                input.value = String(currentPort);
                return;
            }
        };

        button.onclick = () => {
            applyCurrentPort().catch(() => {
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
                let result = null;
                try {
                    result = await invokeDesktopStrict('install_mcp_client', { target, port: currentPort });
                } catch {
                    /* The visible FAILED state below is the recovery path for native failures. */
                }
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
                let result = null;
                try {
                    result = await invokeDesktopStrict('remove_mcp_client', { target });
                } catch {
                    /* The visible FAILED state below is the recovery path for native failures. */
                }
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

        initLucideIcons();
        elements.mcpNodeLabel && (elements.mcpNodeLabel.textContent = getBridgeEnabled() ? 'MCP ready' : 'MCP disabled');
        if (typeof requestUiOverlay === 'function') {
            await refreshSetupStatus();
            const opened = await requestUiOverlay({
                bounds: measureDialogOverlay({ dialog }),
                getState: captureOverlayState,
                handleAction: handleOverlayAction,
                purpose: 'mcp',
                restoreFocusTarget: elements.mcpSetupButton,
            });
            if (opened) return { open: true, overlay: true };
        }
        dialog.showModal();
        dialog.ownerDocument?.activeElement?.blur?.();
        windowRef.setTimeout(() => {
            void refreshSetupStatus();
        }, 0);
        return { open: true, overlay: false };
    }

    return {
        showMcpSetup,
    };
}
