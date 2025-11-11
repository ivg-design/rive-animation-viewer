const RIVE_VERSION = 'latest';
const runtimeSources = {
    canvas: `https://cdn.jsdelivr.net/npm/@rive-app/canvas@${RIVE_VERSION}`,
    webgl2: `https://cdn.jsdelivr.net/npm/@rive-app/webgl2@${RIVE_VERSION}`,
};

const runtimeRegistry = {};
const runtimePromises = {};
const runtimeVersions = {};
const runtimeResolvedUrls = {};
const runtimeSourceTexts = {};
const runtimeBlobUrls = {};
const runtimeAssets = {};
const DEFAULT_LAYOUT_FIT = 'contain';
const LAYOUT_FITS = ['cover', 'contain', 'fill', 'fitWidth', 'fitHeight', 'scaleDown', 'scaleUp'];
const RUNTIME_CACHE_NAME = 'rive-runtime-cache-v1';
const RUNTIME_META_STORAGE_KEY = 'riveRuntimeMeta';

let riveInstance = null;
let currentFileUrl = null;
let currentFileName = null;
let currentRuntime = 'webgl2';
let lastObjectUrl = null;
let currentLayoutFit = DEFAULT_LAYOUT_FIT;
let currentFileBuffer = null;
let currentFileMimeType = 'application/octet-stream';
let lastInitConfig = {};
let configDirty = false;
let errorTimeoutId = null;
let tauriBridgePromise = null;
const runtimeMeta = loadRuntimeMeta();

const elements = {
    versionInfo: document.getElementById('version-info'),
    fileInput: document.getElementById('file-input'),
    runtimeSelect: document.getElementById('runtime-select'),
    layoutSelect: document.getElementById('layout-select'),
    codeEditor: document.getElementById('code-editor'),
    info: document.getElementById('info'),
    error: document.getElementById('error-message'),
    canvasContainer: document.getElementById('canvas-container'),
    mainGrid: document.getElementById('main-grid'),
    configPanel: document.getElementById('config-panel'),
    configToggle: document.getElementById('config-toggle'),
    configContent: document.getElementById('config-content'),
};

init();

function init() {
    updateVersionInfo('Loading runtime...');
    setupFileInput();
    setupRuntimeSelect();
    setupLayoutSelect();
    setupDragAndDrop();
    setupConfigToggle();
    setupCodeEditor();
    setupDemoButton();
    registerServiceWorker();
    window.addEventListener('resize', handleResize);
    window.addEventListener('beforeunload', revokeLastObjectUrl);
    ensureRuntime(currentRuntime)
        .then(() => updateVersionInfo())
        .catch((error) => showError(`Failed to load runtime: ${error.message}`));
}

function setupFileInput() {
    if (!elements.fileInput) {
        return;
    }
    elements.fileInput.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }
        if (!file.name.toLowerCase().endsWith('.riv')) {
            showError('Please select a .riv file');
            event.target.value = '';
            return;
        }

        const buffer = await file.arrayBuffer();
        const fileUrl = URL.createObjectURL(file);
        setCurrentFile(fileUrl, file.name, true, buffer, file.type);
        hideError();
        try {
            await loadRiveAnimation(fileUrl, file.name);
        } catch {
            // loadRiveAnimation already surfaced the error
        } finally {
            event.target.value = '';
        }
    });
}

function setupRuntimeSelect() {
    if (!elements.runtimeSelect) {
        return;
    }

    elements.runtimeSelect.addEventListener('change', async (event) => {
        const selected = event.target.value;
        if (selected === currentRuntime) {
            return;
        }

        currentRuntime = selected;
        updateInfo(`Runtime changed to: ${currentRuntime}`);
        updateVersionInfo('Loading runtime...');

        try {
            await ensureRuntime(currentRuntime);
            updateVersionInfo();
            if (currentFileUrl && currentFileName) {
                await loadRiveAnimation(currentFileUrl, currentFileName);
            }
        } catch (error) {
            showError(`Failed to load runtime: ${error.message}`);
        }
    });
}

