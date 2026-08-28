function FakeWebSocket(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.onopen = null;
    this.sent = [];
    FakeWebSocket.instances.push(this);
}

FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;
FakeWebSocket.instances = [];

FakeWebSocket.prototype.accept = function accept() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
};

FakeWebSocket.prototype.fail = function fail() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
};

FakeWebSocket.prototype.close = function close() {
    this.fail();
};

FakeWebSocket.prototype.send = function send(payload) {
    this.sent.push(payload);
};

async function flushBridgeMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('platform/mcp-bridge', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        FakeWebSocket.instances = [];
        window.localStorage?.clear?.();
        delete window._mcpBridge;
        delete window._mcpLogEvent;
        delete window._mcpUpdateStatus;
        delete window.__RAV_MCP_PORT__;
        delete window.__RAV_UPDATER_ACCEPTANCE__;
        delete window.__RAV_TELEMETRY_ACCEPTANCE__;
        delete window.__TAURI__;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('stays fully disconnected during updater acceptance', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        const invoke = vi.fn();
        window.__RAV_UPDATER_ACCEPTANCE__ = true;
        window.__TAURI__ = { core: { invoke } };

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-updater-acceptance');
        await flushBridgeMicrotasks();

        expect(window._mcpBridge.enabled).toBe(false);
        expect(window._mcpBridge.state).toBe('off');
        expect(FakeWebSocket.instances).toHaveLength(0);
        await expect(window._mcpBridge.disable()).resolves.toBe(true);
        window._mcpBridge.enable();
        await expect(window._mcpBridge.toggle()).resolves.toBe(false);
        await expect(window._mcpBridge.reconnect()).resolves.toBe(false);
        expect(window._mcpBridge.setPort(9999)).toBe(9274);
        expect(window._mcpBridge.enabled).toBe(false);
        expect(FakeWebSocket.instances).toHaveLength(0);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('stays fully disconnected during telemetry acceptance', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        const invoke = vi.fn();
        window.__RAV_TELEMETRY_ACCEPTANCE__ = true;
        window.__TAURI__ = { core: { invoke } };

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-telemetry-acceptance');
        await flushBridgeMicrotasks();

        expect(window._mcpBridge.enabled).toBe(false);
        expect(window._mcpBridge.state).toBe('off');
        expect(FakeWebSocket.instances).toHaveLength(0);
        await expect(window._mcpBridge.reconnect()).resolves.toBe(false);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('syncs the bridge port from desktop and reconnects quickly after disconnect', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window.__TAURI__ = {
            core: {
                invoke: vi.fn(async (command) => {
                    if (command === 'get_mcp_port') {
                        return 9411;
                    }
                    return null;
                }),
            },
        };
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-reconnect');
        await flushBridgeMicrotasks();

        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:9411');
        expect(window._mcpBridge.port).toBe(9411);

        FakeWebSocket.instances[0].fail();
        await vi.advanceTimersByTimeAsync(1000);
        await flushBridgeMicrotasks();

        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(FakeWebSocket.instances[1].url).toBe('ws://127.0.0.1:9411');
    });

    it('reconnects immediately when the configured port changes', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-port');
        await flushBridgeMicrotasks();

        expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:9274');
        window._mcpBridge.setPort(9310);
        await flushBridgeMicrotasks();
        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(FakeWebSocket.instances[1].url).toBe('ws://127.0.0.1:9310');
        expect(window._mcpBridge.port).toBe(9310);
    });

    it('restarts a pending reconnect attempt while desktop port sync is still pending', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());

        window.__TAURI__ = {
            core: {
                invoke: vi.fn((command) => {
                    if (command === 'get_mcp_port') {
                        return new Promise((resolve) => {
                            setTimeout(() => resolve(9274), 10);
                        });
                    }
                    return Promise.resolve(null);
                }),
            },
        };
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-dedup');
        await flushBridgeMicrotasks();
        expect(window._mcpBridge).toBeDefined();

        window._mcpBridge.reconnect();
        await flushBridgeMicrotasks();

        await vi.advanceTimersByTimeAsync(10);
        await flushBridgeMicrotasks();

        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(FakeWebSocket.instances[1].url).toBe('ws://127.0.0.1:9274');
    });

    it('blocks script execution tools when MCP script access is disabled', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-script-access');
        await flushBridgeMicrotasks();

        await expect(window._mcpBridge.commands.rav_eval({ expression: '1 + 1' }))
            .rejects.toThrow('MCP script access is disabled');

        window.__RAV_MCP_SCRIPT_ACCESS__ = true;
        await expect(window._mcpBridge.commands.rav_eval({ expression: '1 + 1' }))
            .resolves.toEqual({ result: 2 });
    });

    it('returns a bounded preview for riveInst results', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();
        window.__RAV_MCP_SCRIPT_ACCESS__ = true;

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-rive-preview');
        await flushBridgeMicrotasks();

        window.riveInst = {
            artboard: { name: 'Dashboard' },
            stateMachineNames: ['Main'],
            animationNames: ['idle'],
            isPlaying: true,
            isStopped: false,
            viewModelInstance: {},
        };

        await expect(window._mcpBridge.commands.rav_eval({ expression: 'window.riveInst' }))
            .resolves.toEqual({
                result: {
                    $type: 'RiveInstance',
                    animations: ['idle'],
                    artboard: 'Dashboard',
                    hasViewModel: true,
                    isPlaying: true,
                    isStopped: false,
                    stateMachines: ['Main'],
                },
            });
    });

    it('configures workspace state through the MCP bridge helpers', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();
        window._mcpGetSidebarVisibility = vi.fn(() => ({ left: false, right: true }));
        window._mcpSetSidebarVisibility = vi.fn((visibility) => ({ left: visibility.left ?? false, right: visibility.right ?? true }));
        window._mcpGetLiveConfigState = vi.fn(() => ({ sourceMode: 'internal', draftDirty: false }));
        window._mcpSetLiveConfigSource = vi.fn(async (sourceMode) => ({ sourceMode, draftDirty: false }));
        window._mcpGetVmExplorerSnippetState = vi.fn(() => ({ injected: false }));
        window._mcpSetVmExplorerSnippetEnabled = vi.fn(async (enabled) => ({ injected: enabled }));

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-configure-workspace');
        await flushBridgeMicrotasks();

        await expect(window._mcpBridge.commands.rav_configure_workspace({
            left_sidebar: 'open',
            right_sidebar: 'close',
            source_mode: 'editor',
            vm_explorer: 'inject',
        })).resolves.toEqual({
            sidebars: { left: true, right: false },
            sourceMode: 'editor',
            draftDirty: false,
            vmExplorerInjected: true,
        });
    });

    it('sets explicit canvas sizing through the MCP bridge helper surface', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();
        window._mcpSetCanvasSizing = vi.fn((canvasSizing) => ({
            mode: canvasSizing.mode || 'fixed',
            width: canvasSizing.width ?? 1600,
            height: canvasSizing.height ?? 900,
            lockAspectRatio: Boolean(canvasSizing.lockAspectRatio),
        }));

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-canvas-size');
        await flushBridgeMicrotasks();

        await expect(window._mcpBridge.commands.rav_set_canvas_size({
            mode: 'fixed',
            width: 1920,
            height: 1080,
            lockAspectRatio: true,
        })).resolves.toEqual({
            ok: true,
            canvasSize: {
                mode: 'fixed',
                width: 1920,
                height: 1080,
                lockAspectRatio: true,
            },
        });
    });

    it('decodes non-string websocket payloads and replies to bridge commands', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();
        const cyclicPayload = {};
        cyclicPayload.self = cyclicPayload;
        window._mcpGetEventLog = vi.fn(() => [{
            source: 'ui',
            type: 'info',
            message: 'hello',
            payload: cyclicPayload,
        }]);

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-non-string-payload');
        await flushBridgeMicrotasks();

        const socket = FakeWebSocket.instances[0];
        socket.accept();
        await flushBridgeMicrotasks();

        await socket.onmessage?.({
            data: {
                id: 'req-1',
                command: 'rav_get_event_log',
                params: { limit: 1 },
            },
        });
        await flushBridgeMicrotasks();

        const replyPayload = socket.sent.map((entry) => {
            try {
                return JSON.parse(entry);
            } catch {
                return null;
            }
        }).find((entry) => entry?.id === 'req-1');

        expect(replyPayload).toEqual({
            id: 'req-1',
            result: {
                entries: [{
                    source: 'ui',
                    type: 'info',
                    message: 'hello',
                    payload: { self: '[Circular]' },
                }],
                returned: 1,
                total: 1,
            },
        });
    });

    it('times out a stuck command and remains able to serve the next request', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();
        window._mcpConsoleRead = vi.fn()
            .mockImplementationOnce(() => new Promise(() => {}))
            .mockReturnValueOnce({ entries: [], returned: 0, total: 0 });

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-command-timeout');
        await flushBridgeMicrotasks();

        const socket = FakeWebSocket.instances[0];
        socket.accept();
        await flushBridgeMicrotasks();

        const first = socket.onmessage?.({
            data: { id: 'stuck-1', command: 'rav_console_read', params: {} },
        });
        await vi.advanceTimersByTimeAsync(20_000);
        await first;
        await flushBridgeMicrotasks();

        await socket.onmessage?.({
            data: { id: 'healthy-2', command: 'rav_console_read', params: {} },
        });
        await flushBridgeMicrotasks();

        const replies = socket.sent.map((entry) => {
            try { return JSON.parse(entry); } catch { return null; }
        }).filter((entry) => entry?.id);
        expect(replies).toEqual([
            { id: 'stuck-1', error: 'MCP command timed out before the app completed it.' },
            { id: 'healthy-2', result: { entries: [], returned: 0, total: 0 } },
        ]);
        expect(window._mcpBridge.connected).toBe(true);
    });

    it('stays green while ready, turns active only for recent commands, and resets the 30-second window', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();
        window._mcpGetEventLog = vi.fn(() => []);

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-indicator-state');
        await flushBridgeMicrotasks();

        const socket = FakeWebSocket.instances[0];
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('waiting');

        socket.accept();
        await flushBridgeMicrotasks();
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('idle');

        await socket.onmessage?.({
            data: {
                bridgeEvent: 'mcp-client-state',
                clientCount: 1,
                connected: true,
            },
        });
        await flushBridgeMicrotasks();
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('idle');

        await socket.onmessage?.({
            data: {
                id: 'status-1',
                command: 'rav_get_event_log',
                params: {},
            },
        });
        await flushBridgeMicrotasks();
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('active');

        await vi.advanceTimersByTimeAsync(20_000);
        expect(window._mcpBridge.indicatorState).toBe('active');

        await socket.onmessage?.({
            data: {
                id: 'status-2',
                command: 'rav_get_event_log',
                params: {},
            },
        });
        await flushBridgeMicrotasks();
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('active');

        await vi.advanceTimersByTimeAsync(29_999);
        expect(window._mcpBridge.indicatorState).toBe('active');

        await vi.advanceTimersByTimeAsync(1);
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('idle');
        expect(window._mcpBridge.indicatorState).toBe('idle');
    });

    it('reports an unexpected bridge failure as an error until reconnection succeeds', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-indicator-error');
        await flushBridgeMicrotasks();

        const socket = FakeWebSocket.instances[0];
        socket.accept();
        await flushBridgeMicrotasks();
        expect(window._mcpBridge.indicatorState).toBe('idle');

        socket.fail();
        await flushBridgeMicrotasks();
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('error');
        expect(window._mcpBridge.state).toBe('error');

        await vi.advanceTimersByTimeAsync(1_000);
        await flushBridgeMicrotasks();
        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('waiting');

        FakeWebSocket.instances[1].accept();
        await flushBridgeMicrotasks();
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('idle');
        expect(window._mcpBridge.state).toBe('connected');
    });

    it('ignores a delayed error from a socket that has already been replaced', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();

        await import('../../../src/app/platform/mcp/bridge-client.js?test=bridge-stale-error');
        await flushBridgeMicrotasks();

        const staleSocket = FakeWebSocket.instances[0];
        staleSocket.accept();
        await flushBridgeMicrotasks();
        expect(window._mcpBridge.indicatorState).toBe('idle');

        await window._mcpBridge.reconnect();
        await flushBridgeMicrotasks();
        const liveSocket = FakeWebSocket.instances[1];
        liveSocket.accept();
        await flushBridgeMicrotasks();
        expect(window._mcpBridge.connected).toBe(true);
        expect(window._mcpBridge.indicatorState).toBe('idle');

        staleSocket.onerror?.(new Event('error'));
        await flushBridgeMicrotasks();

        expect(window._mcpBridge.connected).toBe(true);
        expect(window._mcpBridge.state).toBe('connected');
        expect(window._mcpBridge.indicatorState).toBe('idle');
        expect(window._mcpUpdateStatus).toHaveBeenLastCalledWith('idle');
    });
});
