function shellSingleQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildClaudeCodeCommand(serverPath) {
    const payload = JSON.stringify({
        type: 'stdio',
        command: serverPath,
        args: [],
    });
    return `claude mcp add-json -s user rav-mcp ${shellSingleQuote(payload)}`;
}

function buildClaudeDesktopSnippet(serverPath) {
    return JSON.stringify({
        mcpServers: {
            'rav-mcp': {
                command: serverPath,
                args: [],
            },
        },
    }, null, 2);
}

function buildCodexSnippet(serverPath) {
    return [
        '[mcp_servers."rav-mcp"]',
        `command = ${JSON.stringify(serverPath)}`,
        'args = []',
    ].join('\n');
}

function buildGenericSnippet(serverPath) {
    return JSON.stringify({
        name: 'rav-mcp',
        transport: {
            type: 'stdio',
            command: serverPath,
            args: [],
        },
    }, null, 2);
}

function setCopyHandlers(dialog) {
    dialog.querySelectorAll('.mcp-copy-btn').forEach((button) => {
        button.onclick = () => {
            const targetId = button.dataset.target;
            const pre = document.getElementById(targetId);
            if (!pre) {
                return;
            }
            navigator.clipboard.writeText(pre.textContent).then(() => {
                button.textContent = 'COPIED';
                button.classList.add('copied');
                setTimeout(() => {
                    button.textContent = 'COPY';
                    button.classList.remove('copied');
                }, 2000);
            });
        };
    });
}

export function createMcpSetupController({
    elements,
    getBridgeConnected,
    getTauriInvoker,
    initLucideIcons,
}) {
    let mcpServerResolvedPath = null;
    const targetStatusElements = new Map([
        ['codex', elements.mcpClientStatusCodex],
        ['claude-code', elements.mcpClientStatusClaudeCode],
        ['claude-desktop', elements.mcpClientStatusClaudeDesktop],
    ]);
    const targetButtons = new Map([
        ['codex', elements.mcpInstallCodexButton],
        ['claude-code', elements.mcpInstallClaudeCodeButton],
        ['claude-desktop', elements.mcpInstallClaudeDesktopButton],
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

    function renderBundledServerStatus(serverPath) {
        const statusEl = elements.mcpNodeStatus;
        const labelEl = elements.mcpNodeLabel;
        if (!statusEl || !labelEl) {
            return;
        }

        statusEl.classList.remove('is-installed', 'is-missing');
        if (serverPath) {
            statusEl.classList.add('is-installed');
            labelEl.textContent = getBridgeConnected()
                ? `Bundled MCP sidecar ready — bridge connected`
                : `Bundled MCP sidecar ready — bridge idle until an MCP client connects`;
            return;
        }

        statusEl.classList.add('is-missing');
        labelEl.textContent = 'Bundled MCP sidecar not found in the app resources';
    }

    function populateSnippets(serverPath) {
        const resolvedPath = serverPath || '/path/to/Rive Animation Viewer.app/Contents/Resources/resources/rav-mcp';

        if (elements.mcpServerPathDisplay) {
            elements.mcpServerPathDisplay.textContent = resolvedPath;
        }
        if (elements.snippetClaudeCode) {
            elements.snippetClaudeCode.textContent = buildClaudeCodeCommand(resolvedPath);
        }
        if (elements.snippetClaudeDesktop) {
            elements.snippetClaudeDesktop.textContent = buildClaudeDesktopSnippet(resolvedPath);
        }
        if (elements.snippetCodex) {
            elements.snippetCodex.textContent = buildCodexSnippet(resolvedPath);
        }
        if (elements.snippetGeneric) {
            elements.snippetGeneric.textContent = buildGenericSnippet(resolvedPath);
        }
    }

    function renderClientStatus(target) {
        const statusEl = targetStatusElements.get(target.id);
        const buttonEl = targetButtons.get(target.id);
        if (!statusEl || !buttonEl) {
            return;
        }

        statusEl.classList.remove('is-installed', 'is-available', 'is-missing');
        buttonEl.disabled = false;

        if (target.installed) {
            statusEl.classList.add('is-installed');
            statusEl.textContent = 'Installed';
            buttonEl.textContent = 'REINSTALL';
        } else if (target.available) {
            statusEl.classList.add('is-available');
            statusEl.textContent = 'Detected';
            buttonEl.textContent = 'ADD';
        } else {
            statusEl.classList.add('is-missing');
            statusEl.textContent = 'Not detected';
            buttonEl.textContent = 'UNAVAILABLE';
            buttonEl.disabled = true;
        }

        const detailParts = [target.detail, target.cliPath || target.cli_path, target.configPath || target.config_path]
            .filter(Boolean);
        const detail = detailParts.join(' • ');
        statusEl.title = detail;
        buttonEl.title = detail || `Install ${target.label}`;
    }

    async function refreshSetupStatus() {
        const setupStatus = await invokeDesktop('get_mcp_setup_status');
        mcpServerResolvedPath = setupStatus?.serverPath || setupStatus?.server_path || mcpServerResolvedPath;
        renderBundledServerStatus(mcpServerResolvedPath);
        populateSnippets(mcpServerResolvedPath);

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
    }

    function setInstallHandlers() {
        for (const [target, button] of targetButtons.entries()) {
            if (!button) {
                continue;
            }
            button.onclick = async () => {
                button.disabled = true;
                const originalText = button.textContent;
                button.textContent = 'ADDING';
                const result = await invokeDesktop('install_mcp_client', { target });
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

    async function showMcpSetup() {
        const dialog = elements.mcpSetupDialog;
        if (!dialog) {
            return;
        }

        setCopyHandlers(dialog);
        setInstallHandlers();
        await refreshSetupStatus();

        dialog.showModal();
        initLucideIcons();
    }

    return {
        showMcpSetup,
    };
}
