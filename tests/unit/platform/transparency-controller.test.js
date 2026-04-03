import {
    createTransparencyController,
    normalizeCanvasColor,
} from '../../../src/app/platform/transparency-controller.js';

function createElements() {
    document.body.innerHTML = `
        <div id="canvas-container"></div>
        <input id="canvas-color-input" />
        <button id="canvas-color-reset-btn"></button>
        <button id="transparency-mode-toggle"></button>
        <button id="click-through-toggle"></button>
    `;

    return {
        canvasContainer: document.getElementById('canvas-container'),
        canvasColorInput: document.getElementById('canvas-color-input'),
        canvasColorResetButton: document.getElementById('canvas-color-reset-btn'),
        clickThroughToggle: document.getElementById('click-through-toggle'),
        transparencyModeToggle: document.getElementById('transparency-mode-toggle'),
    };
}

function mountCanvas() {
    const canvas = document.createElement('canvas');
    canvas.id = 'rive-canvas';
    canvas.width = 100;
    canvas.height = 100;
    canvas.getBoundingClientRect = () => ({
        bottom: 100,
        height: 100,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
    });
    document.body.appendChild(canvas);
    return canvas;
}

describe('platform/transparency-controller', () => {
    it('normalizes six-digit hex colors', () => {
        expect(normalizeCanvasColor('#AABBCC')).toBe('#aabbcc');
        expect(normalizeCanvasColor('#abc')).toBeNull();
        expect(normalizeCanvasColor('invalid')).toBeNull();
    });

    it('updates the canvas color state and can reset back to transparent', () => {
        const elements = createElements();
        const controller = createTransparencyController({
            callbacks: {
                logEvent: vi.fn(),
            },
            elements,
            getRiveInstance: () => null,
            getTauriInvoker: () => null,
            isTauriEnvironment: () => false,
        });

        controller.setupCanvasColor();
        controller.syncTransparencyControls();

        elements.canvasColorInput.value = '#112233';
        elements.canvasColorInput.dispatchEvent(new Event('input'));

        expect(elements.canvasContainer.style.background).toBe('rgb(17, 34, 51)');
        expect(controller.getStateSnapshot()).toEqual({
            canvasColor: '#112233',
            canvasTransparent: false,
            clickThroughMode: false,
            transparencyMode: false,
        });
        expect(controller.isCanvasEffectivelyTransparent()).toBe(false);
        expect(elements.clickThroughToggle.disabled).toBe(true);

        elements.canvasColorResetButton.click();

        expect(elements.canvasContainer.style.background).toBe('transparent');
        expect(controller.getStateSnapshot().canvasTransparent).toBe(true);
        expect(controller.isCanvasEffectivelyTransparent()).toBe(true);
    });

    it('enables transparency and click-through in the desktop path and cleans up pass-through state', async () => {
        const elements = createElements();
        const canvas = mountCanvas();
        const invoke = vi.fn(async (command, payload) => {
            if (command === 'get_window_cursor_position') {
                return { x: 10, y: 10 };
            }
            return payload?.enabled ?? null;
        });
        const clearIntervalFn = vi.fn();
        const setIntervalFn = vi.fn(() => 'timer-1');
        const logEvent = vi.fn();

        canvas.getContext = vi.fn((kind) => {
            if (kind === 'webgl2') {
                return {
                    RGBA: 0x1908,
                    UNSIGNED_BYTE: 0x1401,
                    readPixels(_x, _y, _w, _h, _format, _type, pixel) {
                        pixel[3] = 0;
                    },
                };
            }
            return null;
        });

        const controller = createTransparencyController({
            callbacks: {
                logEvent,
            },
            clearIntervalFn,
            elements,
            getCurrentRuntime: () => 'webgl2',
            getRiveInstance: () => ({ id: 'rive' }),
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
            setIntervalFn,
            windowRef: {
                devicePixelRatio: 1,
                innerHeight: 100,
                innerWidth: 100,
            },
        });

        controller.setupCanvasColor();
        controller.setupTransparencyControls();
        await controller.toggleTransparencyMode();
        await controller.toggleClickThrough();

        expect(document.documentElement.classList.contains('transparency-mode')).toBe(true);
        expect(document.body.classList.contains('transparency-mode')).toBe(true);
        expect(controller.getStateSnapshot()).toEqual({
            canvasColor: '#0d1117',
            canvasTransparent: true,
            clickThroughMode: true,
            transparencyMode: true,
        });
        expect(setIntervalFn).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith('set_window_transparency_mode', { enabled: true });
        expect(invoke).toHaveBeenCalledWith('set_window_click_through_mode', { enabled: true });
        expect(invoke).toHaveBeenCalledWith('get_window_cursor_position');
        expect(invoke).toHaveBeenCalledWith('set_window_click_through', { enabled: true });
        expect(logEvent).toHaveBeenCalledWith('ui', 'transparency-mode', 'Transparency mode enabled.');
        expect(logEvent).toHaveBeenCalledWith('ui', 'click-through', 'Click-through enabled.');

        await controller.toggleTransparencyMode();

        expect(controller.getStateSnapshot()).toEqual({
            canvasColor: '#0d1117',
            canvasTransparent: false,
            clickThroughMode: false,
            transparencyMode: false,
        });
        expect(invoke).toHaveBeenCalledWith('set_window_click_through', { enabled: false });
        expect(clearIntervalFn).toHaveBeenCalledWith('timer-1');

        await controller.cleanupTransparencyRuntime();
    });

    it('uses the 2d canvas path for pass-through detection and ignores invalid color input', async () => {
        const elements = createElements();
        const canvas = mountCanvas();
        const invoke = vi.fn(async (command, payload) => {
            if (command === 'get_window_cursor_position') {
                return { x: 160, y: 160 };
            }
            return payload?.enabled ?? null;
        });

        canvas.getContext = vi.fn((kind) => {
            if (kind === '2d') {
                return {
                    getImageData: vi.fn(() => ({ data: [0, 0, 0, 0] })),
                };
            }
            return null;
        });

        const controller = createTransparencyController({
            callbacks: {
                logEvent: vi.fn(),
            },
            elements,
            getCurrentRuntime: () => 'canvas',
            getRiveInstance: () => ({ id: 'rive' }),
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
            setIntervalFn: () => 'timer-2',
            windowRef: {
                devicePixelRatio: 2,
                innerHeight: 100,
                innerWidth: 100,
            },
        });

        controller.setupCanvasColor();
        elements.canvasColorInput.value = '#bad';
        elements.canvasColorInput.dispatchEvent(new Event('input'));
        expect(elements.canvasContainer.style.background).toBe('rgb(13, 17, 23)');

        await controller.toggleClickThrough();

        expect(invoke).toHaveBeenCalledWith('set_window_click_through', { enabled: true });
        expect(controller.getStateSnapshot()).toEqual({
            canvasColor: '#0d1117',
            canvasTransparent: true,
            clickThroughMode: true,
            transparencyMode: true,
        });
    });

    it('bails out cleanly when desktop click-through is unavailable or cursor payloads are invalid', async () => {
        const elements = createElements();
        const canvas = mountCanvas();
        const invoke = vi.fn(async (command) => {
            if (command === 'get_window_cursor_position') {
                return { x: 'bad', y: 10 };
            }
            throw new Error('unsupported');
        });
        canvas.getContext = vi.fn(() => null);

        const controller = createTransparencyController({
            callbacks: {
                logEvent: vi.fn(),
            },
            clearIntervalFn: vi.fn(),
            elements,
            getCurrentRuntime: () => 'webgl2',
            getRiveInstance: () => ({ id: 'rive' }),
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
            setIntervalFn: vi.fn(() => 'timer-3'),
            windowRef: {
                devicePixelRatio: 1,
                innerHeight: 100,
                innerWidth: 100,
            },
        });

        controller.setupTransparencyControls();
        await controller.toggleClickThrough();

        expect(controller.getStateSnapshot().clickThroughMode).toBe(true);
        expect(invoke).toHaveBeenCalledWith('get_window_cursor_position');

        const unsupportedController = createTransparencyController({
            callbacks: {
                logEvent: vi.fn(),
            },
            elements: createElements(),
            getTauriInvoker: () => null,
            isTauriEnvironment: () => false,
        });
        await unsupportedController.toggleClickThrough();
        expect(unsupportedController.getStateSnapshot()).toEqual({
            canvasColor: '#0d1117',
            canvasTransparent: false,
            clickThroughMode: false,
            transparencyMode: false,
        });
    });
});