function setupLayoutSelect() {
    const select = elements.layoutSelect;
    if (!select) {
        return;
    }

    select.value = currentLayoutFit;
    select.addEventListener('change', async (event) => {
        const selected = event.target.value;
        if (!selected || selected === currentLayoutFit) {
            return;
        }
        if (!LAYOUT_FITS.includes(selected)) {
            showError(`Unsupported layout fit: ${selected}`);
            return;
        }
        currentLayoutFit = selected;
        updateInfo(`Layout fit set to: ${currentLayoutFit}`);
        if (currentFileUrl && currentFileName) {
            try {
                await loadRiveAnimation(currentFileUrl, currentFileName);
            } catch {
                /* loadRiveAnimation already reports errors */
            }
        }
    });
}

function setupDragAndDrop() {
    const dropZone = elements.canvasContainer;
    if (!dropZone) {
        return;
    }

    ['dragenter', 'dragover'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            preventDefaults(event);
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            preventDefaults(event);
            if (eventName === 'dragleave') {
                const related = event.relatedTarget;
                if (related && dropZone.contains(related)) {
                    return;
                }
            }
            dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', async (event) => {
        preventDefaults(event);
        dropZone.classList.remove('drag-over');
        const file = event.dataTransfer?.files?.[0];
        if (!file) {
            return;
        }

        if (!file.name.toLowerCase().endsWith('.riv')) {
            showError('Please drop a .riv file');
            return;
        }

        const buffer = await file.arrayBuffer();
        const fileUrl = URL.createObjectURL(file);
        setCurrentFile(fileUrl, file.name, true, buffer, file.type);
        hideError();
        try {
            await loadRiveAnimation(fileUrl, file.name);
        } catch {
            // error already shown
        }
    });

    window.addEventListener('dragover', preventWindowFileDrop);
    window.addEventListener('drop', preventWindowFileDrop);
}

function setupConfigToggle() {
    const panel = elements.configPanel;
    const toggle = elements.configToggle;
    const content = elements.configContent;
    const grid = elements.mainGrid;
    if (!panel || !toggle) {
        return;
    }

    const srText = toggle.querySelector('.sr-only');

    const setCollapsed = (collapsed) => {
        panel.classList.toggle('collapsed', collapsed);
        panel.hidden = collapsed;
        if (content) {
            content.hidden = collapsed;
        }
        if (grid) {
            grid.classList.toggle('config-collapsed', collapsed);
        }
        toggle.classList.toggle('collapsed', collapsed);
        const label = collapsed ? 'Show initialization config panel' : 'Hide initialization config panel';
        toggle.setAttribute('aria-expanded', (!collapsed).toString());
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('title', label);
        if (srText) {
            srText.textContent = label;
        }
        handleResize();
    };

    toggle.addEventListener('click', () => {
        const collapsed = panel.classList.contains('collapsed');
        setCollapsed(!collapsed);
    });

    setCollapsed(panel.classList.contains('collapsed'));
}

function setupCodeEditor() {
    const editor = elements.codeEditor;
    if (!editor) {
        return;
    }
    editor.addEventListener('input', () => {
        configDirty = true;
    });
}

function setupDemoButton() {
    const button = document.getElementById('demo-bundle-btn');
    if (!button) {
        return;
    }

    const setButtonState = (enabled) => {
        button.disabled = !enabled;
        button.classList.toggle('demo-button--disabled', !enabled);
        button.title = enabled
            ? 'Package the current animation into a demo executable'
            : 'Available in the desktop app';
    };

    const attemptEnable = () => {
        ensureTauriInvokeAvailable().then((available) => {
            if (available) {
                setButtonState(true);
            }
        });
    };

    if (hasTauriInvoke()) {
        setButtonState(true);
        return;
    }

    setButtonState(false);

    attemptEnable();

    let attempts = 0;
    const maxAttempts = 20;
    const interval = setInterval(() => {
        attempts += 1;
        if (hasTauriInvoke()) {
            setButtonState(true);
            clearInterval(interval);
            return;
        }
        attemptEnable();
        if (attempts >= maxAttempts) {
            clearInterval(interval);
        }
    }, 400);

    const readyHandler = () => {
        attemptEnable();
        if (hasTauriInvoke()) {
            setButtonState(true);
            clearInterval(interval);
            window.removeEventListener('tauri://ready', readyHandler);
        }
    };
    window.addEventListener('tauri://ready', readyHandler, { once: true });
}

