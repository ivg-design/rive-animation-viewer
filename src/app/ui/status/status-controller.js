import { DEFAULT_RUNTIME_VERSION } from '../../core/constants.js';
import { getStatusIconMarkup } from './status-icons.js';

const STRUCTURED_STATUS_TOKEN_PATTERN = /\[(AB|VM|SM|ANIM|INST)\]\s+/;
const STRUCTURED_STATUS_SEGMENT_PATTERN = /^\[(AB|VM|SM|ANIM|INST)\]\s+(.+)$/;

export function getRuntimeDisplayName(runtimeName = 'webgl2') {
    return runtimeName === 'canvas' ? 'Canvas' : 'WebGL2';
}

export function getRuntimeStatusLabel(runtimeName = 'webgl2') {
    return runtimeName === 'canvas' ? 'CANVAS' : 'WEBGL2';
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

function splitDirectoryAndFileLabel(pathLabel, fallbackFileName) {
    const normalizedPath = String(pathLabel || '').trim();
    const normalizedFileName = String(fallbackFileName || '').trim();
    if (!normalizedPath) {
        return {
            directoryLabel: '',
            fileLabel: normalizedFileName,
        };
    }
    const lastSeparatorIndex = Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\'));
    if (lastSeparatorIndex === -1) {
        return {
            directoryLabel: '',
            fileLabel: normalizedPath,
        };
    }
    const fileLabel = normalizedPath.slice(lastSeparatorIndex + 1) || normalizedFileName;
    return {
        directoryLabel: normalizedPath.slice(0, lastSeparatorIndex + 1),
        fileLabel,
    };
}

function parseStructuredStatusMessage(message) {
    const fullText = String(message || '').trim();
    if (!fullText) {
        return null;
    }

    const tokenStart = fullText.search(STRUCTURED_STATUS_TOKEN_PATTERN);
    if (tokenStart === -1) {
        return null;
    }

    const prefixLabel = fullText.slice(0, tokenStart).trim().replace(/:\s*$/, '');
    const segmentSource = fullText.slice(tokenStart);
    const items = [];

    for (const segment of segmentSource.split(/\s+·\s+/)) {
        const normalizedSegment = segment.trim();
        const match = normalizedSegment.match(STRUCTURED_STATUS_SEGMENT_PATTERN);
        if (!match) {
            return null;
        }
        const [, token, value] = match;
        const normalizedValue = String(value || '').trim();
        if (!normalizedValue) {
            return null;
        }
        items.push({ token, value: normalizedValue });
    }

    if (items.length === 0) {
        return null;
    }

    return {
        fullText,
        items,
        prefixLabel,
    };
}

function buildStructuredStatusMarkup(message, documentRef) {
    const parsed = parseStructuredStatusMessage(message);
    if (!parsed) {
        return null;
    }

    const prefixMarkup = parsed.prefixLabel
        ? `<span class="status-prefix">${escapeHtml(parsed.prefixLabel, documentRef)}:</span>`
        : '';
    const itemsMarkup = parsed.items.map(({ token, value }) => `
        <span class="status-item status-item-${token.toLowerCase()}" data-status-token="${token}">
            <span class="status-item-icon" aria-hidden="true">${getStatusIconMarkup(token)}</span>
            <span class="status-item-value">${escapeHtml(value, documentRef)}</span>
        </span>
    `).join('');

    return {
        markup: `${prefixMarkup}${itemsMarkup}`,
        title: parsed.fullText,
    };
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
        getCurrentFileSourcePath = () => '',
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

    function getResolvedAppVersion() {
        if (resolvedAppVersion && resolvedAppVersion !== appVersionPlaceholder) {
            return resolvedAppVersion;
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

    function buildHeaderFileMeta() {
        const currentFileName = getCurrentFileName();
        if (!currentFileName) {
            return null;
        }

        const currentFileSourcePath = getCurrentFileSourcePath();
        const sizeLabel = formatByteSize(getCurrentFileSizeBytes());
        const { directoryLabel, fileLabel } = splitDirectoryAndFileLabel(
            currentFileSourcePath || currentFileName,
            currentFileName,
        );
        return {
            directoryLabel,
            fileLabel,
            fullLabel: currentFileSourcePath || currentFileName,
            sizeLabel,
        };
    }

    function updateHeaderFileMeta() {
        if (!elements.headerFileMeta) {
            return;
        }
        const value = buildHeaderFileMeta();
        if (!value?.fileLabel) {
            elements.headerFileMeta.textContent = '';
            elements.headerFileMeta.title = '';
            elements.headerFileMeta.hidden = true;
            return;
        }
        const fullLabel = value.sizeLabel ? `${value.fullLabel} · ${value.sizeLabel}` : value.fullLabel;
        const directoryMarkup = value.directoryLabel
            ? `<span class="header-file-meta-directory">${escapeHtml(value.directoryLabel, documentRef)}</span>`
            : '';
        const sizeMarkup = value.sizeLabel
            ? `<span class="header-file-meta-size">${escapeHtml(value.sizeLabel, documentRef)}</span>`
            : '';
        elements.headerFileMeta.innerHTML = `
            ${directoryMarkup}
            <span class="header-file-meta-file">${escapeHtml(value.fileLabel, documentRef)}</span>
            ${sizeMarkup}
        `;
        elements.headerFileMeta.title = fullLabel;
        elements.headerFileMeta.hidden = false;
    }

    function refreshInfoStrip() {
        const currentRuntime = getCurrentRuntime();
        updateHeaderFileMeta();
        if (elements.runtimeStripRuntime) {
            const runtimeVersion = getCurrentRuntimeVersion(currentRuntime) || DEFAULT_RUNTIME_VERSION;
            elements.runtimeStripRuntime.textContent = `RT: ${getRuntimeStatusLabel(currentRuntime)} v${runtimeVersion}`;
        }
    }

    function updateInfo(message) {
        if (elements.info) {
            const structuredStatus = buildStructuredStatusMarkup(message, documentRef);
            if (structuredStatus) {
                elements.info.innerHTML = structuredStatus.markup;
                elements.info.title = structuredStatus.title;
                elements.info.dataset.statusMode = 'structured';
            } else {
                elements.info.textContent = message;
                elements.info.title = String(message || '');
                delete elements.info.dataset.statusMode;
            }
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
        const footer = '<div class="version-footer">© 2026 IVG Design · MIT License · Runtime © Rive</div>';

        if (statusMessage) {
            elements.versionInfo.innerHTML = `${releaseLine}<br>${statusMessage}${footer}`;
            refreshInfoStrip();
            return;
        }

        const runtime = getLoadedRuntime(currentRuntime);
        const version = getCurrentRuntimeVersion(currentRuntime) || runtime?.version || null;
        const source = getCurrentRuntimeSource(currentRuntime) || '';
        if (!runtime && !version && !source) {
            elements.versionInfo.innerHTML = `${releaseLine}<br>Runtime ${currentRuntime} is loading...${footer}`;
            refreshInfoStrip();
            return;
        }

        elements.versionInfo.innerHTML = `
        ${releaseLine}<br>
        Runtime: ${currentRuntime}<br>
        Version: ${version || 'resolving...'}<br>
        Requested: ${getRuntimeVersionToken()}<br>
        Source: ${source || 'resolving...'}
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
        getResolvedAppVersion,
        getShortBuildIdLabel,
        hideError,
        refreshInfoStrip,
        resolveAppVersion,
        showError,
        updateInfo,
        updateVersionInfo,
    };
}
