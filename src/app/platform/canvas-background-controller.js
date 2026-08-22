import {
    DEFAULT_CANVAS_COLOR,
    TRANSPARENT_CANVAS_COLOR,
} from '../core/constants.js';

export function normalizeCanvasColor(rawColor) {
    const value = String(rawColor || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(value)) {
        return value;
    }
    return null;
}

export function createCanvasBackgroundController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
} = {}) {
    const {
        logEvent = () => {},
    } = callbacks;

    let currentCanvasColor = DEFAULT_CANVAS_COLOR;
    let lastSolidCanvasColor = DEFAULT_CANVAS_COLOR;

    function isCanvasBackgroundTransparent() {
        return currentCanvasColor === TRANSPARENT_CANVAS_COLOR;
    }

    function updateCanvasBackground(canvas = documentRef.getElementById('rive-canvas')) {
        const canvasBackground = isCanvasBackgroundTransparent() ? 'transparent' : currentCanvasColor;
        if (elements.canvasContainer) {
            elements.canvasContainer.style.background = canvasBackground;
        }
        if (canvas) {
            canvas.style.background = canvasBackground;
        }
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

    function getStateSnapshot() {
        return {
            canvasColor: currentCanvasColor,
            canvasTransparent: isCanvasBackgroundTransparent(),
        };
    }

    return {
        applyCanvasBackground: updateCanvasBackground,
        getStateSnapshot,
        isCanvasBackgroundTransparent,
        setupCanvasColor,
    };
}