function preventDefaults(event) {
    event.preventDefault();
    event.stopPropagation();
}

function preventWindowFileDrop(event) {
    const types = event.dataTransfer?.types;
    if (!types) {
        return;
    }

    const hasFiles = Array.from(types).includes('Files');
    if (hasFiles) {
        event.preventDefault();
    }
}

function setCurrentFile(url, name, isObjectUrl = false, buffer, mimeType) {
    if (lastObjectUrl && lastObjectUrl !== url) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }

    if (isObjectUrl) {
        lastObjectUrl = url;
    }

    currentFileUrl = url;
    currentFileName = name;
    if (buffer instanceof ArrayBuffer) {
        currentFileBuffer = buffer;
    }
    if (mimeType) {
        currentFileMimeType = mimeType;
    }
}

async function loadRiveAnimation(fileUrl, fileName) {
    if (!fileUrl) {
        showError('Please load a Rive file first');
        return;
    }

    updateInfo(`Loading ${fileName} (${currentRuntime})...`);

    try {
        const runtime = await ensureRuntime(currentRuntime);
        const container = elements.canvasContainer;
        if (!runtime || !container) {
            throw new Error('Runtime or canvas container is not available');
        }

        cleanupInstance();
        container.innerHTML = '';

        const canvas = document.createElement('canvas');
        canvas.id = 'rive-canvas';
        container.appendChild(canvas);
        resizeCanvas(canvas);

        const userConfig = getEditorConfig();
        lastInitConfig = { ...userConfig };
        const config = { ...userConfig };
        config.src = fileUrl;
        config.canvas = canvas;
        if (typeof config.autoBind === 'undefined') {
            config.autoBind = true;
        }
        const layoutFromConfig = config.layout && typeof config.layout === 'object' ? config.layout : {};
        const { alignment, fit: _ignoredFit, ...otherLayoutProps } = layoutFromConfig;
        config.layout = new runtime.Layout({
            fit: currentLayoutFit,
            alignment: alignment || 'center',
            ...otherLayoutProps,
        });

        config.onLoad = () => {
            hideError();
            resizeCanvas(canvas);
            updateInfo(`Loaded: ${fileName} (${currentRuntime})`);
            riveInstance?.resizeDrawingSurfaceToCanvas();
            const names = Array.isArray(riveInstance?.stateMachineNames) ? riveInstance.stateMachineNames : [];
            autoFillConfigStateMachine(names);
        };

        config.onLoadError = (error) => {
            showError(`Error loading animation: ${error}`);
        };

        const instanceConfig = currentRuntime === 'webgl2'
            ? { ...config, useOffscreenRenderer: true }
            : config;

        riveInstance = new runtime.Rive(instanceConfig);
    } catch (error) {
        showError(`Error initializing Rive: ${error.message}`);
        throw error;
    }
}

async function applyCodeAndReload() {
    if (!currentFileUrl || !currentFileName) {
        showError('Please load a Rive file first');
        return;
    }

    try {
        await loadRiveAnimation(currentFileUrl, currentFileName);
    } catch {
        // loadRiveAnimation already reported the error
    }
}

function play() {
    if (riveInstance) {
        riveInstance.play();
        updateInfo('Playing');
    }
}

function pause() {
    if (riveInstance) {
        riveInstance.pause();
        updateInfo('Paused');
    }
}

function reset() {
    if (riveInstance) {
        riveInstance.reset();
        updateInfo('Reset');
    }
}

