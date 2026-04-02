export function createMcpSetupController({
    elements,
    getBridgeConnected,
    getTauriInvoker,
    initLucideIcons,
}) {
    let mcpServerResolvedPath = null;
    const NODE_INSTALL_URL = 'https://nodejs.org/en/download';

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

    async function openNodeInstallPage() {
        const opened = await invokeDesktop('open_external_url', { url: NODE_INSTALL_URL });
        if (opened !== null) {
            return;
        }

        if (typeof window.open === 'function') {
            window.open(NODE_INSTALL_URL, '_blank', 'noopener,noreferrer');
            return;
        }

        window.location.href = NODE_INSTALL_URL;
    }

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

        await checkNodeInstalled();

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
            statusEl.classList.remove('is-installed', 'is-missing');
            statusEl.querySelectorAll('.mcp-node-install-link').forEach((node) => node.remove());

            const bridgeConnected = getBridgeConnected();
            if (bridgeConnected) {
                statusEl.classList.add('is-installed');
                labelEl.textContent = 'Node.js: installed (MCP server running)';
                return;
            }

            const nodeRuntime = await invokeDesktop('detect_node_runtime');
            if (nodeRuntime?.installed) {
                const parts = [];
                if (nodeRuntime.version) {
                    parts.push(nodeRuntime.version);
                }
                if (nodeRuntime.path) {
                    parts.push(nodeRuntime.path);
                }
                const detail = parts.length ? ` (${parts.join(' • ')})` : '';
                statusEl.classList.add('is-installed');
                labelEl.textContent = `Node.js: installed${detail} — MCP bridge not connected yet`;
                return;
            }

            statusEl.classList.add('is-missing');
            labelEl.innerHTML = 'Node.js: not detected &mdash; required for MCP';
            const link = document.createElement('a');
            link.href = NODE_INSTALL_URL;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'mcp-node-install-link';
            link.textContent = 'INSTALL';
            link.addEventListener('click', async (event) => {
                event.preventDefault();
                await openNodeInstallPage();
            });
            statusEl.appendChild(link);
        } catch {
            /* noop */
        }
    }

    return {
        showMcpSetup,
    };
}
