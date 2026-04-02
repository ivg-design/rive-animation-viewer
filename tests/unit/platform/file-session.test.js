import {
    createFileSessionController,
    extractOpenedFilePath,
    getFileNameFromPath,
    normalizeOpenedFilePath,
} from '../../../src/app/platform/file-session.js';

function createElements() {
    document.body.innerHTML = `
        <input id="file-input" />
        <button id="file-trigger-btn" class="btn-dark btn-muted"></button>
        <div id="canvas-container"></div>
    `;

    return {
        canvasContainer: document.getElementById('canvas-container'),
        fileInput: document.getElementById('file-input'),
        fileTriggerButton: document.getElementById('file-trigger-btn'),
    };
}

describe('platform/file-session', () => {
    it('extracts and normalizes opened file paths', () => {
        expect(extractOpenedFilePath({ paths: ['  /tmp/demo.riv  '] })).toBe('/tmp/demo.riv');
        expect(normalizeOpenedFilePath('file:///Users/test/demo.riv')).toBe('/Users/test/demo.riv');
        expect(getFileNameFromPath('/Users/test/demo.riv')).toBe('demo.riv');
    });

    it('tracks file state, loads a .riv from disk, and clears the session', async () => {
        const elements = createElements();
        const createObjectURL = vi.fn(() => 'blob:demo');
        const revokeObjectURL = vi.fn();
        const loadRiveAnimation = vi.fn().mockResolvedValue(undefined);
        const applyStoredRuntimeVersionForCurrentFile = vi.fn().mockResolvedValue(undefined);
        const controller = createFileSessionController({
            callbacks: {
                applyStoredRuntimeVersionForCurrentFile,
                buildFileRuntimePreferenceId: vi.fn(() => 'pref-1'),
                cleanupInstance: vi.fn(),
                ensureTauriBridge: vi.fn().mockResolvedValue(undefined),
                getTauriInvoker: () => vi.fn(async (command) => {
                    if (command === 'get_opened_file') {
                        return '/tmp/demo.riv';
                    }
                    if (command === 'read_riv_file') {
                        return 'AQI=';
                    }
                    return null;
                }),
                hideError: vi.fn(),
                initLucideIcons: vi.fn(),
                isTauriEnvironment: () => true,
                loadRiveAnimation,
                logEvent: vi.fn(),
                refreshInfoStrip: vi.fn(),
                resetArtboardSwitcherState: vi.fn(),
                resetVmInputControls: vi.fn(),
                showError: vi.fn(),
            },
            elements,
            urlApi: {
                createObjectURL,
                revokeObjectURL,
            },
            windowRef: {
                addEventListener: vi.fn(),
                atob: () => '\u0001\u0002',
            },
        });

        await expect(controller.checkOpenedFile()).resolves.toBe(true);
        expect(createObjectURL).toHaveBeenCalled();
        expect(applyStoredRuntimeVersionForCurrentFile).toHaveBeenCalled();
        expect(loadRiveAnimation).toHaveBeenCalledWith('blob:demo', 'demo.riv', { forceAutoplay: true });
        expect(controller.getCurrentFileUrl()).toBe('blob:demo');
        expect(controller.getCurrentFileName()).toBe('demo.riv');
        expect(controller.getCurrentFileMimeType()).toBe('application/octet-stream');
        expect(controller.getCurrentFileBuffer()).toBeInstanceOf(ArrayBuffer);
        expect(controller.getCurrentFilePreferenceId()).toBe('pref-1');
        expect(controller.getCurrentFileSizeBytes()).toBe(2);

        controller.revokeLastObjectUrl();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:demo');
        controller.setCurrentFile('blob:manual', 'manual.riv', true, Uint8Array.from([1]).buffer, 'application/custom', 1, {});
        expect(controller.getCurrentFileUrl()).toBe('blob:manual');
        expect(controller.getCurrentFileMimeType()).toBe('application/custom');

        await controller.clearCurrentFile();

        expect(revokeObjectURL).toHaveBeenCalledWith('blob:manual');
        expect(controller.getCurrentFileUrl()).toBeNull();
        expect(controller.getCurrentFileName()).toBeNull();
        expect(elements.canvasContainer.textContent).toContain('DROP FILE OR CLICK OPEN');
    });

    it('starts open-file polling and disposes timers and listeners', async () => {
        const elements = createElements();
        const setTimeoutFn = vi.fn((callback) => {
            setTimeoutFn.lastCallback = callback;
            return 'timer-1';
        });
        const clearTimeoutFn = vi.fn();
        const unlisten = vi.fn();
        const controller = createFileSessionController({
            callbacks: {
                buildFileRuntimePreferenceId: vi.fn(),
                ensureTauriBridge: vi.fn().mockResolvedValue(undefined),
                getTauriEventListener: async () => vi.fn(async () => unlisten),
                getTauriInvoker: () => vi.fn(async () => null),
                isTauriEnvironment: () => true,
            },
            clearTimeoutFn,
            elements,
            setTimeoutFn,
            windowRef: {
                addEventListener: vi.fn(),
                atob: globalThis.atob,
            },
        });

        await controller.setupTauriOpenFileListener();
        controller.startOpenedFilePolling(500);

        expect(setTimeoutFn).toHaveBeenCalled();

        controller.dispose();

        expect(clearTimeoutFn).toHaveBeenCalledWith('timer-1');
        expect(unlisten).toHaveBeenCalled();
    });

    it('handles invalid and valid file input selections and clears the current file on button click', async () => {
        const elements = createElements();
        const showError = vi.fn();
        const hideError = vi.fn();
        const logEvent = vi.fn();
        const loadRiveAnimation = vi.fn().mockResolvedValue(undefined);
        const applyStoredRuntimeVersionForCurrentFile = vi.fn().mockResolvedValue(undefined);
        const clickSpy = vi.spyOn(elements.fileInput, 'click').mockImplementation(() => {});
        const controller = createFileSessionController({
            callbacks: {
                applyStoredRuntimeVersionForCurrentFile,
                buildFileRuntimePreferenceId: vi.fn(() => 'pref-valid'),
                cleanupInstance: vi.fn(),
                hideError,
                initLucideIcons: vi.fn(),
                loadRiveAnimation,
                logEvent,
                refreshInfoStrip: vi.fn(),
                resetArtboardSwitcherState: vi.fn(),
                resetVmInputControls: vi.fn(),
                showError,
            },
            elements,
            urlApi: {
                createObjectURL: vi.fn(() => 'blob:valid'),
                revokeObjectURL: vi.fn(),
            },
        });

        controller.setupFileInput();

        const invalidFile = {
            name: 'bad.txt',
        };
        Object.defineProperty(elements.fileInput, 'files', {
            configurable: true,
            value: [invalidFile],
        });
        elements.fileInput.dispatchEvent(new Event('change'));
        await Promise.resolve();

        expect(showError).toHaveBeenCalledWith('Please select a .riv file');
        expect(logEvent).toHaveBeenCalledWith('ui', 'file-invalid', 'Rejected file: bad.txt');

        const validFile = {
            arrayBuffer: vi.fn(async () => Uint8Array.from([1, 2, 3, 4]).buffer),
            lastModified: 123,
            name: 'demo.riv',
            size: 4,
            type: 'application/octet-stream',
        };
        Object.defineProperty(elements.fileInput, 'files', {
            configurable: true,
            value: [validFile],
        });
        elements.fileInput.dispatchEvent(new Event('change'));
        await Promise.resolve();
        await Promise.resolve();

        expect(controller.getCurrentFileName()).toBe('demo.riv');
        expect(controller.getCurrentFileUrl()).toBe('blob:valid');
        expect(hideError).toHaveBeenCalled();
        expect(applyStoredRuntimeVersionForCurrentFile).toHaveBeenCalled();
        expect(loadRiveAnimation).toHaveBeenCalledWith('blob:valid', 'demo.riv', { forceAutoplay: true });

        controller.handleFileButtonClick();

        expect(controller.getCurrentFileName()).toBeNull();
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(logEvent).toHaveBeenCalledWith('ui', 'file-cleared', 'Cleared current animation.');
    });

    it('handles drag-and-drop payloads from files and local file paths', async () => {
        const elements = createElements();
        const listeners = {};
        const showError = vi.fn();
        const loadRiveAnimation = vi.fn().mockResolvedValue(undefined);
        const logEvent = vi.fn();
        const controller = createFileSessionController({
            callbacks: {
                applyStoredRuntimeVersionForCurrentFile: vi.fn().mockResolvedValue(undefined),
                buildFileRuntimePreferenceId: vi.fn(() => 'pref-drop'),
                ensureTauriBridge: vi.fn().mockResolvedValue(undefined),
                getTauriInvoker: () => vi.fn(async (command) => {
                    if (command === 'read_riv_file') {
                        return 'AQI=';
                    }
                    return null;
                }),
                hideError: vi.fn(),
                initLucideIcons: vi.fn(),
                isTauriEnvironment: () => true,
                loadRiveAnimation,
                logEvent,
                refreshInfoStrip: vi.fn(),
                resetArtboardSwitcherState: vi.fn(),
                resetVmInputControls: vi.fn(),
                showError,
            },
            elements,
            urlApi: {
                createObjectURL: vi.fn(() => 'blob:dropped'),
                revokeObjectURL: vi.fn(),
            },
            windowRef: {
                addEventListener: vi.fn((type, handler) => {
                    listeners[type] = handler;
                }),
                atob: () => '\u0001\u0002',
            },
        });

        controller.setupDragAndDrop();

        const droppedFile = {
            arrayBuffer: vi.fn(async () => Uint8Array.from([4, 5]).buffer),
            lastModified: 456,
            name: 'drop.riv',
            size: 2,
            type: 'application/octet-stream',
        };
        const fileDropTransfer = {
            files: [droppedFile],
            getData: () => '',
            items: [],
        };
        const fileDropEvent = {
            dataTransfer: fileDropTransfer,
            preventDefault: vi.fn(),
        };

        listeners.dragenter({ dataTransfer: fileDropTransfer, preventDefault: vi.fn() });
        expect(elements.canvasContainer.classList.contains('drag-active')).toBe(true);

        await listeners.drop(fileDropEvent);
        expect(fileDropEvent.preventDefault).toHaveBeenCalled();
        expect(loadRiveAnimation).toHaveBeenCalledWith('blob:dropped', 'drop.riv', { forceAutoplay: true });
        expect(elements.canvasContainer.classList.contains('drag-active')).toBe(false);

        const pathDropEvent = {
            dataTransfer: {
                files: [],
                getData: (type) => (type === 'text/plain' ? '/tmp/from-path.riv' : ''),
                items: [],
            },
            preventDefault: vi.fn(),
        };

        await listeners.drop(pathDropEvent);
        expect(logEvent).toHaveBeenCalledWith('ui', 'file-dropped', 'Dropped file: from-path.riv');
        expect(showError).not.toHaveBeenCalledWith('Please drop a .riv file');

        const uriListDropEvent = {
            dataTransfer: {
                files: [],
                getData: (type) => {
                    if (type === 'text/uri-list') {
                        return '# Finder export\nfile:///Users/test/from-uri-list.riv';
                    }
                    return '';
                },
                items: [],
            },
            preventDefault: vi.fn(),
        };

        await listeners.drop(uriListDropEvent);
        expect(logEvent).toHaveBeenCalledWith('ui', 'file-dropped', 'Dropped file: from-uri-list.riv');
    });

    it('loads startup and double-click open-file payloads from structured file URLs', async () => {
        const elements = createElements();
        const loadRiveAnimation = vi.fn().mockResolvedValue(undefined);
        const listen = vi.fn(async (_eventName, handler) => {
            listen.handler = handler;
            return vi.fn();
        });
        const invoke = vi.fn(async (command, payload) => {
            if (command === 'get_opened_file') {
                return { paths: ['file:///Users/test/startup-open.riv'] };
            }
            if (command === 'read_riv_file') {
                return payload.path.includes('startup-open') ? 'AQI=' : 'AwQ=';
            }
            return null;
        });
        const controller = createFileSessionController({
            callbacks: {
                applyStoredRuntimeVersionForCurrentFile: vi.fn().mockResolvedValue(undefined),
                buildFileRuntimePreferenceId: vi.fn(() => 'pref-open-with'),
                ensureTauriBridge: vi.fn().mockResolvedValue(undefined),
                getTauriEventListener: async () => listen,
                getTauriInvoker: () => invoke,
                hideError: vi.fn(),
                initLucideIcons: vi.fn(),
                isTauriEnvironment: () => true,
                loadRiveAnimation,
                logEvent: vi.fn(),
                refreshInfoStrip: vi.fn(),
                resetArtboardSwitcherState: vi.fn(),
                resetVmInputControls: vi.fn(),
                showError: vi.fn(),
            },
            elements,
            urlApi: {
                createObjectURL: vi.fn()
                    .mockReturnValueOnce('blob:startup-open')
                    .mockReturnValueOnce('blob:double-click-open'),
                revokeObjectURL: vi.fn(),
            },
            windowRef: {
                addEventListener: vi.fn(),
                atob: () => '\u0001\u0002',
            },
        });

        await expect(controller.checkOpenedFile()).resolves.toBe(true);
        expect(invoke).toHaveBeenCalledWith('read_riv_file', { path: '/Users/test/startup-open.riv' });
        expect(loadRiveAnimation).toHaveBeenCalledWith('blob:startup-open', 'startup-open.riv', { forceAutoplay: true });

        await controller.setupTauriOpenFileListener();
        await listen.handler({ payload: { filePath: 'file:///Users/test/double-click-open.riv' } });

        expect(invoke).toHaveBeenCalledWith('read_riv_file', { path: '/Users/test/double-click-open.riv' });
        expect(loadRiveAnimation).toHaveBeenLastCalledWith('blob:double-click-open', 'double-click-open.riv', { forceAutoplay: true });
        expect(controller.getCurrentFileName()).toBe('double-click-open.riv');
    });

    it('covers bridge edge cases for open-file polling and listener registration', async () => {
        const elements = createElements();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const showError = vi.fn();
        const invoke = vi.fn(async (command, payload) => {
            if (command === 'get_opened_file') {
                return '/tmp/not-rive.txt';
            }
            if (command === 'read_riv_file') {
                throw new Error(`cannot read ${payload.path}`);
            }
            return null;
        });
        const controller = createFileSessionController({
            callbacks: {
                ensureTauriBridge: vi.fn().mockResolvedValue(undefined),
                getTauriEventListener: async () => vi.fn(async () => {
                    throw new Error('listener unavailable');
                }),
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError,
            },
            elements,
            windowRef: {
                addEventListener: vi.fn(),
                atob: globalThis.atob,
            },
        });

        await expect(controller.checkOpenedFile()).resolves.toBe(true);
        expect(showError).toHaveBeenCalledWith('Unsupported file type: not-rive.txt');

        await controller.loadRivFromPath('/tmp/demo.riv', { source: 'drop-path' });
        expect(showError).toHaveBeenCalledWith('Failed to open file: cannot read /tmp/demo.riv');

        await controller.setupTauriOpenFileListener();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('handles empty and invalid drops plus file-input no-selection and load failures', async () => {
        const elements = createElements();
        const listeners = {};
        const showError = vi.fn();
        const logEvent = vi.fn();
        const loadRiveAnimation = vi.fn().mockRejectedValue(new Error('bad load'));
        const controller = createFileSessionController({
            callbacks: {
                applyStoredRuntimeVersionForCurrentFile: vi.fn().mockResolvedValue(undefined),
                buildFileRuntimePreferenceId: vi.fn(() => 'pref-failure'),
                hideError: vi.fn(),
                loadRiveAnimation,
                logEvent,
                resetArtboardSwitcherState: vi.fn(),
                resetVmInputControls: vi.fn(),
                showError,
            },
            elements,
            urlApi: {
                createObjectURL: vi.fn(() => 'blob:failed'),
                revokeObjectURL: vi.fn(),
            },
            windowRef: {
                addEventListener: vi.fn((type, handler) => {
                    listeners[type] = handler;
                }),
                atob: globalThis.atob,
            },
        });

        controller.setupFileInput();
        controller.setupDragAndDrop();

        Object.defineProperty(elements.fileInput, 'files', {
            configurable: true,
            value: [],
        });
        elements.fileInput.dispatchEvent(new Event('change'));
        expect(elements.fileTriggerButton.classList.contains('btn-muted')).toBe(true);

        const invalidDropEvent = {
            dataTransfer: {
                files: [{ arrayBuffer: vi.fn(), name: 'bad.txt' }],
                getData: () => '',
                items: [],
            },
            preventDefault: vi.fn(),
        };
        await listeners.drop(invalidDropEvent);
        expect(showError).toHaveBeenCalledWith('Please drop a .riv file');
        expect(logEvent).toHaveBeenCalledWith('ui', 'drop-invalid', 'Rejected dropped file: bad.txt');

        const emptyDropEvent = {
            dataTransfer: {
                files: [],
                getData: () => '',
                items: [{ kind: 'file', getAsFile: () => null }],
            },
            preventDefault: vi.fn(),
        };
        await listeners.drop(emptyDropEvent);
        expect(showError).toHaveBeenCalledWith('No readable file payload found in drop event.');
        expect(logEvent).toHaveBeenCalledWith('ui', 'drop-invalid', 'Drop payload was empty or unreadable.');

        const validFile = {
            arrayBuffer: vi.fn(async () => Uint8Array.from([9, 8]).buffer),
            lastModified: 789,
            name: 'broken.riv',
            size: 2,
            type: 'application/octet-stream',
        };
        Object.defineProperty(elements.fileInput, 'files', {
            configurable: true,
            value: [validFile],
        });
        elements.fileInput.dispatchEvent(new Event('change'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(elements.fileInput.value).toBe('');
        expect(logEvent).toHaveBeenCalledWith('native', 'load-failed', 'Failed to load broken.riv.');
    });

    it('covers polling guards, listener payload filtering, and drag state edge cases', async () => {
        const elements = createElements();
        const listeners = {};
        const setTimeoutFn = vi.fn((callback) => {
            setTimeoutFn.lastCallback = callback;
            return `timer-${setTimeoutFn.mock.calls.length}`;
        });
        const clearTimeoutFn = vi.fn();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const listen = vi.fn(async (_eventName, handler) => {
            listen.handler = handler;
            return () => {
                throw new Error('unlisten failed');
            };
        });
        let tauri = false;
        let invokeAvailable = false;
        const invoke = vi.fn(async (command) => {
            if (command === 'get_opened_file') {
                return '';
            }
            if (command === 'read_riv_file') {
                return 'AQI=';
            }
            return null;
        });
        const controller = createFileSessionController({
            callbacks: {
                applyStoredRuntimeVersionForCurrentFile: vi.fn().mockResolvedValue(undefined),
                buildFileRuntimePreferenceId: vi.fn(() => 'pref-poll'),
                ensureTauriBridge: vi.fn().mockResolvedValue(undefined),
                getTauriEventListener: async () => listen,
                getTauriInvoker: () => (tauri && invokeAvailable ? invoke : null),
                isTauriEnvironment: () => tauri,
                loadRiveAnimation: vi.fn().mockResolvedValue(undefined),
                logEvent: vi.fn(),
                refreshInfoStrip: vi.fn(),
                resetArtboardSwitcherState: vi.fn(),
                resetVmInputControls: vi.fn(),
                showError: vi.fn(),
            },
            clearTimeoutFn,
            elements,
            setTimeoutFn,
            urlApi: {
                createObjectURL: vi.fn(() => 'blob:listener'),
                revokeObjectURL: vi.fn(),
            },
            windowRef: {
                addEventListener: vi.fn((type, handler) => {
                    listeners[type] = handler;
                }),
                atob: () => '\u0001\u0002',
            },
        });

        controller.startOpenedFilePolling(500);
        expect(setTimeoutFn).not.toHaveBeenCalled();

        tauri = true;
        await expect(controller.checkOpenedFile()).resolves.toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
            '[rive-viewer] Tauri environment detected but invoke bridge is unavailable',
        );

        invokeAvailable = true;
        controller.startOpenedFilePolling(500);
        controller.startOpenedFilePolling(750);
        expect(clearTimeoutFn).toHaveBeenCalledWith('timer-1');

        await controller.setupTauriOpenFileListener();
        await listen.handler({ payload: null });
        await listen.handler({ payload: '/tmp/from-listener.riv' });
        expect(invoke).toHaveBeenCalledWith('read_riv_file', { path: '/tmp/from-listener.riv' });

        controller.setupDragAndDrop();
        listeners.dragenter({ dataTransfer: { files: [], items: [], getData: () => '' }, preventDefault: vi.fn() });
        expect(elements.canvasContainer.classList.contains('drag-active')).toBe(false);
        listeners.dragleave();
        expect(elements.canvasContainer.classList.contains('drag-active')).toBe(false);

        controller.dispose();
        expect(clearTimeoutFn).toHaveBeenCalledWith('timer-2');
        warnSpy.mockRestore();
    });
});