async function createDemoBundle() {
    if (!(await ensureTauriInvokeAvailable())) {
        showError('Demo bundles can only be created inside the desktop app.');
        return;
    }

    if (!currentFileBuffer || !currentFileName) {
        showError('Please load a Rive file first.');
        return;
    }

    const runtimeAsset = runtimeAssets[currentRuntime];
    if (!runtimeAsset?.text) {
        showError('Runtime data is not ready yet. Please wait for the runtime to finish loading.');
        return;
    }

    const stateMachines = Array.isArray(riveInstance?.stateMachineNames)
        ? riveInstance.stateMachineNames
        : Array.isArray(lastInitConfig.stateMachines)
            ? lastInitConfig.stateMachines
            : [];

    const payload = {
        fileName: currentFileName,
        animationBase64: arrayBufferToBase64(currentFileBuffer),
        runtimeName: currentRuntime,
        runtimeVersion: runtimeAsset.version,
        runtimeScript: runtimeAsset.text,
        autoplay: typeof lastInitConfig.autoplay === 'boolean' ? lastInitConfig.autoplay : true,
        layoutFit: currentLayoutFit,
        stateMachines,
    };

    updateInfo('Building demo bundle...');
    try {
        const outputPath = await window.__TAURI__.invoke('make_demo_bundle', payload);
        updateInfo(`Demo bundle saved to: ${outputPath}`);
    } catch (error) {
        showError(`Failed to create demo bundle: ${error.message || error}`);
    }
}

function updateInfo(message) {
    if (elements.info) {
        elements.info.textContent = message;
    }
}

function showError(message) {
    if (elements.error) {
        elements.error.textContent = message;
        elements.error.classList.add('visible');
        if (errorTimeoutId) {
            clearTimeout(errorTimeoutId);
        }
        errorTimeoutId = setTimeout(() => {
            hideError();
        }, 6000);
    }
}

function hideError() {
    if (elements.error) {
        elements.error.textContent = '';
        elements.error.classList.remove('visible');
    }
    if (errorTimeoutId) {
        clearTimeout(errorTimeoutId);
        errorTimeoutId = null;
    }
}

function getEditorConfig() {
    const code = elements.codeEditor?.value.trim();
    if (!code) {
        return {};
    }

    let parsed;
    try {
        parsed = JSON.parse(code);
    } catch (error) {
        throw new Error(`Invalid JSON config: ${error.message}`);
    }

    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Initialization config must be a JSON object');
    }

    return parsed;
}

function resizeCanvas(canvas) {
    const container = elements.canvasContainer;
    if (!container || !canvas) {
        return;
    }
    const { clientWidth, clientHeight } = container;
    canvas.width = clientWidth;
    canvas.height = clientHeight;
}

function handleResize() {
    const canvas = document.getElementById('rive-canvas');
    if (!canvas) {
        return;
    }
    resizeCanvas(canvas);
    if (riveInstance) {
        riveInstance.resizeDrawingSurfaceToCanvas();
    }
}

function cleanupInstance() {
    if (riveInstance?.cleanup) {
        riveInstance.cleanup();
    }
    riveInstance = null;
}

function revokeLastObjectUrl() {
    if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }
}

function updateVersionInfo(statusMessage) {
    if (!elements.versionInfo) {
        return;
    }

    if (statusMessage) {
        elements.versionInfo.innerHTML = `${statusMessage}<div class="version-footer">© 2025 IVG Design · MIT License · Runtime © Rive</div>`;
        return;
    }

    const runtime = runtimeRegistry[currentRuntime];
    if (!runtime) {
        elements.versionInfo.textContent = `Runtime ${currentRuntime} is loading...`;
        return;
    }

    const version = runtimeVersions[currentRuntime] || runtime.version || 'resolving...';
    const source = runtimeResolvedUrls[currentRuntime] || runtimeSources[currentRuntime];
    elements.versionInfo.innerHTML = `
        Runtime: ${currentRuntime}<br>
        Version: ${version}<br>
        Source: ${source}
        <div class="version-footer">© 2025 IVG Design · MIT License · Runtime © Rive</div>
    `;
}

