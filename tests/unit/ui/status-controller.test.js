import {
    createStatusController,
    escapeHtml,
    formatByteSize,
    getRuntimeDisplayName,
} from '../../../src/app/ui/status-controller.js';

function createElements() {
    document.body.innerHTML = `
        <div id="version-info"></div>
        <div id="runtime-strip-runtime"></div>
        <div id="runtime-strip-version"></div>
        <div id="runtime-strip-build"></div>
        <div id="runtime-strip-file"></div>
        <div id="info"></div>
        <div id="error-message"></div>
    `;

    return {
        error: document.getElementById('error-message'),
        info: document.getElementById('info'),
        runtimeStripBuild: document.getElementById('runtime-strip-build'),
        runtimeStripFile: document.getElementById('runtime-strip-file'),
        runtimeStripRuntime: document.getElementById('runtime-strip-runtime'),
        runtimeStripVersion: document.getElementById('runtime-strip-version'),
        versionInfo: document.getElementById('version-info'),
    };
}

describe('ui/status-controller', () => {
    it('formats runtime labels, byte sizes, and escaped text', () => {
        expect(getRuntimeDisplayName('canvas')).toBe('Canvas');
        expect(getRuntimeDisplayName('webgl2')).toBe('WebGL');
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

        expect(elements.runtimeStripRuntime.innerHTML).toContain('Runtime: WebGL');
        expect(elements.runtimeStripVersion.textContent).toBe('v1.2.3');
        expect(elements.runtimeStripBuild.textContent).toBe('b0100');
        expect(elements.runtimeStripFile.innerHTML).toContain('&lt;demo&gt;.riv · 2.0 KB');
        expect(elements.versionInfo.innerHTML).toContain('Release: v3.4.5');
        expect(elements.versionInfo.innerHTML).toContain('Source: bundle');
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
});
