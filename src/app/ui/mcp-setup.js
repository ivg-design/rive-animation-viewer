export function createMcpSetupController({
    elements,
    getBridgeConnected,
    getTauriInvoker,
    initLucideIcons,
}) {
    let mcpNodeChecked = false;
    let mcpServerResolvedPath = null;

    async function showMcpSetup() {
        const dialog = elements.mcpSetupDialog;
        if (!dialog) return;

        if (!mcpServerResolvedPath) {
            const invoke = getTauriInvoker();
            if (invoke) {
                try {
                    mcpServerResolvedPath = await invoke('get_mcp_server_path');
                } catch (error) {
                    console.warn('[rive-viewer] MCP server path not found:', error);
                }
            }
        }

        const serverPath = mcpServerResolvedPath || '/path/to/Rive Animation Viewer.app/Contents/Resources/resources/rav-mcp-server.js';
        if (elements.mcpServerPathDisplay) {
            elements.mcpServerPathDisplay.textContent = serverPath;
        }

        if (!mcpNodeChecked) {
            mcpNodeChecked = true;
            checkNodeInstalled();
        }

        const escaped = serverPath.replace(/'/g, "'\\''");

        if (elements.snippetClaudeCode) {
            elements.snippetClaudeCode.textContent = `claude mcp add rav-mcp node '${escaped}'`;
        }
        if (elements.snippetClaudeDesktop) {
            elements.snippetClaudeDesktop.textContent = JSON.stringify({
                mcpServers: {
                    'rav-mcp': {
                        command: 'node',
                        args: [serverPath],
                    },
                },
            }, null, 2);
        }
        if (elements.snippetCodex) {
            elements.snippetCodex.textContent = JSON.stringify({
                'rav-mcp': {
                    command: 'node',
                    args: [serverPath],
                    transport: 'stdio',
                },
            }, null, 2);
        }
        if (elements.snippetGeneric) {
            elements.snippetGeneric.textContent = JSON.stringify({
                name: 'rav-mcp',
                transport: { type: 'stdio', command: 'node', args: [serverPath] },
            }, null, 2);
        }

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

        dialog.showModal();
        initLucideIcons();
    }

    async function checkNodeInstalled() {
        const statusEl = elements.mcpNodeStatus;
        const labelEl = elements.mcpNodeLabel;
        if (!statusEl || !labelEl) return;

        try {
            const bridgeConnected = getBridgeConnected();
            if (bridgeConnected) {
                statusEl.classList.remove('is-missing');
                statusEl.classList.add('is-installed');
                labelEl.textContent = 'Node.js: installed (MCP server running)';
                return;
            }

            statusEl.classList.remove('is-installed');
            statusEl.classList.add('is-missing');
            labelEl.innerHTML = 'Node.js: not detected &mdash; required for MCP';
            const link = document.createElement('a');
            link.href = 'https://nodejs.org';
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'mcp-node-install-link';
            link.textContent = 'INSTALL';
            statusEl.appendChild(link);
        } catch {
            /* noop */
        }
    }

    return {
        showMcpSetup,
    };
}