function loadRuntime(runtimeName) {
    if (runtimeRegistry[runtimeName]) {
        return Promise.resolve(runtimeRegistry[runtimeName]);
    }

    if (runtimePromises[runtimeName]) {
        return runtimePromises[runtimeName];
    }

    const scriptUrl = runtimeSources[runtimeName];
    if (!scriptUrl) {
        return Promise.reject(new Error(`Unknown runtime: ${runtimeName}`));
    }

    runtimePromises[runtimeName] = (async () => {
        const asset = await prepareRuntimeAsset(runtimeName);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = asset.objectUrl;
            script.async = true;
            script.onload = () => {
                if (!window.rive) {
                    reject(new Error('Runtime did not expose the expected API'));
                    return;
                }
                runtimeRegistry[runtimeName] = window.rive;
                if (runtimeName === currentRuntime) {
                    updateVersionInfo();
                }
                resolve(window.rive);
            };
            script.onerror = () => reject(new Error(`Failed to load runtime from ${script.src}`));
            document.head.appendChild(script);
        });
    })();

    return runtimePromises[runtimeName];
}

async function prepareRuntimeAsset(runtimeName) {
    if (runtimeAssets[runtimeName]) {
        return runtimeAssets[runtimeName];
    }

    const scriptUrl = runtimeSources[runtimeName];
    if (!scriptUrl) {
        throw new Error(`Unknown runtime: ${runtimeName}`);
    }

    const { resolvedUrl, version } = await resolveRuntimeSource(scriptUrl, runtimeName);
    const asset = await fetchRuntimeAsset(resolvedUrl);
    const record = {
        objectUrl: asset.objectUrl,
        text: asset.text,
        resolvedUrl,
        version: version || runtimeMeta[runtimeName]?.version || extractVersionFromUrl(resolvedUrl) || 'unknown',
    };

    if (runtimeBlobUrls[runtimeName]) {
        URL.revokeObjectURL(runtimeBlobUrls[runtimeName]);
    }

    runtimeBlobUrls[runtimeName] = record.objectUrl;
    runtimeSourceTexts[runtimeName] = record.text;
    runtimeResolvedUrls[runtimeName] = resolvedUrl;
    runtimeVersions[runtimeName] = record.version;
    runtimeAssets[runtimeName] = record;
    persistRuntimeMeta(runtimeName, {
        resolvedUrl,
        version: record.version,
        cachedAt: Date.now(),
    });

    return record;
}

async function fetchRuntimeAsset(resolvedUrl) {
    if (typeof caches === 'undefined') {
        return fetchRuntimeDirectly(resolvedUrl);
    }

    const cache = await caches.open(RUNTIME_CACHE_NAME);
    let response = await cache.match(resolvedUrl);
    if (!response) {
        response = await fetchRuntimeRequest(resolvedUrl);
        await cache.put(resolvedUrl, response.clone());
    }
    return responseToRuntimeAsset(response);
}

async function fetchRuntimeDirectly(resolvedUrl) {
    const response = await fetchRuntimeRequest(resolvedUrl);
    return responseToRuntimeAsset(response);
}

