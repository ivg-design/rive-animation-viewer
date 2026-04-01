import {
    CURRENT_CUSTOM_RUNTIME_OPTION_VALUE,
    DEFAULT_RUNTIME_VERSION,
    RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY,
    RUNTIME_META_STORAGE_KEY,
    RUNTIME_VERSION_PREF_STORAGE_KEY,
} from '../../../src/app/core/constants.js';
import {
    createRuntimeLoaderController,
    fetchRuntimeVersionOptions,
    responseToRuntimeAsset,
    resolveRuntimeSource,
} from '../../../src/app/platform/runtime-loader.js';

function createHarness(overrides = {}) {
    let runtimeVersionToken = overrides.runtimeVersionToken ?? 'latest';
    let currentRuntime = overrides.currentRuntime ?? 'webgl2';
    let currentFileUrl = overrides.currentFileUrl ?? null;
    let currentFileName = overrides.currentFileName ?? null;
    let currentFilePreferenceId = overrides.currentFilePreferenceId ?? null;

    const storage = {
        setItem: vi.fn(),
    };
    const logger = overrides.logger ?? { warn: vi.fn() };
    const urlApi = overrides.urlApi ?? {
        createObjectURL: vi.fn(() => 'blob:runtime-script'),
        revokeObjectURL: vi.fn(),
    };
    const callbacks = {
        loadRiveAnimation: vi.fn().mockResolvedValue(undefined),
        logEvent: vi.fn(),
        refreshInfoStrip: vi.fn(),
        showError: vi.fn(),
        updateVersionInfo: vi.fn(),
        ...overrides.callbacks,
    };
    const state = {
        runtimeAssets: overrides.runtimeAssets ?? {},
        runtimeBlobUrls: overrides.runtimeBlobUrls ?? {},
        runtimeMeta: overrides.runtimeMeta ?? {},
        runtimePromises: overrides.runtimePromises ?? {},
        runtimeRegistry: overrides.runtimeRegistry ?? {},
        runtimeResolvedUrls: overrides.runtimeResolvedUrls ?? {},
        runtimeSourceTexts: overrides.runtimeSourceTexts ?? {},
        runtimeVersionByFile: overrides.runtimeVersionByFile ?? {},
        runtimeVersions: overrides.runtimeVersions ?? {},
        runtimeVersionOptionsState: overrides.runtimeVersionOptionsState ?? {
            latest: '2.31.0',
            versions: ['2.31.0', '2.30.0'],
        },
        runtimeWarningsShown: overrides.runtimeWarningsShown ?? new Set(),
        getCurrentRuntime: () => currentRuntime,
        getRuntimeVersionToken: () => runtimeVersionToken,
        setRuntimeVersionToken: (nextToken) => {
            runtimeVersionToken = nextToken;
        },
        getCurrentFileUrl: () => currentFileUrl,
        getCurrentFileName: () => currentFileName,
        getCurrentFilePreferenceId: () => currentFilePreferenceId,
    };

    const controller = createRuntimeLoaderController({
        elements: overrides.elements ?? {},
        state,
        callbacks,
        documentRef: overrides.documentRef ?? document,
        windowRef: overrides.windowRef ?? window,
        storage,
        fetchImpl: overrides.fetchImpl,
        cachesRef: overrides.cachesRef,
        urlApi,
        blobCtor: Blob,
        logger,
    });

    return {
        callbacks,
        controller,
        logger,
        setCurrentFile(url, name, preferenceId) {
            currentFileUrl = url;
            currentFileName = name;
            currentFilePreferenceId = preferenceId;
        },
        setCurrentRuntime(nextRuntime) {
            currentRuntime = nextRuntime;
        },
        state,
        storage,
        urlApi,
        getRuntimeVersionToken: () => runtimeVersionToken,
    };
}

