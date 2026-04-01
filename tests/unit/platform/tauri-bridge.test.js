import { createTauriBridgeController } from '../../../src/app/platform/tauri-bridge.js';

describe('platform/tauri-bridge', () => {
    it('reports non-tauri environments cleanly', async () => {
        const controller = createTauriBridgeController();

        expect(controller.isTauriEnvironment()).toBe(false);
        expect(controller.getTauriInvoker()).toBeNull();
        expect(await controller.ensureTauriBridge()).toEqual({
            invoke: null,
            listen: null,
        });
    });

    it('uses direct Tauri globals when present', () => {
        const invoke = vi.fn();
        const listen = vi.fn();
        window.__TAURI__ = {
            core: { invoke },
            event: { listen },
        };

        const controller = createTauriBridgeController();
        const resolvedInvoke = controller.getTauriInvoker();

        expect(controller.isTauriEnvironment()).toBe(true);
        resolvedInvoke('rav_status');
        expect(invoke).toHaveBeenCalledWith('rav_status');
    });

    it('prefers __TAURI_INTERNALS__ when available', async () => {
        const invoke = vi.fn();
        window.__TAURI_INTERNALS__ = { invoke };

        const controller = createTauriBridgeController();
        const resolvedInvoke = controller.getTauriInvoker();

        expect(controller.isTauriEnvironment()).toBe(true);
        resolvedInvoke('rav_open_file', { path: '/tmp/demo.riv' });
        expect(invoke).toHaveBeenCalledWith('rav_open_file', { path: '/tmp/demo.riv' });

        const bridge = await controller.ensureTauriBridge();
        expect(typeof bridge.invoke).toBe('function');
    });

    it('supports legacy window.__TAURI__.invoke', () => {
        const invoke = vi.fn();
        window.__TAURI__ = { invoke };

        const controller = createTauriBridgeController();
        const resolvedInvoke = controller.getTauriInvoker();

        resolvedInvoke('rav_status');
        expect(invoke).toHaveBeenCalledWith('rav_status');
    });

    it('falls back to __TAURI_IPC__ callbacks when needed', async () => {
        const controller = createTauriBridgeController();
        const ipc = vi.fn(({ callback }) => {
            window[callback]({ ok: true });
        });
        window.__TAURI_IPC__ = ipc;

        const invoke = controller.getTauriInvoker();
        const result = await invoke('read_file', { path: '/tmp/demo.riv' });

        expect(result).toEqual({ ok: true });
        expect(ipc).toHaveBeenCalledTimes(1);
        expect(ipc.mock.calls[0][0]).toMatchObject({
            cmd: 'read_file',
            path: '/tmp/demo.riv',
        });
    });

    it('rejects when the __TAURI_IPC__ error callback fires', async () => {
        const controller = createTauriBridgeController();
        const ipc = vi.fn(({ error }) => {
            window[error](new Error('IPC failure'));
        });
        window.__TAURI_IPC__ = ipc;

        const invoke = controller.getTauriInvoker();

        await expect(invoke('read_file', { path: '/tmp/fail.riv' })).rejects.toEqual(new Error('IPC failure'));
    });

    it('returns event listeners from direct globals', async () => {
        const listen = vi.fn();
        window.__TAURI__ = {
            event: { listen },
        };

        const controller = createTauriBridgeController();
        const eventListener = await controller.getTauriEventListener();

        expect(eventListener).toBeDefined();
        eventListener('open-file');
        expect(listen).toHaveBeenCalledWith('open-file');
    });

    it('returns null event listener when nothing is available', async () => {
        const controller = createTauriBridgeController();

        expect(await controller.getTauriEventListener()).toBeNull();
    });
});
