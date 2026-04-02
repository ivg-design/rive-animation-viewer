import { createMcpSetupController } from '../../../src/app/ui/mcp-setup.js';

function buildElements() {
    document.body.innerHTML = `
        <dialog id="mcp-setup-dialog">
            <button class="mcp-copy-btn" data-target="snippet-claude-code">COPY</button>
            <button id="mcp-install-codex-btn" data-install-target="codex">INSTALL</button>
            <button id="mcp-install-claude-code-btn" data-install-target="claude-code">INSTALL</button>
            <button id="mcp-install-claude-desktop-btn" data-install-target="claude-desktop">INSTALL</button>
        </dialog>
        <pre id="mcp-server-path-display"></pre>
        <div id="mcp-node-status"></div>
        <span id="mcp-node-label"></span>
        <p id="mcp-claude-desktop-copy"></p>
        <span id="mcp-client-status-codex"></span>
        <span id="mcp-client-status-claude-code"></span>
        <span id="mcp-client-status-claude-desktop"></span>
        <pre id="snippet-claude-code"></pre>
        <pre id="snippet-claude-desktop"></pre>
        <pre id="snippet-codex"></pre>
        <pre id="snippet-generic"></pre>
    `;

    const dialog = document.getElementById('mcp-setup-dialog');
    dialog.showModal = vi.fn();

    return {
        mcpSetupDialog: dialog,
        mcpServerPathDisplay: document.getElementById('mcp-server-path-display'),
        mcpNodeStatus: document.getElementById('mcp-node-status'),
        mcpNodeLabel: document.getElementById('mcp-node-label'),
        mcpClaudeDesktopCopy: document.getElementById('mcp-claude-desktop-copy'),
        mcpClientStatusCodex: document.getElementById('mcp-client-status-codex'),
        mcpClientStatusClaudeCode: document.getElementById('mcp-client-status-claude-code'),
        mcpClientStatusClaudeDesktop: document.getElementById('mcp-client-status-claude-desktop'),
        mcpInstallCodexButton: document.getElementById('mcp-install-codex-btn'),
        mcpInstallClaudeCodeButton: document.getElementById('mcp-install-claude-code-btn'),
        mcpInstallClaudeDesktopButton: document.getElementById('mcp-install-claude-desktop-btn'),
        snippetClaudeCode: document.getElementById('snippet-claude-code'),
        snippetClaudeDesktop: document.getElementById('snippet-claude-desktop'),
        snippetCodex: document.getElementById('snippet-codex'),
        snippetGeneric: document.getElementById('snippet-generic'),
    };
}

function mockSetupStatus() {
    return {
        serverPath: '/Applications/RAV/resources/rav-mcp',
        targets: [
            {
                id: 'codex',
                label: 'Codex',
                available: true,
                installed: true,
                detail: 'Shared Codex config for CLI/Desktop',
                configPath: '/Users/test/.codex/config.toml',
            },
            {
                id: 'claude-code',
                label: 'Claude Code',
                available: true,
                installed: false,
                detail: 'Uses claude mcp add-json in user scope',
                cliPath: '/usr/local/bin/claude',
            },
            {
                id: 'claude-desktop',
                label: 'Claude Desktop',
                available: false,
                installed: false,
                detail: 'Desktop app config file',
                configPath: '/Users/test/Library/Application Support/Claude/claude_desktop_config.json',
            },
        ],
    };
}

describe('ui/mcp-setup', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('populates sidecar snippets and shows detection state', async () => {
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: clipboardWrite },
        });
        const elements = buildElements();
        const invoke = vi.fn(async (command) => {
            if (command === 'get_mcp_setup_status') {
                return mockSetupStatus();
            }
            return null;
        });
        const controller = createMcpSetupController({
            elements,
            getBridgeConnected: () => true,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
        });

        await controller.showMcpSetup();

        expect(elements.mcpServerPathDisplay.textContent).toContain('rav-mcp');
        expect(elements.snippetClaudeCode.textContent).toContain('claude mcp add-json -s user rav-mcp');
        expect(elements.snippetClaudeDesktop.textContent).toContain('"command": "/Applications/RAV/resources/rav-mcp"');
        expect(elements.snippetCodex.textContent).toContain('[mcp_servers."rav-mcp"]');
        expect(elements.mcpNodeLabel.textContent).toContain('Bundled MCP sidecar ready');
        expect(elements.mcpClientStatusCodex.textContent).toBe('Installed');
        expect(elements.mcpClientStatusClaudeCode.textContent).toBe('Detected');
        expect(elements.mcpClientStatusClaudeDesktop.textContent).toBe('Not detected');
        expect(elements.mcpInstallClaudeDesktopButton.disabled).toBe(true);
        expect(elements.mcpSetupDialog.showModal).toHaveBeenCalledTimes(1);

        document.querySelector('.mcp-copy-btn').click();
        await Promise.resolve();
        expect(clipboardWrite).toHaveBeenCalledWith(elements.snippetClaudeCode.textContent);
    });

    it('runs one-click install and refreshes setup state', async () => {
        const elements = buildElements();
        const invoke = vi.fn(async (command, args) => {
            if (command === 'get_mcp_setup_status') {
                return invoke.statuses.shift();
            }
            if (command === 'install_mcp_client') {
                return { installed: true, target: args.target };
            }
            return null;
        });
        invoke.statuses = [
            mockSetupStatus(),
            {
                ...mockSetupStatus(),
                targets: mockSetupStatus().targets.map((target) => (
                    target.id === 'claude-code'
                        ? { ...target, installed: true }
                        : target
                )),
            },
        ];

        const controller = createMcpSetupController({
            elements,
            getBridgeConnected: () => false,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
        });

        await controller.showMcpSetup();
        await elements.mcpInstallClaudeCodeButton.onclick();

        expect(invoke).toHaveBeenCalledWith('install_mcp_client', { target: 'claude-code' });
        expect(elements.mcpClientStatusClaudeCode.textContent).toBe('Installed');
        expect(elements.mcpInstallClaudeCodeButton.textContent).toBe('REINSTALL');
    });
});
