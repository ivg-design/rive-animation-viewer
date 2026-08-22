import {
    createCanvasBackgroundController,
    normalizeCanvasColor,
} from '../../../src/app/platform/canvas-background-controller.js';

function createElements() {
    document.body.innerHTML = `
        <div id="canvas-container"></div>
        <input id="canvas-color-input" />
        <button id="canvas-color-reset-btn"></button>
    `;

    return {
        canvasContainer: document.getElementById('canvas-container'),
        canvasColorInput: document.getElementById('canvas-color-input'),
        canvasColorResetButton: document.getElementById('canvas-color-reset-btn'),
    };
}

function mountCanvas() {
    const canvas = document.createElement('canvas');
    canvas.id = 'rive-canvas';
    document.body.appendChild(canvas);
    return canvas;
}

describe('platform/canvas-background-controller', () => {
    it('normalizes six-digit hex colors', () => {
        expect(normalizeCanvasColor('#AABBCC')).toBe('#aabbcc');
        expect(normalizeCanvasColor('#abc')).toBeNull();
        expect(normalizeCanvasColor('invalid')).toBeNull();
    });

    it('updates both canvas surfaces and resets to a transparent canvas background', () => {
        const elements = createElements();
        const canvas = mountCanvas();
        const logEvent = vi.fn();
        const controller = createCanvasBackgroundController({ callbacks: { logEvent }, elements });

        controller.setupCanvasColor();
        elements.canvasColorInput.value = '#112233';
        elements.canvasColorInput.dispatchEvent(new Event('input'));

        expect(elements.canvasContainer.style.background).toBe('rgb(17, 34, 51)');
        expect(canvas.style.background).toBe('rgb(17, 34, 51)');
        expect(controller.getStateSnapshot()).toEqual({ canvasColor: '#112233', canvasTransparent: false });
        expect(controller.isCanvasBackgroundTransparent()).toBe(false);

        elements.canvasColorResetButton.click();

        expect(elements.canvasContainer.style.background).toBe('transparent');
        expect(canvas.style.background).toBe('transparent');
        expect(controller.getStateSnapshot()).toEqual({ canvasColor: 'transparent', canvasTransparent: true });
        expect(controller.isCanvasBackgroundTransparent()).toBe(true);
        expect(logEvent).toHaveBeenCalledWith('ui', 'canvas-color', 'Canvas background reset to transparent.');
    });

    it('ignores invalid input and preserves the last valid solid color for No BG', () => {
        const elements = createElements();
        const controller = createCanvasBackgroundController({ elements });

        controller.setupCanvasColor();
        elements.canvasColorInput.value = '#bad';
        elements.canvasColorInput.dispatchEvent(new Event('input'));
        expect(controller.getStateSnapshot()).toEqual({ canvasColor: '#0d1117', canvasTransparent: false });

        elements.canvasColorInput.value = '#abcdef';
        elements.canvasColorInput.dispatchEvent(new Event('input'));
        elements.canvasColorResetButton.click();

        expect(elements.canvasColorInput.value).toBe('#abcdef');
        expect(elements.canvasColorResetButton.getAttribute('aria-pressed')).toBe('true');
    });

    it('applies the current background to canvases mounted after setup', () => {
        const elements = createElements();
        const controller = createCanvasBackgroundController({ elements });

        controller.setupCanvasColor();
        const canvas = mountCanvas();
        controller.applyCanvasBackground(canvas);

        expect(elements.canvasContainer.style.background).toBe('rgb(13, 17, 23)');
        expect(canvas.style.background).toBe('rgb(13, 17, 23)');
    });
});
