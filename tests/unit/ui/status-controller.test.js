import {
    createStatusController,
    escapeHtml,
    formatByteSize,
    getRuntimeDisplayName,
    getRuntimeStatusLabel,
} from '../../../src/app/ui/status/status-controller.js';

function createElements() {
    document.body.innerHTML = `
        <div id="version-info"></div>
        <div id="header-file-meta"></div>
        <div id="runtime-strip-runtime"></div>
        <div id="info"></div>
        <div id="error-message"></div>
    `;

    return {
        error: document.getElementById('error-message'),
        headerFileMeta: document.getElementById('header-file-meta'),
        info: document.getElementById('info'),
        runtimeStripRuntime: document.getElementById('runtime-strip-runtime'),
        versionInfo: document.getElementById('version-info'),
    };
}

describe('ui/status-controller', () => {
    it('formats runtime labels, byte sizes, and escaped text', () => {
        expect(getRuntimeDisplayName('canvas')).toBe('Canvas');
        expect(getRuntimeDisplayName('webgl2')).toBe('WebGL2');
        expect(getRuntimeStatusLabel('canvas')).toBe('CANVAS');
        expect(getRuntimeStatusLabel('webgl2')).toBe('WEBGL2');
        expect(formatByteSize(0)).toBe('');
        expect(formatByteSize(512)).toBe('512 B');
        expect(formatByteSize(2048)).toBe('2.0 KB');
        expect(escapeHtml('<demo>.riv')).toBe('&lt;demo&gt;.riv');
    });

    it('renders info strips and version information from controller state', () => {
        const elements = createElements();
        const controller = createStatusController({
            callbacks: {
                getCurrentFileName: () => '<demo>.riv',
                getCurrentFileSourcePath: () => '/Users/ivg/demo/<demo>.riv',
                getCurrentFileSizeBytes: () => 2048,
                getCurrentRuntime: () => 'webgl2',
                getCurrentRuntimeSource: () => 'bundle',
                getCurrentRuntimeVersion: () => '1.2.3',
                getLoadedRuntime: () => ({ version: '1.2.3' }),
                getRuntimeVersionToken: () => 'latest',
                initLucideIcons: vi.fn(),
            },
            elements,
            placeholders: {
                appBuild: 'b0100-20260401-abcdef',
                appBuildPlaceholder: '__APP_BUILD__',
                appVersion: '3.4.5',
                appVersionPlaceholder: '__APP_VERSION__',
            },
        });

        controller.refreshInfoStrip();
        controller.updateVersionInfo();
        controller.updateInfo('Ready');

        expect(elements.runtimeStripRuntime.textContent).toBe('RT: WEBGL2 v1.2.3');
        expect(elements.headerFileMeta.textContent).toContain('/Users/ivg/demo/');
        expect(elements.headerFileMeta.textContent).toContain('<demo>.riv');
        expect(elements.headerFileMeta.textContent).toContain('2.0 KB');
        expect(elements.headerFileMeta.querySelector('.header-file-meta-directory')?.textContent).toBe('/Users/ivg/demo/');
        expect(elements.headerFileMeta.querySelector('.header-file-meta-file')?.textContent).toBe('<demo>.riv');
        expect(elements.headerFileMeta.querySelector('.header-file-meta-size')?.textContent).toBe('2.0 KB');
        expect(elements.versionInfo.innerHTML).toContain('Release: v3.4.5');
        expect(elements.versionInfo.innerHTML).toContain('Source: bundle');
        expect(elements.versionInfo.innerHTML).toContain('© 2026 IVG Design');
        expect(elements.info.textContent).toBe('Ready');
    });

    it('shows, auto-hides, and resolves the app version from package metadata', async () => {
        const elements = createElements();
        let timeoutCallback = null;
        const controller = createStatusController({
            callbacks: {
                getCurrentRuntime: () => 'webgl2',
                getLoadedRuntime: () => null,
            },
            elements,
            fetchImpl: vi.fn(async () => ({
                ok: true,
                json: async () => ({ version: '9.9.9' }),
            })),
            placeholders: {
                appBuild: '__APP_BUILD__',
                appBuildPlaceholder: '__APP_BUILD__',
                appVersion: '__APP_VERSION__',
                appVersionPlaceholder: '__APP_VERSION__',
            },
            setTimeoutFn: (callback) => {
                timeoutCallback = callback;
                return 'timer-1';
            },
        });

        controller.showError('Boom');
        expect(elements.error.classList.contains('visible')).toBe(true);
        expect(elements.error.textContent).toBe('Boom');

        timeoutCallback();
        expect(elements.error.classList.contains('visible')).toBe(false);

        await controller.resolveAppVersion();
        expect(elements.versionInfo.innerHTML).toContain('Release: v9.9.9');
    });

    it('covers dev build labels, explicit status messages, and fallback app-version resolution', async () => {
        const elements = createElements();
        const clearTimeoutFn = vi.fn();
        const controller = createStatusController({
            callbacks: {
                getCurrentFileName: () => null,
                getCurrentRuntime: () => 'canvas',
                getCurrentRuntimeSource: () => '',
                getLoadedRuntime: () => null,
                getRuntimeVersionToken: () => '2.31.0',
                initLucideIcons: vi.fn(),
            },
            clearTimeoutFn,
            elements,
            fetchImpl: vi.fn(async () => {
                throw new Error('offline');
            }),
            placeholders: {
                appBuild: 'build-20260401-abcdef123456',
                appBuildPlaceholder: '__APP_BUILD__',
                appVersion: '__APP_VERSION__',
                appVersionPlaceholder: '__APP_VERSION__',
            },
            setTimeoutFn: () => 'timer-2',
        });

        expect(controller.getBuildIdLabel()).toBe('build-20260401-abcdef123456');
        expect(controller.getBuildNumberLabel()).toBe('');
        expect(controller.getShortBuildIdLabel()).toBe('abcdef123456');

        controller.showError('One');
        controller.showError('Two');
        expect(clearTimeoutFn).toHaveBeenCalledWith('timer-2');
        controller.hideError();
        expect(elements.error.classList.contains('visible')).toBe(false);

        controller.updateVersionInfo('Loading runtime...');
        expect(elements.versionInfo.innerHTML).toContain('Loading runtime...');

        controller.updateVersionInfo();
        expect(elements.versionInfo.innerHTML).toContain('Runtime canvas is loading...');

        await controller.resolveAppVersion();
        controller.updateVersionInfo();
        expect(elements.versionInfo.innerHTML).toContain('Release: vdev');

        const noFetchController = createStatusController({
            callbacks: {
                getCurrentRuntime: () => 'webgl2',
                getLoadedRuntime: () => null,
            },
            elements: createElements(),
            fetchImpl: null,
            placeholders: {
                appBuild: '__APP_BUILD__',
                appBuildPlaceholder: '__APP_BUILD__',
                appVersion: '__APP_VERSION__',
                appVersionPlaceholder: '__APP_VERSION__',
            },
        });
        await noFetchController.resolveAppVersion();
        noFetchController.updateVersionInfo();
        expect(noFetchController.getBuildIdLabel()).toBe('dev');
    });

    it('uses runtime metadata in the info block even when the runtime registry object is unavailable', () => {
        const elements = createElements();
        const controller = createStatusController({
            callbacks: {
                getCurrentRuntime: () => 'webgl2',
                getCurrentRuntimeSource: () => 'https://cdn.example/webgl2.js',
                getCurrentRuntimeVersion: () => '2.36.0',
                getLoadedRuntime: () => null,
                getRuntimeVersionToken: () => 'latest',
            },
            elements,
            placeholders: {
                appBuild: 'b0101-20260403-abcdef',
                appBuildPlaceholder: '__APP_BUILD__',
                appVersion: '2.0.5',
                appVersionPlaceholder: '__APP_VERSION__',
            },
        });

        controller.updateVersionInfo();
        expect(elements.versionInfo.innerHTML).toContain('Runtime: webgl2');
        expect(elements.versionInfo.innerHTML).toContain('Version: 2.36.0');
        expect(elements.versionInfo.innerHTML).toContain('Source: https://cdn.example/webgl2.js');
        expect(elements.versionInfo.innerHTML).not.toContain('is loading');
    });

    it('restores the last structured playback summary after transient status messages', () => {
        const elements = createElements();
        const scheduled = [];
        const controller = createStatusController({
            callbacks: {
                getCurrentRuntime: () => 'webgl2',
            },
            elements,
            setTimeoutFn: (callback) => {
                scheduled.push(callback);
                return `info-timer-${scheduled.length}`;
            },
        });
        const structuredStatus = 'Loaded: [AB] Diagram · [SM] State Machine 1 · [VM] diagram_vm · [INST] row_1';

        controller.updateInfo(structuredStatus);
        controller.updateInfo('Canvas sizing set to auto');

        expect(elements.info.textContent).toBe('Canvas sizing set to auto');
        expect(scheduled).toHaveLength(1);

        scheduled[0]();

        expect(elements.info.dataset.statusMode).toBe('structured');
        expect(elements.info.title).toBe(structuredStatus);
        expect(elements.info.textContent).toContain('Diagram');
        expect(elements.info.textContent).toContain('State Machine 1');
        expect(elements.info.textContent).toContain('diagram_vm');
        expect(elements.info.textContent).toContain('row_1');
    });

    it('cancels a pending transient restore when a newer structured status arrives', () => {
        const elements = createElements();
        const clearTimeoutFn = vi.fn();
        const controller = createStatusController({
            callbacks: {
                getCurrentRuntime: () => 'webgl2',
            },
            clearTimeoutFn,
            elements,
            setTimeoutFn: () => 'info-timer-1',
        });
        const firstStatus = 'Loaded: [AB] Diagram · [SM] State Machine 1 · [VM] diagram_vm';
        const secondStatus = 'Loaded: [AB] Diagram v2 · [ANIM] Idle · [VM] diagram_vm';

        controller.updateInfo(firstStatus);
        controller.updateInfo('Refreshed diagram_v5.riv');
        controller.updateInfo(secondStatus);

        expect(clearTimeoutFn).toHaveBeenCalledWith('info-timer-1');
        expect(elements.info.dataset.statusMode).toBe('structured');
        expect(elements.info.title).toBe(secondStatus);
    });
});
