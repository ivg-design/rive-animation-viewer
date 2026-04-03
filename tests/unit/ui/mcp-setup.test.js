import { createMcpSetupController } from '../../../src/app/ui/mcp-setup.js';

function buildElements() {
    document.body.innerHTML = `
        <dialog id="mcp-setup-dialog">
            <button class="mcp-copy-btn" data-target="snippet-claude-code">COPY</button>
            <button id="mcp-install-codex-btn" data-install-target="codex">INSTALL</button>
            <button id="mcp-remove-codex-btn" data-remove-target="codex">REMOVE</button>
            <button id="mcp-install-claude-code-btn" data-install-target="claude-code">INSTALL</button>
            <button id="mcp-remove-claude-code-btn" data-remove-target="claude-code">REMOVE</button>
            <button id="mcp-install-claude-desktop-btn" data-install-target="claude-desktop">INSTALL</button>
            <button id="mcp-remove-claude-desktop-btn" data-remove-target="claude-desktop">REMOVE</button>
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
        mcpRemoveCodexButton: document.getElementById('mcp-remove-codex-btn'),
        mcpInstallClaudeCodeButton: document.getElementById('mcp-install-claude-code-btn'),
        mcpRemoveClaudeCodeButton: document.getElementById('mcp-remove-claude-code-btn'),
        mcpInstallClaudeDesktopButton: document.getElementById('mcp-install-claude-desktop-btn'),
        mcpRemoveClaudeDesktopButton: document.getElementById('mcp-remove-claude-desktop-btn'),
        snippetClaudeCode: document.getElementById('snippet-claude-code'),
        snippetClaudeDesktop: document.getElementById('snippet-claude-desktop'),
        snippetCodex: document.getElementById('snippet-codex'),
        snippetGeneric: document.getElementById('snippet-generic'),
    };
}

function mockSetupStatus() {
    return {
        port: 9411,
        serverPath: '/Applications/RAV/resources/rav-mcp',
        targets: [
            {
                id: 'codex',
                label: 'Codex',
                available: true,
                installed: true,
                configured: true,
                detail: 'Shared Codex config for CLI/Desktop',
                configPath: '/Users/test/.codex/config.toml',
            },
            {
                id: 'claude-code',
                label: 'Claude Code',
                available: true,
                installed: true,
                configured: false,
                detail: 'Uses claude mcp add-json in user scope',
                cliPath: '/usr/local/bin/claude',
            },
            {
                id: 'claude-desktop',
                label: 'Claude Desktop',
                available: false,
                installed: false,
                configured: false,
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
            getBridgeEnabled: () => true,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
        });

        await controller.showMcpSetup();

        expect(elements.mcpServerPathDisplay.textContent).toContain('rav-mcp');
        expect(elements.snippetClaudeCode.textContent).toContain('"args":["--stdio-only","--port","9411"]');
        expect(elements.snippetClaudeDesktop.textContent).toContain('"command": "/Applications/RAV/resources/rav-mcp"');
        expect(elements.snippetCodex.textContent).toContain('args = ["--stdio-only","--port","9411"]');
        expect(elements.mcpNodeLabel.textContent).toBe('MCP ready');
        expect(elements.mcpClientStatusCodex.textContent).toBe('Installed');
        expect(elements.mcpClientStatusClaudeCode.textContent).toBe('Needs Reinstall');
        expect(elements.mcpClientStatusClaudeDesktop.textContent).toBe('Not detected');
        expect(elements.mcpRemoveCodexButton.hidden).toBe(false);
        expect(elements.mcpRemoveClaudeDesktopButton.hidden).toBe(true);
        expect(elements.mcpInstallClaudeDesktopButton.disabled).toBe(true);
        expect(elements.mcpSetupDialog.showModal).toHaveBeenCalledTimes(1);

        document.querySelector('.mcp-copy-btn').click();
        await Promise.resolve();
        expect(clipboardWrite).toHaveBeenCalledWith(elements.snippetClaudeCode.textContent);
    });

    it('shows disabled copy and supports install/remove actions', async () => {
        const elements = buildElements();
        const invoke = vi.fn(async (command, args) => {
            if (command === 'get_mcp_setup_status') {
                return invoke.statuses.shift();
            }
            if (command === 'install_mcp_client') {
                return { installed: true, target: args.target };
            }
            if (command === 'remove_mcp_client') {
                return { installed: false, target: args.target };
            }
            return null;
        });
        invoke.statuses = [
            mockSetupStatus(),
            {
                ...mockSetupStatus(),
                targets: mockSetupStatus().targets.map((target) => (
                    target.id === 'claude-code'
                        ? { ...target, configured: true }
                        : target
                )),
            },
            {
                ...mockSetupStatus(),
                targets: mockSetupStatus().targets.map((target) => (
                    target.id === 'codex'
                        ? { ...target, installed: false, configured: false }
                        : target
                )),
            },
        ];

        const controller = createMcpSetupController({
            elements,
            getBridgeEnabled: () => false,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
        });

        await controller.showMcpSetup();
        expect(elements.mcpNodeLabel.textContent).toBe('MCP disabled');

        await elements.mcpInstallClaudeCodeButton.onclick();
        expect(invoke).toHaveBeenCalledWith('install_mcp_client', { target: 'claude-code', port: 9411 });
        expect(elements.mcpClientStatusClaudeCode.textContent).toBe('Installed');

        await elements.mcpRemoveCodexButton.onclick();
        expect(invoke).toHaveBeenCalledWith('remove_mcp_client', { target: 'codex' });
        expect(elements.mcpClientStatusCodex.textContent).toBe('Detected');
        expect(elements.mcpRemoveCodexButton.hidden).toBe(true);
    });
});
