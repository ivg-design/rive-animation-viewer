import { resolveGpuCanvasConfig } from '../core/gpu-canvas.js';

export function createGpuCanvasToggleController({ callbacks = {}, elements = {} } = {}) {
    const {
        getCurrentRuntime = () => 'webgl2',
        getGpuCanvasEnabled = () => false,
        logEvent = () => {},
        reloadActiveAnimation = async () => false,
        setGpuCanvasEnabled = () => {},
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;
    const button = elements.gpuCanvasToggleButton;
    let applying = false;

    function sync(runtimeName = getCurrentRuntime()) {
        if (!button) return false;
        const available = runtimeName === 'webgl2';
        const enabled = resolveGpuCanvasConfig(runtimeName, getGpuCanvasEnabled());
        const label = `GPU Canvas: ${enabled ? 'On' : 'Off'}`;
        button.classList.toggle('is-runtime-hidden', !available);
        button.classList.toggle('is-active', enabled);
        button.disabled = applying || !available;
        button.tabIndex = available ? 0 : -1;
        button.setAttribute('aria-hidden', String(!available));
        button.setAttribute('aria-pressed', String(enabled));
        button.setAttribute('aria-label', label);
        button.title = available
            ? `${label}. Required for Rive GPU Canvas features such as 3D shaders.`
            : 'GPU Canvas is available with the WebGL 2 renderer.';
        return enabled;
    }

    async function setEnabled(enabled) {
        const next = Boolean(enabled);
        if (next === Boolean(getGpuCanvasEnabled())) {
            sync();
            return { changed: false, enabled: next };
        }
        setGpuCanvasEnabled(next);
        sync();
        updateInfo(`GPU Canvas ${next ? 'enabled' : 'disabled'}; rebuilding playback surface.`);
        logEvent('ui', 'gpu-canvas-change', `GPU Canvas ${next ? 'enabled' : 'disabled'}.`);
        applying = true;
        sync();
        try {
            await reloadActiveAnimation();
            return { changed: true, enabled: next };
        } catch (error) {
            showError(`Failed to apply GPU Canvas: ${error?.message || error}`);
            throw error;
        } finally {
            applying = false;
            sync();
        }
    }

    function setup() {
        if (!button) return;
        sync();
        button.addEventListener('click', () => {
            if (applying || getCurrentRuntime() !== 'webgl2') return;
            void setEnabled(!getGpuCanvasEnabled()).catch(() => {});
        });
    }

    return { setEnabled, setup, sync };
}
