import {
    CLICK_THROUGH_POLL_INTERVAL_MS,
    DEFAULT_CANVAS_COLOR,
    TRANSPARENT_CANVAS_COLOR,
} from '../core/constants.js';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function normalizeCanvasColor(rawColor) {
    const value = String(rawColor || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(value)) {
        return value;
    }
    return null;
}

export function createTransparencyController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
    getCurrentRuntime = () => 'webgl2',
    getRiveInstance = () => null,
    getTauriInvoker = () => null,
    isTauriEnvironment = () => false,
    clearIntervalFn = globalThis.clearInterval,
    setIntervalFn = globalThis.setInterval,
    windowRef = globalThis.window,
} = {}) {
    const {
        logEvent = () => {},
    } = callbacks;

    let currentCanvasColor = DEFAULT_CANVAS_COLOR;
    let lastSolidCanvasColor = DEFAULT_CANVAS_COLOR;
    let isTransparencyModeEnabled = false;
    let isClickThroughEnabled = false;
    let clickThroughMonitorTimer = null;
    let clickThroughMonitorInFlight = false;
    let clickThroughPassThroughActive = false;
    let clickThroughRequestSequence = 0;

    function canUseDesktopClickThrough() {
        return Boolean(getTauriInvoker()) && isTauriEnvironment();
    }

    function isCanvasBackgroundTransparent() {
        return currentCanvasColor === TRANSPARENT_CANVAS_COLOR;
    }

    function isCanvasEffectivelyTransparent() {
        return isTransparencyModeEnabled || isCanvasBackgroundTransparent();
    }

    function updateCanvasBackground() {
        const canvasBackground = isCanvasEffectivelyTransparent() ? 'transparent' : currentCanvasColor;
        if (elements.canvasContainer) {
            elements.canvasContainer.style.background = canvasBackground;
        }
        const canvas = documentRef.getElementById('rive-canvas');
        if (canvas) {
            canvas.style.background = canvasBackground;
        }
    }

    function updateSettingToggle(button, active) {
        if (!button) {
            return;
        }
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        button.textContent = active ? 'ON' : 'OFF';
    }

    function syncCanvasColorControls() {
        const input = elements.canvasColorInput;
        const resetButton = elements.canvasColorResetButton;
        if (!input || !resetButton) {
            return;
        }
        if (!normalizeCanvasColor(lastSolidCanvasColor)) {
            lastSolidCanvasColor = DEFAULT_CANVAS_COLOR;
        }
        input.value = lastSolidCanvasColor;
        input.classList.toggle('is-transparent', isCanvasBackgroundTransparent());
        resetButton.classList.toggle('is-active', isCanvasBackgroundTransparent());
        resetButton.setAttribute('aria-pressed', String(isCanvasBackgroundTransparent()));
    }

    function setCanvasBackgroundTransparent() {
        currentCanvasColor = TRANSPARENT_CANVAS_COLOR;
        syncCanvasColorControls();
        updateCanvasBackground();
        logEvent('ui', 'canvas-color', 'Canvas background reset to transparent.');
    }

    function syncTransparencyControls() {
        updateSettingToggle(elements.transparencyModeToggle, isTransparencyModeEnabled);

        const clickToggle = elements.clickThroughToggle;
        if (!clickToggle) {
            return;
        }

        const clickThroughSupported = canUseDesktopClickThrough();
        clickToggle.disabled = !clickThroughSupported || !isTransparencyModeEnabled;
        updateSettingToggle(clickToggle, isClickThroughEnabled);
    }

    async function setWindowTransparencyMode(enabled) {
        const invoke = getTauriInvoker();
        if (!invoke || !isTauriEnvironment()) {
            return;
        }
        try {
            await invoke('set_window_transparency_mode', { enabled });
        } catch (error) {
            console.warn('[rive-viewer] failed to set window transparency mode:', error);
        }
    }

    async function setWindowClickThrough(enabled) {
        const invoke = getTauriInvoker();
        if (!invoke || !isTauriEnvironment()) {
            return false;
        }
        const requestId = ++clickThroughRequestSequence;
        try {
            await invoke('set_window_click_through', { enabled });
            if (requestId !== clickThroughRequestSequence) {
                return false;
            }
            return true;
        } catch (error) {
            if (requestId === clickThroughRequestSequence) {
                console.warn('[rive-viewer] failed to set click-through state:', error);
            }
            return false;
        }
    }

    async function getWindowCursorPosition() {
        const invoke = getTauriInvoker();
        if (!invoke || !isTauriEnvironment()) {
            return null;
        }
        try {
            const position = await invoke('get_window_cursor_position');
            if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
                return null;
            }

            const ratio = windowRef.devicePixelRatio || 1;
            let x = position.x;
            let y = position.y;
            if ((x > windowRef.innerWidth + 2 || y > windowRef.innerHeight + 2) && ratio > 1) {
                x /= ratio;
                y /= ratio;
            }
            return { x, y };
        } catch (error) {
            console.warn('[rive-viewer] failed to query cursor position:', error);
            return null;
        }
    }

    async function setWindowClickThroughMode(enabled) {
        const invoke = getTauriInvoker();
        if (!invoke || !isTauriEnvironment()) {
            return false;
        }
        try {
            await invoke('set_window_click_through_mode', { enabled });
            return true;
        } catch (error) {
            console.warn('[rive-viewer] failed to set click-through mode:', error);
            return false;
        }
    }

    function stopClickThroughMonitor() {
        if (clickThroughMonitorTimer) {
            clearIntervalFn(clickThroughMonitorTimer);
            clickThroughMonitorTimer = null;
        }
        clickThroughMonitorInFlight = false;
    }

    async function disableClickThroughPassThrough() {
        if (!clickThroughPassThroughActive) {
            return;
        }
        clickThroughPassThroughActive = false;
        await setWindowClickThrough(false);
    }

    function isCanvasPixelTransparent(clientX, clientY) {
        const canvas = documentRef.getElementById('rive-canvas');
        if (!canvas) {
            return false;
        }
        const rect = canvas.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return false;
        }
        if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
            return false;
        }

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const pixelX = clamp(Math.floor((clientX - rect.left) * scaleX), 0, Math.max(0, canvas.width - 1));
        const pixelYFromTop = clamp(Math.floor((clientY - rect.top) * scaleY), 0, Math.max(0, canvas.height - 1));

        try {
            if (getCurrentRuntime() === 'canvas') {
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    return false;
                }
                const alpha = ctx.getImageData(pixelX, pixelYFromTop, 1, 1).data[3];
                return alpha <= 8;
            }

            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) {
                return false;
            }
            const readY = clamp(canvas.height - pixelYFromTop - 1, 0, Math.max(0, canvas.height - 1));
            const pixel = new Uint8Array(4);
            gl.readPixels(pixelX, readY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return pixel[3] <= 8;
        } catch {
            return false;
        }
    }

    async function syncClickThroughPassThrough() {
        const monitorActive = isClickThroughEnabled && isTransparencyModeEnabled && canUseDesktopClickThrough();
        if (!monitorActive || !getRiveInstance()) {
            await disableClickThroughPassThrough();
            return;
        }
        if (clickThroughMonitorInFlight) {
            return;
        }
        clickThroughMonitorInFlight = true;
        try {
            const cursor = await getWindowCursorPosition();
            if (!cursor) {
                return;
            }
            const shouldPassThrough = isCanvasPixelTransparent(cursor.x, cursor.y);
            if (shouldPassThrough === clickThroughPassThroughActive) {
                return;
            }
            const applied = await setWindowClickThrough(shouldPassThrough);
            if (applied) {
                clickThroughPassThroughActive = shouldPassThrough;
            }
        } finally {
            clickThroughMonitorInFlight = false;
        }
    }

    function startClickThroughMonitor() {
        if (clickThroughMonitorTimer) {
            return;
        }
        clickThroughMonitorTimer = setIntervalFn(() => {
            syncClickThroughPassThrough().catch(() => {
                /* noop */
            });
        }, CLICK_THROUGH_POLL_INTERVAL_MS);
        syncClickThroughPassThrough().catch(() => {
            /* noop */
        });
    }

    async function applyTransparencyMode({ source } = {}) {
        documentRef.documentElement.classList.toggle('transparency-mode', isTransparencyModeEnabled);
        documentRef.body.classList.toggle('transparency-mode', isTransparencyModeEnabled);
        syncTransparencyControls();
        updateCanvasBackground();
        await setWindowTransparencyMode(isTransparencyModeEnabled);
        const clickThroughModeActive = isClickThroughEnabled && isTransparencyModeEnabled;
        await setWindowClickThroughMode(clickThroughModeActive);
        if (clickThroughModeActive) {
            startClickThroughMonitor();
            await syncClickThroughPassThrough();
        } else {
            stopClickThroughMonitor();
            await disableClickThroughPassThrough();
        }
        if (source === 'toggle') {
            logEvent('ui', 'transparency-mode', `Transparency mode ${isTransparencyModeEnabled ? 'enabled' : 'disabled'}.`);
        }
    }

    async function toggleTransparencyMode() {
        isTransparencyModeEnabled = !isTransparencyModeEnabled;
        if (!isTransparencyModeEnabled && isClickThroughEnabled) {
            isClickThroughEnabled = false;
            stopClickThroughMonitor();
            await setWindowClickThrough(false);
        }
        await applyTransparencyMode({ source: 'toggle' });
    }

    async function toggleClickThrough() {
        if (!canUseDesktopClickThrough()) {
            return;
        }
        if (!isTransparencyModeEnabled) {
            isTransparencyModeEnabled = true;
            await applyTransparencyMode({ source: 'toggle' });
        }
        isClickThroughEnabled = !isClickThroughEnabled;
        await applyTransparencyMode({ source: 'click-through-toggle' });
        syncTransparencyControls();
        logEvent('ui', 'click-through', `Click-through ${isClickThroughEnabled ? 'enabled' : 'disabled'}.`);
    }

    function setupCanvasColor() {
        const input = elements.canvasColorInput;
        const resetButton = elements.canvasColorResetButton;
        if (!input || !resetButton) {
            return;
        }
        syncCanvasColorControls();
        input.addEventListener('input', (event) => {
            const normalized = normalizeCanvasColor(event.target.value);
            if (!normalized) {
                return;
            }
            lastSolidCanvasColor = normalized;
            currentCanvasColor = normalized;
            syncCanvasColorControls();
            updateCanvasBackground();
            logEvent('ui', 'canvas-color', `Canvas color changed to ${currentCanvasColor}`);
        });
        resetButton.addEventListener('click', () => {
            setCanvasBackgroundTransparent();
        });
        updateCanvasBackground();
    }

    function setupTransparencyControls() {
        const transparencyToggle = elements.transparencyModeToggle;
        const clickThroughToggle = elements.clickThroughToggle;
        if (!transparencyToggle || !clickThroughToggle) {
            return;
        }

        transparencyToggle.addEventListener('click', () => {
            toggleTransparencyMode().catch(() => {
                /* noop */
            });
        });

        clickThroughToggle.addEventListener('click', () => {
            toggleClickThrough().catch(() => {
                /* noop */
            });
        });

        applyTransparencyMode({ source: 'init' }).catch(() => {
            /* noop */
        });
    }

    function getStateSnapshot() {
        return {
            canvasColor: currentCanvasColor,
            canvasTransparent: isCanvasEffectivelyTransparent(),
            clickThroughMode: isClickThroughEnabled,
            transparencyMode: isTransparencyModeEnabled,
        };
    }

    async function cleanupTransparencyRuntime() {
        stopClickThroughMonitor();
        await disableClickThroughPassThrough();
    }

    return {
        applyTransparencyMode,
        cleanupTransparencyRuntime,
        getStateSnapshot,
        isCanvasEffectivelyTransparent,
        setupCanvasColor,
        setupTransparencyControls,
        syncTransparencyControls,
        toggleClickThrough,
        toggleTransparencyMode,
        updateCanvasBackground,
    };
}
