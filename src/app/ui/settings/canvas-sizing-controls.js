import {
    buildCanvasSizingStateFromViewport,
    formatAspectRatioLabel,
    normalizeCanvasSizingState,
    setCanvasSizingLock,
    setCanvasSizingMode,
    updateCanvasSizingDimension,
} from '../../core/canvas-sizing.js';

export function createCanvasSizingControlsController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
} = {}) {
    const {
        getCurrentCanvasSizing = () => normalizeCanvasSizingState(),
        handleResize = () => {},
        refreshInfoStrip = () => {},
        setCurrentCanvasSizing = () => {},
        updateInfo = () => {},
    } = callbacks;

    function getCurrentCanvasElement() {
        return documentRef.getElementById('rive-canvas');
    }

    function getViewportCanvasSizingState() {
        const canvas = getCurrentCanvasElement();
        const container = elements.canvasContainer;
        const sourceWidth = Math.round(canvas?.width || canvas?.clientWidth || container?.clientWidth || 1280);
        const sourceHeight = Math.round(canvas?.height || canvas?.clientHeight || container?.clientHeight || 720);
        return buildCanvasSizingStateFromViewport(
            Math.max(1, sourceWidth),
            Math.max(1, sourceHeight),
            getCurrentCanvasSizing(),
        );
    }

    function syncCanvasSizingControls() {
        const autoButton = elements.canvasSizeAutoButton;
        const fixedButton = elements.canvasSizeFixedButton;
        const widthInput = elements.canvasSizeWidthInput;
        const heightInput = elements.canvasSizeHeightInput;
        const lockButton = elements.canvasSizeLockButton;
        const aspectValue = elements.canvasSizeAspectValue;
        const modeNote = elements.canvasSizeModeNote;
        if (!autoButton || !fixedButton || !widthInput || !heightInput || !lockButton || !aspectValue || !modeNote) {
            return;
        }

        const state = normalizeCanvasSizingState(getCurrentCanvasSizing());
        const isFixed = state.mode === 'fixed';
        autoButton.classList.toggle('is-active', !isFixed);
        fixedButton.classList.toggle('is-active', isFixed);
        autoButton.setAttribute('aria-pressed', String(!isFixed));
        fixedButton.setAttribute('aria-pressed', String(isFixed));
        widthInput.value = String(state.width);
        heightInput.value = String(state.height);
        widthInput.disabled = !isFixed;
        heightInput.disabled = !isFixed;
        lockButton.disabled = !isFixed;
        lockButton.classList.toggle('is-active', state.lockAspectRatio);
        lockButton.setAttribute('aria-pressed', String(state.lockAspectRatio));
        aspectValue.textContent = formatAspectRatioLabel(state);
        modeNote.textContent = isFixed
            ? 'Canvas is pinned to explicit pixel dimensions.'
            : 'Canvas follows the viewer size.';
    }

    function applyCanvasSizing(nextState, message) {
        const normalized = normalizeCanvasSizingState(nextState, getCurrentCanvasSizing());
        setCurrentCanvasSizing(normalized);
        syncCanvasSizingControls();
        handleResize();
        refreshInfoStrip();
        if (message) {
            updateInfo(message);
        }
        return normalized;
    }

    function setup() {
        const autoButton = elements.canvasSizeAutoButton;
        const fixedButton = elements.canvasSizeFixedButton;
        const widthInput = elements.canvasSizeWidthInput;
        const heightInput = elements.canvasSizeHeightInput;
        const lockButton = elements.canvasSizeLockButton;
        if (!autoButton || !fixedButton || !widthInput || !heightInput || !lockButton) {
            return;
        }

        const commitDimension = (dimension) => {
            const input = dimension === 'height' ? heightInput : widthInput;
            if (!input) {
                return;
            }
            const baseline = normalizeCanvasSizingState(getCurrentCanvasSizing());
            const nextState = updateCanvasSizingDimension(
                setCanvasSizingMode(baseline, 'fixed'),
                dimension,
                input.value,
            );
            applyCanvasSizing(nextState, `Canvas size set to ${nextState.width} × ${nextState.height}px`);
        };

        autoButton.addEventListener('click', () => {
            const current = normalizeCanvasSizingState(getCurrentCanvasSizing());
            if (current.mode === 'auto') {
                syncCanvasSizingControls();
                return;
            }
            applyCanvasSizing(setCanvasSizingMode(current, 'auto'), 'Canvas sizing set to auto');
        });

        fixedButton.addEventListener('click', () => {
            const current = normalizeCanvasSizingState(getCurrentCanvasSizing());
            const nextState = current.mode === 'fixed'
                ? current
                : getViewportCanvasSizingState();
            applyCanvasSizing(
                setCanvasSizingMode(nextState, 'fixed'),
                `Canvas size fixed at ${nextState.width} × ${nextState.height}px`,
            );
        });

        widthInput.addEventListener('change', () => commitDimension('width'));
        heightInput.addEventListener('change', () => commitDimension('height'));
        [widthInput, heightInput].forEach((input, index) => {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commitDimension(index === 0 ? 'width' : 'height');
                }
            });
        });

        lockButton.addEventListener('click', () => {
            const current = normalizeCanvasSizingState(getCurrentCanvasSizing());
            const nextState = setCanvasSizingLock(
                setCanvasSizingMode(current.mode === 'fixed' ? current : getViewportCanvasSizingState(), 'fixed'),
                !current.lockAspectRatio,
            );
            applyCanvasSizing(
                nextState,
                nextState.lockAspectRatio ? 'Aspect ratio locked' : 'Aspect ratio unlocked',
            );
        });

        syncCanvasSizingControls();
    }

    return {
        applyCanvasSizing,
        setup,
        syncCanvasSizingControls,
    };
}
