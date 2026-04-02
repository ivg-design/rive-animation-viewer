import { createMcpSetupController } from '../../../src/app/ui/mcp-setup.js';

function buildElements() {
    document.body.innerHTML = `
        <dialog id="mcp-setup-dialog">
            <button class="mcp-copy-btn" data-target="snippet-claude-code">COPY</button>
        </dialog>
        <pre id="mcp-server-path-display"></pre>
        <div id="mcp-node-status"></div>
        <span id="mcp-node-label"></span>
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
        snippetClaudeCode: document.getElementById('snippet-claude-code'),
        snippetClaudeDesktop: document.getElementById('snippet-claude-desktop'),
        snippetCodex: document.getElementById('snippet-codex'),
        snippetGeneric: document.getElementById('snippet-generic'),
    };
}

describe('ui/mcp-setup', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('populates setup snippets and shows the dialog', async () => {
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: clipboardWrite },
        });
        const elements = buildElements();
        const invoke = vi.fn(async (command) => {
            if (command === 'get_mcp_server_path') {
                return '/Applications/RAV/resources/rav-mcp-server.js';
            }
            if (command === 'detect_node_runtime') {
                return {
                    installed: true,
                    path: '/opt/homebrew/bin/node',
                    version: 'v25.8.0',
                };
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

        expect(elements.mcpServerPathDisplay.textContent).toContain('rav-mcp-server.js');
        expect(elements.snippetClaudeCode.textContent).toContain('claude mcp add rav-mcp node');
        expect(elements.snippetCodex.textContent).toContain('"transport": "stdio"');
        expect(elements.mcpNodeLabel.textContent).toContain('installed');
        expect(elements.mcpSetupDialog.showModal).toHaveBeenCalledTimes(1);

        document.querySelector('.mcp-copy-btn').click();
        await Promise.resolve();
        expect(clipboardWrite).toHaveBeenCalledWith(elements.snippetClaudeCode.textContent);
    });

    it('shows detected Node details even when the MCP bridge is not connected', async () => {
        const elements = buildElements();
        const invoke = vi.fn(async (command) => {
            if (command === 'detect_node_runtime') {
                return {
                    installed: true,
                    path: '/opt/homebrew/bin/node',
                    version: 'v25.8.0',
                };
            }
            return null;
        });
        const controller = createMcpSetupController({
            elements,
            getBridgeConnected: () => false,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
        });

        await controller.showMcpSetup();

        expect(elements.mcpNodeLabel.textContent).toContain('Node.js: installed');
        expect(elements.mcpNodeLabel.textContent).toContain('/opt/homebrew/bin/node');
        expect(elements.mcpNodeStatus.classList.contains('is-installed')).toBe(true);
    });

    it('opens the installer URL when Node is missing and refreshes on subsequent opens', async () => {
        const elements = buildElements();
        const invoke = vi.fn(async (command, args) => {
            if (command === 'detect_node_runtime') {
                return invoke.detected.shift();
            }
            if (command === 'open_external_url') {
                return args.url;
            }
            return null;
        });
        invoke.detected = [
            { installed: false, path: null, version: null },
            { installed: true, path: '/usr/local/bin/node', version: 'v22.0.0' },
        ];
        const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
        const controller = createMcpSetupController({
            elements,
            getBridgeConnected: () => false,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
        });

        await controller.showMcpSetup();
        const link = elements.mcpNodeStatus.querySelector('a');
        expect(elements.mcpNodeLabel.innerHTML).toContain('Node.js: not detected');
        expect(link?.href).toContain('https://nodejs.org/en/download');

        link.click();
        await Promise.resolve();
        expect(invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://nodejs.org/en/download' });
        expect(windowOpen).not.toHaveBeenCalled();

        await controller.showMcpSetup();
        expect(elements.mcpNodeLabel.textContent).toContain('/usr/local/bin/node');
    });
});
