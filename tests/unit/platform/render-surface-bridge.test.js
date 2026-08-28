import { createRenderSurfaceBridgeHandlers } from '../../../src/app/platform/render-surface/controller/bridge.js';

function createHandlers({ active = true } = {}) {
    const onChildPointerDown = vi.fn();
    const handlers = createRenderSurfaceBridgeHandlers({
        clearLoadTimeout: vi.fn(),
        documentRef: document,
        fatalRecovery: { canAcceptCommands: () => true, handleActiveFailure: vi.fn() },
        getActiveSessionId: () => 'active',
        invokeQuietly: vi.fn(async () => true),
        isDisposed: () => false,
        logEvent: vi.fn(),
        onChildPointerDown,
        protocol: {
            handleReady: vi.fn(),
            matches: () => false,
            matchesActive: () => active,
            quarantineSession: vi.fn(),
        },
        rejectStagedSession: vi.fn(),
        setStagedReady: vi.fn(),
    });
    return { handlers, onChildPointerDown };
}

describe('render surface bridge handlers', () => {
    it('relays pointerdown only from the active authoritative child', () => {
        const accepted = createHandlers({ active: true });
        accepted.handlers.handleChildPointerDown({ payload: { pointerType: 'mouse', sessionId: 'active' } });
        expect(accepted.onChildPointerDown).toHaveBeenCalledWith(expect.objectContaining({ pointerType: 'mouse' }));

        const stale = createHandlers({ active: false });
        stale.handlers.handleChildPointerDown({ payload: { pointerType: 'mouse', sessionId: 'stale' } });
        expect(stale.onChildPointerDown).not.toHaveBeenCalled();
    });
});
