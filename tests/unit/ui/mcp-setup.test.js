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
    it('populates setup snippets and shows the dialog', async () => {
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: clipboardWrite },
        });
        const elements = buildElements();
        const controller = createMcpSetupController({
            elements,
            getBridgeConnected: () => true,
            getTauriInvoker: () => vi.fn().mockResolvedValue('/Applications/RAV/resources/rav-mcp-server.js'),
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

    it('shows a Node install hint when the bridge is not connected', async () => {
        const elements = buildElements();
        const controller = createMcpSetupController({
            elements,
            getBridgeConnected: () => false,
            getTauriInvoker: () => null,
            initLucideIcons: vi.fn(),
        });

        await controller.showMcpSetup();

        expect(elements.mcpNodeLabel.innerHTML).toContain('Node.js: not detected');
        expect(elements.mcpNodeStatus.querySelector('a')?.href).toContain('https://nodejs.org');
    });
});
