import { createMcpSetupController } from '../../../src/app/ui/mcp-setup.js';
import { createUiOverlayController } from '../../../src/app/ui/overlay/controller.js';

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
        <input id="mcp-port-input" value="9274">
        <button id="mcp-port-apply-btn">SET</button>
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
        mcpPortInput: document.getElementById('mcp-port-input'),
        mcpPortApplyButton: document.getElementById('mcp-port-apply-btn'),
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
        serverPath: '/Applications/Rive Animation Viewer.app/Contents/MacOS/rav-mcp',
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
            windowRef: { setTimeout: (callback) => { callback(); return 1; } },
        });

        await controller.showMcpSetup();
        await Promise.resolve();

        expect(elements.mcpServerPathDisplay.textContent).toContain('rav-mcp');
        expect(elements.snippetClaudeCode.textContent).toContain('"args":["--stdio-only","--port","9411"]');
        expect(elements.snippetClaudeDesktop.textContent).toContain('"command": "/Applications/Rive Animation Viewer.app/Contents/MacOS/rav-mcp"');
        expect(elements.snippetCodex.textContent).toContain('args = ["--stdio-only","--port","9411"]');
        expect(elements.mcpNodeLabel.textContent).toBe('MCP ready');
        expect(elements.mcpClientStatusCodex.textContent).toBe('Installed');
        expect(elements.mcpClientStatusClaudeCode.textContent).toBe('Installed');
        expect(elements.mcpClientStatusClaudeDesktop.textContent).toBe('Not detected');
        expect(elements.mcpRemoveCodexButton.hidden).toBe(false);
        expect(elements.mcpRemoveClaudeDesktopButton.hidden).toBe(true);
        expect(elements.mcpInstallClaudeDesktopButton.disabled).toBe(true);
        expect(elements.mcpSetupDialog.showModal).toHaveBeenCalledTimes(1);

        document.querySelector('.mcp-copy-btn').click();
        await Promise.resolve();
        expect(clipboardWrite).toHaveBeenCalledWith(elements.snippetClaudeCode.textContent);
    });

    it('shows the browser bridge status and actual port without claiming its desktop sidecar is missing', async () => {
        const elements = buildElements();
        const controller = createMcpSetupController({
            elements,
            getBridgeConnected: () => true,
            getBridgeEnabled: () => true,
            getBridgePort: () => 9278,
            getTauriInvoker: () => null,
            initLucideIcons: vi.fn(),
            isDesktop: () => false,
            windowRef: { setTimeout: (callback) => { callback(); return 1; } },
        });

        await controller.showMcpSetup();
        await Promise.resolve();

        expect(elements.mcpNodeLabel.textContent).toBe('Local MCP bridge ready');
        expect(elements.mcpNodeStatus.classList.contains('is-connected')).toBe(true);
        expect(elements.mcpNodeStatus.classList.contains('is-missing')).toBe(false);
        expect(elements.mcpPortInput.value).toBe('9278');
    });

    it('shows a neutral waiting state when the browser bridge has not connected yet', async () => {
        const elements = buildElements();
        const controller = createMcpSetupController({
            elements,
            getBridgeConnected: () => false,
            getBridgeEnabled: () => true,
            getBridgePort: () => 9278,
            getTauriInvoker: () => null,
            initLucideIcons: vi.fn(),
            isDesktop: () => false,
            windowRef: { setTimeout: (callback) => { callback(); return 1; } },
        });

        await controller.showMcpSetup();
        await Promise.resolve();

        expect(elements.mcpNodeLabel.textContent).toBe('Waiting for local MCP bridge...');
        expect(elements.mcpNodeStatus.classList.contains('is-missing')).toBe(false);
        expect(elements.mcpPortInput.value).toBe('9278');
    });

    it('retries a transient startup status failure without reporting the bundled sidecar missing', async () => {
        const elements = buildElements();
        const retryCallbacks = [];
        let overlayDefinition;
        const invoke = vi.fn()
            .mockRejectedValueOnce(new Error('IPC command is not available yet'))
            .mockResolvedValueOnce(mockSetupStatus());
        const controller = createMcpSetupController({
            elements,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
            requestUiOverlay: vi.fn(async (definition) => {
                overlayDefinition = definition;
                return true;
            }),
            windowRef: {
                setTimeout: (callback) => {
                    retryCallbacks.push(callback);
                    return retryCallbacks.length;
                },
            },
        });

        const opening = controller.showMcpSetup();
        await vi.waitFor(() => expect(retryCallbacks).toHaveLength(1));

        expect(elements.mcpNodeLabel.textContent).toBe('Checking bundled MCP sidecar...');
        expect(elements.mcpNodeStatus.classList.contains('is-missing')).toBe(false);

        retryCallbacks.shift()();
        await opening;

        expect(invoke).toHaveBeenCalledTimes(2);
        expect(elements.mcpNodeLabel.textContent).toBe('MCP ready');
        expect(overlayDefinition.getState().node).toEqual(expect.objectContaining({
            label: 'MCP ready',
            path: expect.stringContaining('/rav-mcp'),
        }));
    });

    it('keeps an unavailable setup service neutral after retries are exhausted', async () => {
        const elements = buildElements();
        const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const invoke = vi.fn().mockRejectedValue(new Error('IPC command is not available yet'));
        const controller = createMcpSetupController({
            elements,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
            requestUiOverlay: vi.fn().mockResolvedValue(true),
            windowRef: { setTimeout: (callback) => { callback(); return 1; } },
        });

        await controller.showMcpSetup();

        expect(invoke).toHaveBeenCalledTimes(5);
        expect(elements.mcpNodeLabel.textContent).toBe('Checking bundled MCP sidecar...');
        expect(elements.mcpNodeStatus.classList.contains('is-missing')).toBe(false);
        expect(consoleWarning).toHaveBeenCalledTimes(1);
    });

    it('reports the bundled sidecar missing only after the native path check confirms it', async () => {
        const elements = buildElements();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const invoke = vi.fn().mockRejectedValue(
            new Error('MCP server not found beside the application executable: /Applications/RAV.app/Contents/MacOS/rav-mcp'),
        );
        const controller = createMcpSetupController({
            elements,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
            requestUiOverlay: vi.fn().mockResolvedValue(true),
            windowRef: { setTimeout: (callback) => { callback(); return 1; } },
        });

        await controller.showMcpSetup();

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(elements.mcpNodeLabel.textContent).toBe('Bundled MCP sidecar not found beside the app executable');
        expect(elements.mcpNodeStatus.classList.contains('is-missing')).toBe(true);
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
            windowRef: { setTimeout: (callback) => { callback(); return 1; } },
        });

        await controller.showMcpSetup();
        await Promise.resolve();
        expect(elements.mcpNodeLabel.textContent).toBe('MCP disabled');

        await elements.mcpInstallClaudeCodeButton.onclick();
        await Promise.resolve();
        expect(invoke).toHaveBeenCalledWith('install_mcp_client', { target: 'claude-code', port: 9411 });
        expect(elements.mcpClientStatusClaudeCode.textContent).toBe('Installed');

        await elements.mcpRemoveCodexButton.onclick();
        await Promise.resolve();
        expect(invoke).toHaveBeenCalledWith('remove_mcp_client', { target: 'codex' });
        expect(elements.mcpClientStatusCodex.textContent).toBe('Detected');
        expect(elements.mcpRemoveCodexButton.hidden).toBe(true);
    });

    it('preserves an MCP port draft in the state captured for a restack', async () => {
        const elements = buildElements();
        let overlayDefinition;
        const invoke = vi.fn(async (command) => (
            command === 'get_mcp_setup_status' ? mockSetupStatus() : null
        ));
        const controller = createMcpSetupController({
            elements,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
            requestUiOverlay: vi.fn(async (definition) => {
                overlayDefinition = definition;
                return true;
            }),
            windowRef: { localStorage: window.localStorage, setTimeout: (callback) => { callback(); return 1; } },
        });

        await controller.showMcpSetup();
        await overlayDefinition.handleAction({ action: 'port-draft', value: '9555draft' });
        expect(overlayDefinition.getState().node).toEqual(expect.objectContaining({
            portDraft: '9555draft',
        }));
    });

    it('waits for the native port receipt before the MCP overlay action completes', async () => {
        const elements = buildElements();
        let resolvePort;
        let overlayDefinition;
        const invoke = vi.fn((command) => {
            if (command === 'get_mcp_setup_status') {
                return Promise.resolve({ ...mockSetupStatus(), port: invoke.port || 9411 });
            }
            if (command === 'set_mcp_port') {
                return new Promise((resolve) => { resolvePort = resolve; });
            }
            return Promise.resolve(null);
        });
        const controller = createMcpSetupController({
            elements,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
            requestUiOverlay: async (definition) => {
                overlayDefinition = definition;
                return true;
            },
        });

        await controller.showMcpSetup();
        const applying = overlayDefinition.handleAction({ action: 'port-apply', value: '9555' });
        await vi.waitFor(() => expect(resolvePort).toBeTypeOf('function'));
        expect(invoke).toHaveBeenCalledWith('set_mcp_port', { port: 9555 });
        expect(invoke.mock.calls.filter(([command]) => command === 'get_mcp_setup_status')).toHaveLength(1);

        invoke.port = 9555;
        resolvePort(9555);
        await expect(applying).resolves.toBeNull();
        expect(elements.mcpPortInput.value).toBe('9555');
        expect(invoke.mock.calls.filter(([command]) => command === 'get_mcp_setup_status')).toHaveLength(2);
    });

    it('rejects unsuccessful MCP overlay operations and unavailable clipboard payloads', async () => {
        const elements = buildElements();
        let overlayDefinition;
        const clipboardWrite = vi.fn().mockRejectedValue(new Error('Clipboard blocked'));
        const invoke = vi.fn(async (command) => {
            if (command === 'get_mcp_setup_status') return mockSetupStatus();
            if (command === 'set_mcp_port') throw new Error('Port restart failed');
            if (command === 'install_mcp_client') return { installed: false };
            if (command === 'remove_mcp_client') return { installed: true };
            return null;
        });
        const controller = createMcpSetupController({
            elements,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
            requestUiOverlay: async (definition) => {
                overlayDefinition = definition;
                return true;
            },
            windowRef: { navigator: { clipboard: { writeText: clipboardWrite } } },
        });

        await controller.showMcpSetup();
        await expect(overlayDefinition.handleAction({ action: 'port-apply', value: '9555' }))
            .rejects.toThrow('Port restart failed');
        await expect(overlayDefinition.handleAction({ action: 'client-install', value: 'codex' }))
            .rejects.toThrow('did not confirm installation');
        await expect(overlayDefinition.handleAction({ action: 'client-remove', value: 'codex' }))
            .rejects.toThrow('did not confirm removal');
        await expect(overlayDefinition.handleAction({ action: 'copy', value: 'missing-target' }))
            .rejects.toThrow('configuration is unavailable');
        await expect(overlayDefinition.handleAction({ action: 'copy', value: 'codex' }))
            .rejects.toThrow('Clipboard blocked');
    });

    it('reports a failed MCP overlay action with a failed native completion receipt', async () => {
        const elements = buildElements();
        const listeners = new Map();
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 17;
            if (command === 'get_mcp_setup_status') return mockSetupStatus();
            if (command === 'set_mcp_port') throw new Error('Port restart failed');
            return null;
        });
        const overlayController = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'mcp-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            windowRef: window,
        });
        const controller = createMcpSetupController({
            elements,
            getTauriInvoker: () => invoke,
            initLucideIcons: vi.fn(),
            requestUiOverlay: (definition) => overlayController.openPurpose(definition),
            windowRef: window,
        });

        await overlayController.setup();
        await controller.showMcpSetup();
        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'port-apply',
                actionId: '17-1',
                epoch: 17,
                purpose: 'mcp',
                requestToken: 'mcp-overlay-token',
                value: '9555',
            },
        });

        expect(invoke).toHaveBeenCalledWith('complete_ui_overlay_action', {
            actionId: '17-1',
            epoch: 17,
            message: 'Port restart failed',
            ok: false,
        });
        overlayController.dispose();
    });
});