describe('platform/runtime-loader', () => {
    beforeEach(() => {
        delete window.rive;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete window.rive;
    });

    it('discovers sorted runtime versions from the registry payload', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                'dist-tags': { latest: '2.31.0' },
                versions: {
                    alpha: {},
                    '2.29.0': {},
                    '2.31.0': {},
                    '2.30.0': {},
                },
            }),
        });

        await expect(fetchRuntimeVersionOptions({
            fetchImpl,
            optionCount: 3,
        })).resolves.toEqual({
            latest: '2.31.0',
            versions: ['2.31.0', '2.30.0', '2.29.0'],
        });
    });

    it('falls back to cached runtime metadata when HEAD resolution fails', async () => {
        const logger = { warn: vi.fn() };
        const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));

        await expect(resolveRuntimeSource({
            fetchImpl,
            scriptUrl: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@latest',
            metaKey: 'webgl2@2.31.0',
            runtimeMeta: {
                'webgl2@2.31.0': {
                    resolvedUrl: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.31.0',
                    version: '2.31.0',
                },
            },
            logger,
        })).resolves.toEqual({
            resolvedUrl: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.31.0',
            version: '2.31.0',
        });

        expect(logger.warn).toHaveBeenCalled();
    });

    it('strips source map trailers before creating runtime blobs', async () => {
        const urlApi = {
            createObjectURL: vi.fn(() => 'blob:clean-runtime'),
        };

        const asset = await responseToRuntimeAsset(
            new Response('console.log("runtime");\n//# sourceMappingURL=runtime.js.map\n', { status: 200 }),
            { urlApi, blobCtor: Blob },
        );

        expect(asset.objectUrl).toBe('blob:clean-runtime');
        expect(asset.text).toContain('console.log("runtime");');
        expect(asset.text).not.toContain('sourceMappingURL');
    });

    it('loads a runtime asset and exposes cached source/version data', async () => {
        const runtimeApi = { Rive: vi.fn(), version: '2.35.0' };
        const fetchImpl = vi.fn((url, options) => {
            if (options?.method === 'HEAD') {
                return Promise.resolve({
                    ok: true,
                    url: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.35.0',
                    headers: {
                        get: (name) => (name === 'x-jsd-version' ? '2.35.0' : null),
                    },
                });
            }
            return Promise.resolve(new Response('window.rive = { version: "2.35.0" };', { status: 200 }));
        });
        const appendChildSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            window.rive = runtimeApi;
            Promise.resolve().then(() => {
                node.onload?.();
            });
            return node;
        });
        const harness = createHarness({ fetchImpl });

        await expect(harness.controller.ensureRuntime('webgl2')).resolves.toBe(runtimeApi);

        expect(appendChildSpy).toHaveBeenCalled();
        expect(harness.controller.getRuntimeCacheKey('webgl2')).toBe('webgl2@2.31.0');
        expect(harness.controller.getEffectiveRuntimeVersionToken()).toBe('2.31.0');
        expect(harness.controller.getCurrentRuntimeVersion('webgl2')).toBe('2.35.0');
        expect(harness.controller.getCurrentRuntimeSource('webgl2')).toBe('https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.35.0');
        expect(harness.controller.getLoadedRuntime('webgl2')).toBe(runtimeApi);
        expect(harness.controller.getRuntimeAsset('webgl2')).toEqual(expect.objectContaining({
            resolvedUrl: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.35.0',
            version: '2.35.0',
        }));
        expect(harness.controller.getRuntimeVersion('webgl2')).toBe('2.35.0');
        expect(harness.controller.getRuntimeSourceText('webgl2')).toContain('window.rive');
        expect(harness.storage.setItem).toHaveBeenCalledWith(
            RUNTIME_META_STORAGE_KEY,
            expect.stringContaining('2.35.0'),
        );
    });

    it('reapplies stored file-scoped runtime versions without reloading the current file', async () => {
        const runtimeApi = { Rive: vi.fn(), version: '2.35.0' };
        const fetchImpl = vi.fn((url, options) => {
            if (options?.method === 'HEAD') {
                return Promise.resolve({
                    ok: true,
                    url: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.35.0',
                    headers: {
                        get: (name) => (name === 'x-jsd-version' ? '2.35.0' : null),
                    },
                });
            }
            return Promise.resolve(new Response('window.rive = { version: "2.35.0" };', { status: 200 }));
        });
        vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            window.rive = runtimeApi;
            Promise.resolve().then(() => {
                node.onload?.();
            });
            return node;
        });

        const harness = createHarness({
            fetchImpl,
            runtimeVersionByFile: {
                'path:/tmp/demo.riv': '2.35.0',
            },
        });
        harness.setCurrentFile('blob:demo-riv', 'demo.riv', 'path:/tmp/demo.riv');

        await harness.controller.applyStoredRuntimeVersionForCurrentFile();

        expect(harness.getRuntimeVersionToken()).toBe('2.35.0');
        expect(harness.callbacks.loadRiveAnimation).not.toHaveBeenCalled();
    });

    it('applies runtime version changes, clears stale caches, and reloads the file', async () => {
        const runtimeApi = { Rive: vi.fn(), version: '2.35.0' };
        const fetchImpl = vi.fn((url, options) => {
            if (options?.method === 'HEAD') {
                return Promise.resolve({
                    ok: true,
                    url: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.35.0',
                    headers: {
                        get: (name) => (name === 'x-jsd-version' ? '2.35.0' : null),
                    },
                });
            }
            return Promise.resolve(new Response('window.rive = { version: "2.35.0" };', { status: 200 }));
        });
        vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            window.rive = runtimeApi;
            Promise.resolve().then(() => {
                node.onload?.();
            });
            return node;
        });

        const harness = createHarness({
            fetchImpl,
            runtimeAssets: { stale: { text: 'old runtime' } },
            runtimeBlobUrls: { stale: 'blob:old-runtime' },
            runtimePromises: { stale: Promise.resolve({}) },
            runtimeRegistry: { stale: {} },
            runtimeResolvedUrls: { stale: 'https://example.com/stale.js' },
            runtimeSourceTexts: { stale: 'old source' },
            runtimeVersions: { stale: '2.20.0' },
        });
        harness.setCurrentFile('blob:demo-riv', 'demo.riv', 'path:/tmp/demo.riv');

        await harness.controller.applyRuntimeVersionToken('2.35.0', { source: 'preset' });

        expect(harness.getRuntimeVersionToken()).toBe('2.35.0');
        expect(harness.urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:old-runtime');
        expect(harness.callbacks.loadRiveAnimation).toHaveBeenCalledWith('blob:demo-riv', 'demo.riv');
        expect(harness.callbacks.showError).not.toHaveBeenCalled();
        expect(harness.storage.setItem).toHaveBeenCalledWith(RUNTIME_VERSION_PREF_STORAGE_KEY, '2.35.0');

        const filePrefsCall = harness.storage.setItem.mock.calls.find(([key]) => key === RUNTIME_FILE_VERSION_PREFS_STORAGE_KEY);
        expect(JSON.parse(filePrefsCall[1])).toEqual({
            'path:/tmp/demo.riv': '2.35.0',
        });
    });

    it('sets up the runtime version picker, handles empty custom input, and applies custom versions', async () => {
        const runtimeApi = { Rive: vi.fn(), version: '2.40.0' };
        const fetchImpl = vi.fn((url, options) => {
            if (String(url).includes('registry.npmjs.org')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        'dist-tags': { latest: '2.40.0' },
                        versions: {
                            '2.39.0': {},
                            '2.40.0': {},
                        },
                    }),
                });
            }
            if (options.method === 'HEAD') {
                return Promise.resolve({
                    ok: true,
                    url: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.40.0',
                    headers: {
                        get: (name) => (name === 'x-jsd-version' ? '2.40.0' : null),
                    },
                });
            }
            return Promise.resolve(new Response('window.rive = { version: "2.40.0" };', { status: 200 }));
        });
        vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            window.rive = runtimeApi;
            Promise.resolve().then(() => {
                node.onload?.();
            });
            return node;
        });

        const select = document.createElement('select');
        const customRow = document.createElement('div');
        const customInput = document.createElement('input');
        const applyButton = document.createElement('button');
        customRow.hidden = true;
        document.body.append(select, customRow, customInput, applyButton);

        const harness = createHarness({
            elements: {
                runtimeVersionApplyButton: applyButton,
                runtimeVersionCustomInput: customInput,
                runtimeVersionCustomRow: customRow,
                runtimeVersionSelect: select,
            },
            fetchImpl,
        });

        await harness.controller.setupRuntimeVersionPicker();
        expect(select.disabled).toBe(false);
        expect(select.innerHTML).toContain('Latest (auto: 2.40.0)');

        select.value = 'custom';
        select.dispatchEvent(new Event('change'));
        expect(customRow.hidden).toBe(false);
        expect(document.activeElement).toBe(customInput);

        applyButton.click();
        expect(harness.callbacks.showError).toHaveBeenCalledWith('Enter a runtime version before applying custom.');

        customInput.value = '2.40.0';
        applyButton.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(harness.getRuntimeVersionToken()).toBe('2.40.0');
        expect(harness.storage.setItem).toHaveBeenCalledWith(RUNTIME_VERSION_PREF_STORAGE_KEY, '2.40.0');
    });

    it('uses Cache API assets and only warns once for unsupported scripting runtimes', async () => {
        const runtimeApi = { Rive: vi.fn(), version: '2.31.0' };
        const fetchImpl = vi.fn((url, options) => {
            if (options?.method === 'HEAD') {
                return Promise.resolve({
                    ok: true,
                    url: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.31.0',
                    headers: {
                        get: (name) => (name === 'x-jsd-version' ? '2.31.0' : null),
                    },
                });
            }
            return Promise.resolve(new Response('unused', { status: 200 }));
        });
        const cachedResponse = new Response('window.rive = { version: "2.31.0" };', { status: 200 });
        const cache = {
            match: vi.fn().mockResolvedValue(cachedResponse),
            put: vi.fn(),
        };
        const cachesRef = {
            open: vi.fn().mockResolvedValue(cache),
        };
        const appendChildSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            window.rive = runtimeApi;
            Promise.resolve().then(() => {
                node.onload?.();
            });
            return node;
        });

        const harness = createHarness({ cachesRef, fetchImpl });

        await harness.controller.ensureRuntime('webgl2');
        await harness.controller.ensureRuntime('webgl2');

        expect(cachesRef.open).toHaveBeenCalled();
        expect(cache.match).toHaveBeenCalled();
        expect(cache.put).not.toHaveBeenCalled();
        expect(appendChildSpy).toHaveBeenCalledTimes(1);
        expect(harness.callbacks.showError).toHaveBeenCalledTimes(1);
        expect(harness.callbacks.showError).toHaveBeenCalledWith(
            'Runtime webgl2@2.31.0 is below 2.34.0; VM scripting may be unavailable.',
        );
    });

    it('falls back to the generated runtime options list and applies custom versions from Enter', async () => {
        const runtimeApi = { Rive: vi.fn(), version: '2.28.0' };
        const fetchImpl = vi.fn((url, options = {}) => {
            if (String(url).includes('registry.npmjs.org')) {
                return Promise.reject(new Error('registry offline'));
            }
            if (options.method === 'HEAD') {
                return Promise.resolve({
                    ok: true,
                    url: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.28.0',
                    headers: {
                        get: () => '2.28.0',
                    },
                });
            }
            return Promise.resolve(new Response('window.rive = { version: "2.28.0" };', { status: 200 }));
        });
        vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            window.rive = runtimeApi;
            Promise.resolve().then(() => {
                node.onload?.();
            });
            return node;
        });

        const select = document.createElement('select');
        const customRow = document.createElement('div');
        const customInput = document.createElement('input');
        const applyButton = document.createElement('button');
        document.body.append(select, customRow, customInput, applyButton);

        const harness = createHarness({
            elements: {
                runtimeVersionApplyButton: applyButton,
                runtimeVersionCustomInput: customInput,
                runtimeVersionCustomRow: customRow,
                runtimeVersionSelect: select,
            },
            fetchImpl,
            runtimeVersionToken: '2.27.0',
        });

        await harness.controller.setupRuntimeVersionPicker();

        expect(select.innerHTML).toContain(`Latest (auto: ${DEFAULT_RUNTIME_VERSION})`);
        expect(select.value).toBe(CURRENT_CUSTOM_RUNTIME_OPTION_VALUE);
        expect(harness.logger.warn).toHaveBeenCalled();

        select.value = 'custom';
        select.dispatchEvent(new Event('change'));
        customInput.value = '2.28.0';
        customInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(harness.getRuntimeVersionToken()).toBe('2.28.0');
        expect(harness.storage.setItem).toHaveBeenCalledWith(RUNTIME_VERSION_PREF_STORAGE_KEY, '2.28.0');
    });

    it('short-circuits identical runtime selections and reports script bootstrap failures', async () => {
        const fetchImpl = vi.fn((url, options = {}) => {
            if (options.method === 'HEAD') {
                return Promise.resolve({
                    ok: true,
                    url: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.31.0',
                    headers: {
                        get: () => '2.31.0',
                    },
                });
            }
            return Promise.resolve(new Response('window.rive = {};', { status: 200 }));
        });
        const storage = {
            setItem: vi.fn(() => {
                throw new Error('quota');
            }),
        };
        vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
            Promise.resolve().then(() => {
                node.onload?.();
            });
            return node;
        });

        const harness = createHarness({
            fetchImpl,
            currentFileName: 'demo.riv',
            currentFileUrl: 'blob:demo',
        });
        harness.storage.setItem = storage.setItem;

        await harness.controller.applyRuntimeVersionToken('latest', { source: 'preset' });
        expect(storage.setItem).not.toHaveBeenCalled();

        await harness.controller.applyRuntimeVersionToken('2.31.0', { source: 'preset' });

        expect(harness.callbacks.showError).toHaveBeenCalledWith(
            'Failed to load runtime version 2.31.0: Runtime did not expose the expected API',
        );
        expect(harness.callbacks.logEvent).toHaveBeenCalledWith(
            'native',
            'runtime-version-load-failed',
            'Failed to load runtime version 2.31.0.',
            expect.any(Error),
        );
    });
});
