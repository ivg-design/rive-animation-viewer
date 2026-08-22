import { describe, expect, it, vi } from 'vitest';

const startApp = vi.fn();

vi.mock('../../src/app/platform/mcp/bridge-client.js', () => ({}));
vi.mock('../../src/app/bootstrap/startup.js', () => ({
    startApp,
}));
vi.mock('../../src/app/bootstrap/codemirror-loader.js', () => ({
    createCodeMirrorLoader: vi.fn(() => ({
        getModules: vi.fn(() => null),
        loadCodeMirror: vi.fn(async () => null),
    })),
}));
vi.mock('../../src/app/bootstrap/dom/dialogs.js', () => ({
    installAppDialogs: vi.fn(),
}));
vi.mock('../../src/app/bootstrap/instance-hooks.js', () => ({
    createInstanceHooks: vi.fn(() => ({
        cleanupInstance: vi.fn(),
        createDemoBundle: vi.fn(),
        getRiveInstance: vi.fn(),
        handleResize: vi.fn(),
        initLucideIcons: vi.fn(),
        loadRiveAnimation: vi.fn(),
        syncMcpPortFromDesktop: vi.fn(),
    })),
}));
vi.mock('../../src/app/bootstrap/status-helpers.js', () => ({
    createStatusHelpers: vi.fn(() => ({
        hideError: vi.fn(),
        refreshInfoStrip: vi.fn(),
        resolveAppVersion: vi.fn(),
        showError: vi.fn(),
        updateInfo: vi.fn(),
        updateVersionInfo: vi.fn(),
    })),
}));
vi.mock('../../src/app/bootstrap/stacks/controller-stack.js', () => ({
    createControllerStack: vi.fn(() => ({
        demoExportController: {},
        fileSessionController: {},
        globalBindingsController: { bind: vi.fn() },
        instanceController: {},
        instantiationControlsDialogController: {},
        shellController: {},
        statusController: {},
    })),
}));
vi.mock('../../src/app/core/canvas-sizing.js', () => ({
    loadCanvasSizingPreference: vi.fn(() => ({})),
    normalizeCanvasSizingState: vi.fn((value) => value),
    persistCanvasSizingPreference: vi.fn(),
}));
vi.mock('../../src/app/core/elements.js', () => ({
    getElements: vi.fn(() => ({})),
}));
vi.mock('../../src/app/platform/runtime/runtime-utils.js', () => ({
    buildFileRuntimePreferenceId: vi.fn(),
    loadRuntimeMeta: vi.fn(() => ({})),
    loadRuntimeVersionByFile: vi.fn(() => ({})),
    loadRuntimeVersionPreference: vi.fn(() => 'latest'),
}));
vi.mock('../../src/app/platform/session/file-session.js', () => ({
    normalizeOpenedFilePath: vi.fn((value) => value),
}));
vi.mock('../../src/app/platform/tauri-bridge.js', () => ({
    createTauriBridgeController: vi.fn(() => ({
        ensureTauriBridge: vi.fn(),
        getTauriEventListener: vi.fn(),
        getTauriInvoker: vi.fn(),
        isTauriEnvironment: vi.fn(() => false),
    })),
}));

describe('main entry startup smoke test', () => {
    it('imports the real entry module and reaches startApp', async () => {
        await import('../../src/app/main-entry.js');

        expect(startApp).toHaveBeenCalledOnce();
    });
});
