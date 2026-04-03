import { DEFAULT_RUNTIME_VERSION } from '../core/constants.js';

export function getRuntimeDisplayName(runtimeName = 'webgl2') {
    return runtimeName === 'canvas' ? 'Canvas' : 'WebGL';
}

export function formatByteSize(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return '';
    }
    if (value < 1024) {
        return `${value} B`;
    }
    const kib = value / 1024;
    if (kib < 1024) {
        return `${kib.toFixed(1)} KB`;
    }
    return `${(kib / 1024).toFixed(2)} MB`;
}

export function escapeHtml(value, documentRef = globalThis.document) {
    const div = documentRef?.createElement?.('div');
    if (!div) {
        return String(value ?? '');
    }
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

export function createStatusController({
    callbacks = {},
    clearTimeoutFn = globalThis.clearTimeout,
    documentRef = globalThis.document,
    elements,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    placeholders = {},
    setTimeoutFn = globalThis.setTimeout,
} = {}) {
    const {
        getCurrentFileName = () => null,
        getCurrentFileSizeBytes = () => 0,
        getCurrentRuntime = () => 'webgl2',
        getCurrentRuntimeSource = () => '',
        getCurrentRuntimeVersion = () => null,
        getLoadedRuntime = () => null,
        getRuntimeVersionToken = () => DEFAULT_RUNTIME_VERSION,
        initLucideIcons = () => {},
    } = callbacks;

    const {
        appBuild = '__APP_BUILD__',
        appBuildPlaceholder = '__APP' + '_BUILD__',
        appVersion = '__APP_VERSION__',
        appVersionPlaceholder = '__APP' + '_VERSION__',
    } = placeholders;

    let errorTimeoutId = null;
    let resolvedAppVersion = appVersion;
    let resolvedAppBuild = appBuild;

    function getBuildIdLabel() {
        if (resolvedAppBuild && resolvedAppBuild !== appBuildPlaceholder) {
            return resolvedAppBuild;
        }
        return 'dev';
    }

    function getBuildNumberLabel() {
        const full = getBuildIdLabel();
        if (!full || full === 'dev') {
            return '';
        }
        const first = full.split('-')[0];
        if (/^b\d+$/i.test(first)) {
            return first.toLowerCase();
        }
        return '';
    }

    function getShortBuildIdLabel() {
        const full = getBuildIdLabel();
        if (!full || full === 'dev') {
            return 'dev';
        }
        const numbered = getBuildNumberLabel();
        if (numbered) {
            return numbered;
        }
        const tail = full.split('-').pop();
        if (tail && tail.length >= 6) {
            return tail;
        }
        return full.length > 12 ? `${full.slice(0, 12)}…` : full;
    }

    function refreshInfoStrip() {
        const currentRuntime = getCurrentRuntime();
        const currentFileName = getCurrentFileName();
        if (elements.runtimeStripRuntime) {
            elements.runtimeStripRuntime.innerHTML = `<span class="dot dot-sm" aria-hidden="true"></span>Runtime: ${getRuntimeDisplayName(currentRuntime)}`;
        }
        if (elements.runtimeStripVersion) {
            const runtimeVersion = getCurrentRuntimeVersion(currentRuntime) || DEFAULT_RUNTIME_VERSION;
            elements.runtimeStripVersion.textContent = `v${runtimeVersion}`;
        }
        if (elements.runtimeStripBuild) {
            elements.runtimeStripBuild.textContent = `b ${getShortBuildIdLabel()}`;
        }
        if (elements.runtimeStripFile) {
            if (currentFileName) {
                const sizeLabel = formatByteSize(getCurrentFileSizeBytes());
                const fileLabel = sizeLabel ? `${currentFileName} · ${sizeLabel}` : currentFileName;
                elements.runtimeStripFile.innerHTML = `<i data-lucide="file" class="lucide-10"></i>${escapeHtml(fileLabel, documentRef)}`;
                initLucideIcons();
            } else {
                elements.runtimeStripFile.innerHTML = '<i data-lucide="file" class="lucide-10"></i>No animation loaded';
                initLucideIcons();
            }
        }
    }

    function updateInfo(message) {
        if (elements.info) {
            elements.info.textContent = message;
        }
        refreshInfoStrip();
    }

    function hideError() {
        if (elements.error) {
            elements.error.textContent = '';
            elements.error.classList.remove('visible');
        }
        if (errorTimeoutId) {
            clearTimeoutFn(errorTimeoutId);
            errorTimeoutId = null;
        }
    }

    function showError(message) {
        if (elements.error) {
            elements.error.textContent = message;
            elements.error.classList.add('visible');
            if (errorTimeoutId) {
                clearTimeoutFn(errorTimeoutId);
            }
            errorTimeoutId = setTimeoutFn(() => {
                hideError();
            }, 6000);
        }
    }

    function updateVersionInfo(statusMessage) {
        if (!elements.versionInfo) {
            return;
        }

        const appVersionLabel = resolvedAppVersion || 'dev';
        const currentRuntime = getCurrentRuntime();
        const releaseLine = `Release: v${appVersionLabel} · Build: ${getBuildIdLabel()}`;
        const footer = '<div class="version-footer">© 2025 IVG Design · MIT License · Runtime © Rive</div>';

        if (statusMessage) {
            elements.versionInfo.innerHTML = `${releaseLine}<br>${statusMessage}${footer}`;
            refreshInfoStrip();
            return;
        }

        const runtime = getLoadedRuntime(currentRuntime);
        if (!runtime) {
            elements.versionInfo.innerHTML = `${releaseLine}<br>Runtime ${currentRuntime} is loading...${footer}`;
            refreshInfoStrip();
            return;
        }

        const version = getCurrentRuntimeVersion(currentRuntime) || runtime.version || 'resolving...';
        const source = getCurrentRuntimeSource(currentRuntime);
        elements.versionInfo.innerHTML = `
        ${releaseLine}<br>
        Runtime: ${currentRuntime}<br>
        Version: ${version}<br>
        Requested: ${getRuntimeVersionToken()}<br>
        Source: ${source}
        ${footer}
    `;
        refreshInfoStrip();
    }

    async function resolveAppVersion() {
        if (resolvedAppVersion && resolvedAppVersion !== appVersionPlaceholder) {
            if (!resolvedAppBuild || resolvedAppBuild === appBuildPlaceholder) {
                resolvedAppBuild = 'dev';
            }
            return;
        }

        if (typeof fetchImpl !== 'function') {
            resolvedAppVersion = 'dev';
            resolvedAppBuild = 'dev';
            return;
        }

        try {
            const response = await fetchImpl('package.json', { cache: 'no-store' });
            if (response?.ok) {
                const data = await response.json();
                if (data?.version) {
                    resolvedAppVersion = data.version;
                    updateVersionInfo();
                }
            }
        } catch {
            if (!resolvedAppVersion || resolvedAppVersion === appVersionPlaceholder) {
                resolvedAppVersion = 'dev';
            }
        }

        if (!resolvedAppVersion || resolvedAppVersion === appVersionPlaceholder) {
            resolvedAppVersion = 'dev';
        }
        if (!resolvedAppBuild || resolvedAppBuild === appBuildPlaceholder) {
            resolvedAppBuild = 'dev';
        }
    }

    return {
        getBuildIdLabel,
        getBuildNumberLabel,
        getShortBuildIdLabel,
        hideError,
        refreshInfoStrip,
        resolveAppVersion,
        showError,
        updateInfo,
        updateVersionInfo,
    };
}
