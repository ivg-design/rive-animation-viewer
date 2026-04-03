import { getElements } from '../../src/app/core/elements.js';
import { bindUiActionHandlers } from '../../src/app/ui/action-bindings.js';
import { createEventLogController } from '../../src/app/ui/event-log.js';
import { createMcpSetupController } from '../../src/app/ui/mcp-setup.js';
import { createTauriBridgeController } from '../../src/app/platform/tauri-bridge.js';

describe('frontend module smoke', () => {
    it('boots the extracted module set together against a minimal DOM shell', async () => {
        document.body.innerHTML = `
            <button id="file-trigger-btn"></button>
            <button id="reset-btn"></button>
            <button id="play-btn"></button>
            <button id="pause-btn"></button>
            <button id="demo-bundle-btn"></button>
            <button id="mcp-setup-btn"></button>
            <button id="inject-vm-explorer-btn"></button>
            <button id="apply-editor-config-btn"></button>
            <dialog id="mcp-setup-dialog"><button id="mcp-setup-close-btn"></button></dialog>
            <pre id="mcp-server-path-display"></pre>
            <div id="mcp-node-status"></div>
            <span id="mcp-node-label"></span>
            <p id="mcp-claude-desktop-copy"></p>
            <span id="mcp-client-status-codex"></span>
            <span id="mcp-client-status-claude-code"></span>
            <span id="mcp-client-status-claude-desktop"></span>
            <button id="mcp-install-codex-btn"></button>
            <button id="mcp-remove-codex-btn"></button>
            <button id="mcp-install-claude-code-btn"></button>
            <button id="mcp-remove-claude-code-btn"></button>
            <button id="mcp-install-claude-desktop-btn"></button>
            <button id="mcp-remove-claude-desktop-btn"></button>
            <pre id="snippet-claude-code"></pre>
            <pre id="snippet-claude-desktop"></pre>
            <pre id="snippet-codex"></pre>
            <pre id="snippet-generic"></pre>
            <div id="center-panel"></div>
            <div id="event-log-panel"></div>
            <div id="event-log-header"><div class="event-log-summary-left"></div></div>
            <button id="event-filter-native"></button>
            <button id="event-filter-rive-user"></button>
            <button id="event-filter-ui"></button>
            <button id="event-filter-mcp"></button>
            <input id="event-filter-search" />
            <button id="event-log-clear-btn"></button>
            <button id="show-event-log-btn"></button>
            <div id="event-log-count"></div>
            <div id="event-log-list"></div>
        `;

        const elements = getElements(document);
        elements.mcpSetupDialog.showModal = vi.fn();
        const handleResize = vi.fn();
        const actions = {
            handleFileButtonClick: vi.fn(),
            reset: vi.fn(),
            play: vi.fn(),
            pause: vi.fn(),
            createDemoBundle: vi.fn(),
            showMcpSetup: vi.fn(),
            injectCodeSnippet: vi.fn(),
            applyCodeAndReload: vi.fn(),
        };

        bindUiActionHandlers({ elements, actions });

        const eventLog = createEventLogController({ elements, handleResize });
        eventLog.setupEventLog();
        eventLog.logEvent('ui', 'ready', 'Smoke boot complete');

        const mcpSetup = createMcpSetupController({
            elements,
            getBridgeEnabled: () => true,
            getBridgeConnected: () => true,
            getTauriInvoker: () => vi.fn().mockImplementation(async (command) => {
                if (command === 'get_mcp_setup_status') {
                    return {
                        serverPath: '/tmp/rav-mcp',
                        port: 9274,
                        targets: [],
                    };
                }
                return null;
            }),
            initLucideIcons: vi.fn(),
        });
        await mcpSetup.showMcpSetup();

        const tauriBridge = createTauriBridgeController();

        expect(actions.handleFileButtonClick).not.toHaveBeenCalled();
        elements.fileTriggerButton.click();
        expect(actions.handleFileButtonClick).toHaveBeenCalledTimes(1);
        expect(eventLog.getEntriesSnapshot()).toHaveLength(1);
        expect(elements.eventLogList.textContent).toContain('Smoke boot complete');
        expect(elements.mcpSetupDialog.showModal).toHaveBeenCalledTimes(1);
        expect(tauriBridge.isTauriEnvironment()).toBe(false);
    });
});
