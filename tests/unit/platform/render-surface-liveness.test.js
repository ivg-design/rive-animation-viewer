import {
    createRenderSurfaceLivenessGuard,
    createRenderSurfaceLivenessMonitor,
    RENDER_SURFACE_FRAME_ACTIVITY_TIMEOUT_MS,
} from '../../../src/app/platform/render-surface/controller/liveness.js';

describe('render surface frame activity monitor', () => {
    it('recovers once when an active playing child stops emitting frame receipts', () => {
        const onStalled = vi.fn();
        let activeSessionId = 'playing';
        let playing = true;
        const monitor = createRenderSurfaceLivenessMonitor({
            getActiveSessionId: () => activeSessionId,
            isPlaybackExpected: (sessionId) => playing && sessionId === activeSessionId,
            onStalled,
            timeoutMs: 3_500,
            windowRef: window,
        });

        expect(monitor.reconcile()).toBe(true);
        vi.advanceTimersByTime(3_000);
        expect(monitor.acceptMetrics({ sessionId: 'playing' })).toBe(true);
        vi.advanceTimersByTime(3_499);
        expect(onStalled).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onStalled).toHaveBeenCalledOnce();
        expect(onStalled).toHaveBeenCalledWith('playing');

        vi.advanceTimersByTime(10_000);
        expect(onStalled).toHaveBeenCalledOnce();
        playing = false;
        activeSessionId = 'paused';
        expect(monitor.reconcile()).toBe(false);
        vi.advanceTimersByTime(10_000);
        expect(onStalled).toHaveBeenCalledOnce();
    });

    it('ignores stale-session receipts and disarms as soon as playback pauses', () => {
        const onStalled = vi.fn();
        let playing = true;
        const monitor = createRenderSurfaceLivenessMonitor({
            getActiveSessionId: () => 'active',
            isPlaybackExpected: () => playing,
            onStalled,
            timeoutMs: 1_000,
            windowRef: window,
        });

        monitor.reconcile();
        expect(monitor.acceptMetrics({ sessionId: 'retired' })).toBe(false);
        playing = false;
        expect(monitor.reconcile()).toBe(false);
        vi.advanceTimersByTime(2_000);
        expect(onStalled).not.toHaveBeenCalled();
    });
});

describe('render surface liveness focus policy', () => {
    it('stands down while fixed-step media capture owns renderer advancement', () => {
        const windowRef = new EventTarget();
        windowRef.setTimeout = window.setTimeout.bind(window);
        windowRef.clearTimeout = window.clearTimeout.bind(window);
        const documentRef = new EventTarget();
        documentRef.hasFocus = () => true;
        Object.defineProperty(documentRef, 'visibilityState', { get: () => 'visible' });
        const handleActiveFailure = vi.fn();
        const guard = createRenderSurfaceLivenessGuard({
            documentRef,
            fatalRecovery: { canAcceptCommands: () => true, handleActiveFailure },
            getActiveSessionId: () => 'active',
            isDisposed: () => false,
            isLoaded: () => true,
            logEvent: vi.fn(),
            protocol: {
                getState: () => ({ canonicalState: {
                    playback: { isPlaying: true }, sessionId: 'active',
                } }),
                quarantineSession: vi.fn(),
            },
            windowRef,
        });

        expect(guard.reconcile()).toBe(true);
        guard.setSuspended(true);
        vi.advanceTimersByTime(RENDER_SURFACE_FRAME_ACTIVITY_TIMEOUT_MS * 2);
        expect(handleActiveFailure).not.toHaveBeenCalled();
        expect(guard.getState().armed).toBe(false);

        guard.setSuspended(false);
        vi.advanceTimersByTime(RENDER_SURFACE_FRAME_ACTIVITY_TIMEOUT_MS);
        expect(handleActiveFailure).toHaveBeenCalledOnce();
        guard.dispose();
    });

    it('does not replace a renderer while Rive is intentionally visibility-paused', () => {
        const windowRef = new EventTarget();
        windowRef.setTimeout = window.setTimeout.bind(window);
        windowRef.clearTimeout = window.clearTimeout.bind(window);
        const documentRef = new EventTarget();
        let focused = true;
        let visibilityState = 'visible';
        documentRef.hasFocus = () => focused;
        Object.defineProperty(documentRef, 'visibilityState', {
            configurable: true,
            get: () => visibilityState,
        });
        const handleActiveFailure = vi.fn();
        const canonicalState = {
            playback: { isPlaying: true },
            sessionId: 'active',
        };
        const guard = createRenderSurfaceLivenessGuard({
            documentRef,
            fatalRecovery: {
                canAcceptCommands: () => true,
                handleActiveFailure,
            },
            getActiveSessionId: () => 'active',
            isDisposed: () => false,
            isLoaded: () => true,
            logEvent: vi.fn(),
            protocol: {
                getState: () => ({ canonicalState }),
                quarantineSession: vi.fn(),
            },
            windowRef,
        });

        expect(guard.reconcile()).toBe(true);
        focused = false;
        windowRef.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(10_000);
        expect(handleActiveFailure).not.toHaveBeenCalled();

        visibilityState = 'hidden';
        documentRef.dispatchEvent(new Event('visibilitychange'));
        focused = true;
        windowRef.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(10_000);
        expect(handleActiveFailure).not.toHaveBeenCalled();

        visibilityState = 'visible';
        documentRef.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(RENDER_SURFACE_FRAME_ACTIVITY_TIMEOUT_MS);
        expect(handleActiveFailure).toHaveBeenCalledOnce();
        guard.dispose();
    });

    it('disarms while a blocking overlay deliberately parks the playback surface', () => {
        const windowRef = new EventTarget();
        windowRef.setTimeout = window.setTimeout.bind(window);
        windowRef.clearTimeout = window.clearTimeout.bind(window);
        const documentRef = new EventTarget();
        documentRef.hasFocus = () => true;
        Object.defineProperty(documentRef, 'visibilityState', { get: () => 'visible' });
        let presented = true;
        const handleActiveFailure = vi.fn();
        const guard = createRenderSurfaceLivenessGuard({
            documentRef,
            fatalRecovery: { canAcceptCommands: () => true, handleActiveFailure },
            getActiveSessionId: () => 'active',
            isDisposed: () => false,
            isLoaded: () => true,
            isSurfacePresented: () => presented,
            logEvent: vi.fn(),
            protocol: {
                getState: () => ({ canonicalState: {
                    playback: { isPlaying: true }, sessionId: 'active',
                } }),
                quarantineSession: vi.fn(),
            },
            windowRef,
        });

        expect(guard.reconcile()).toBe(true);
        presented = false;
        vi.advanceTimersByTime(RENDER_SURFACE_FRAME_ACTIVITY_TIMEOUT_MS);
        expect(handleActiveFailure).not.toHaveBeenCalled();
        expect(guard.getState().armed).toBe(false);

        presented = true;
        expect(guard.reconcile()).toBe(true);
        vi.advanceTimersByTime(RENDER_SURFACE_FRAME_ACTIVITY_TIMEOUT_MS);
        expect(handleActiveFailure).toHaveBeenCalledOnce();
        guard.dispose();
    });
});
