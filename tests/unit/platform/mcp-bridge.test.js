class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        this.onopen = null;
        FakeWebSocket.instances.push(this);
    }

    accept() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
    }

    fail() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
    }

    close() {
        this.fail();
    }

    send() {}
}

describe('platform/mcp-bridge', () => {
    it('retries quickly and reconnects immediately when focus returns', async () => {
        vi.resetModules();
        FakeWebSocket.instances = [];

        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
        window._mcpLogEvent = vi.fn();
        window._mcpUpdateStatus = vi.fn();

        await import('../../../mcp-bridge.js?test=bridge-reconnect');

        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(window._mcpBridge.state).toBe('waiting');

        FakeWebSocket.instances[0].fail();
        vi.advanceTimersByTime(1000);
        expect(FakeWebSocket.instances).toHaveLength(2);

        FakeWebSocket.instances[1].fail();
        window.dispatchEvent(new Event('focus'));
        expect(FakeWebSocket.instances).toHaveLength(3);

        FakeWebSocket.instances[2].accept();
        expect(window._mcpBridge.connected).toBe(true);
        expect(window._mcpUpdateStatus).toHaveBeenCalledWith('connected');
    });
});
