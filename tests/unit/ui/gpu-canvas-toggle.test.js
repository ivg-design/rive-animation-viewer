import { createGpuCanvasToggleController } from '../../../src/app/ui/gpu-canvas-toggle.js';
import {
    loadGpuCanvasPreference,
    persistGpuCanvasPreference,
    resolveGpuCanvasConfig,
} from '../../../src/app/core/gpu-canvas.js';

describe('GPU Canvas toolbar toggle', () => {
    it('persists an explicit boolean preference and activates only for WebGL 2', () => {
        const values = new Map();
        const storage = {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        };
        expect(loadGpuCanvasPreference(storage)).toBe(false);
        persistGpuCanvasPreference(true, storage);
        expect(loadGpuCanvasPreference(storage)).toBe(true);
        expect(resolveGpuCanvasConfig('webgl2', true)).toBe(true);
        expect(resolveGpuCanvasConfig('canvas', true)).toBe(false);
    });

    it('keeps its footprint hidden for Canvas and rebuilds once per WebGL toggle', async () => {
        document.body.innerHTML = '<button id="gpu"></button>';
        const button = document.getElementById('gpu');
        let runtime = 'webgl2';
        let enabled = false;
        const reloadActiveAnimation = vi.fn().mockResolvedValue(true);
        const controller = createGpuCanvasToggleController({
            callbacks: {
                getCurrentRuntime: () => runtime,
                getGpuCanvasEnabled: () => enabled,
                reloadActiveAnimation,
                setGpuCanvasEnabled: (value) => { enabled = value; },
            },
            elements: { gpuCanvasToggleButton: button },
        });

        controller.setup();
        button.click();
        await vi.waitFor(() => expect(reloadActiveAnimation).toHaveBeenCalledTimes(1));
        expect(enabled).toBe(true);
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.classList.contains('is-active')).toBe(true);

        runtime = 'canvas';
        controller.sync(runtime);
        expect(button.classList.contains('is-runtime-hidden')).toBe(true);
        expect(button.getAttribute('aria-hidden')).toBe('true');
        expect(button.disabled).toBe(true);
    });
});