async function fetchRuntimeRequest(resolvedUrl) {
    const response = await fetch(resolvedUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to download runtime (${response.status})`);
    }
    return response;
}

async function responseToRuntimeAsset(response) {
    const text = await response.clone().text();
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    return { text, objectUrl };
}

async function ensureRuntime(runtimeName) {
    const runtime = await loadRuntime(runtimeName);
    window.rive = runtime;
    if (runtimeName === currentRuntime) {
        updateVersionInfo();
    }
    return runtime;
}

// Expose controls for inline handlers
window.applyCodeAndReload = applyCodeAndReload;
window.play = play;
window.pause = pause;
window.reset = reset;
window.createDemoBundle = createDemoBundle;
window.__riveRuntimeCache = {
    getRuntimeSourceText: (runtimeName) => runtimeSourceTexts[runtimeName] || null,
    getRuntimeVersion: (runtimeName) => runtimeVersions[runtimeName] || null,
};
window.__riveAnimationCache = {
    getBuffer: () => currentFileBuffer,
    getName: () => currentFileName,
    getMimeType: () => currentFileMimeType,
};

function arrayBufferToBase64(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
        return '';
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

function autoFillConfigStateMachine(names) {
    const editor = elements.codeEditor;
    if (!editor || configDirty || !Array.isArray(names) || !names.length) {
        return;
    }
    const current = editor.value.trim();
    let parsed;
    if (!current) {
        parsed = {};
    } else {
        try {
            parsed = JSON.parse(current);
        } catch {
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return;
        }
    }

    const primary = names[0];
    if (Array.isArray(parsed.stateMachines) && parsed.stateMachines[0] === primary) {
        return;
    }

    parsed.stateMachines = [primary];
    editor.value = JSON.stringify(parsed, null, 2);
    lastInitConfig = { ...parsed };
    configDirty = false;
}

function hasTauriInvoke() {
    return typeof window.__TAURI__ !== 'undefined' && typeof window.__TAURI__.invoke === 'function';
}

function loadTauriBridge() {
    if (hasTauriInvoke()) {
        return Promise.resolve(true);
    }

    if (tauriBridgePromise) {
        return tauriBridgePromise;
    }

    tauriBridgePromise = new Promise((resolve) => {
        const existing = document.querySelector('script[data-tauri-bridge="true"]');
        const wireEvents = (scriptEl) => {
            scriptEl.addEventListener(
                'load',
                () => {
                    scriptEl.dataset.loaded = 'true';
                    resolve(true);
                },
                { once: true },
            );
            scriptEl.addEventListener('error', () => resolve(false), { once: true });
        };

        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve(true);
            } else {
                wireEvents(existing);
            }
            return;
        }

        const script = document.createElement('script');
        script.src = 'tauri.js';
        script.defer = true;
        script.dataset.tauriBridge = 'true';
        wireEvents(script);
        document.head.appendChild(script);
    });

    return tauriBridgePromise;
}

async function ensureTauriInvokeAvailable() {
    if (hasTauriInvoke()) {
        return true;
    }

    const hasIpc = await waitForTauriIpc();
    if (!hasIpc) {
        return false;
    }

    const loaded = await loadTauriBridge();
    return loaded && hasTauriInvoke();
}

function waitForTauriIpc(timeoutMs = 5000) {
    if (typeof window.__TAURI_IPC__ !== 'undefined') {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const check = () => {
            if (typeof window.__TAURI_IPC__ !== 'undefined') {
                resolve(true);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            setTimeout(check, 200);
        };
        check();
    });
}

function loadRuntimeMeta() {
    try {
        const raw = localStorage.getItem(RUNTIME_META_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function persistRuntimeMeta(runtimeName, meta) {
    runtimeMeta[runtimeName] = meta;
    try {
        localStorage.setItem(RUNTIME_META_STORAGE_KEY, JSON.stringify(runtimeMeta));
    } catch {
        /* ignore storage errors */
    }
}

async function resolveRuntimeSource(scriptUrl, runtimeName) {
    try {
        const response = await fetch(scriptUrl, { method: 'HEAD' });
        if (!response.ok) {
            throw new Error(`Failed to resolve runtime version (${response.status})`);
        }
        const resolvedUrl = response.url || scriptUrl;
        const headerVersion = response.headers.get('x-jsd-version') || response.headers.get('x-rv-version');
        return {
            resolvedUrl,
            version: headerVersion || extractVersionFromUrl(resolvedUrl),
        };
    } catch (error) {
        const stored = runtimeMeta[runtimeName];
        if (stored?.resolvedUrl) {
            console.warn('Falling back to cached runtime metadata', error);
            return {
                resolvedUrl: stored.resolvedUrl,
                version: stored.version || null,
            };
        }
        console.warn('Unable to resolve runtime version metadata', error);
        return { resolvedUrl: scriptUrl, version: null };
    }
}

function extractVersionFromUrl(url) {
    const match = /@([^/]+)/.exec(url);
    return match ? match[1] : null;
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('service-worker.js')
            .catch((error) => console.warn('Service worker registration failed', error));
    });
}
