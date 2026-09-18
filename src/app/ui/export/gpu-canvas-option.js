export function createExportGpuCanvasOption({
    getCurrentRuntime = () => 'webgl2',
    getToolbarEnabled = () => false,
    onChange = () => {},
    onInvalidatePreview = () => {},
    toggle = null,
} = {}) {
    let enabled = false;

    function isAvailable() {
        return getCurrentRuntime() === 'webgl2';
    }

    function getEnabled() {
        return isAvailable() && enabled;
    }

    function syncControl() {
        if (!toggle) return;
        toggle.checked = getEnabled();
        toggle.disabled = !isAvailable();
        toggle.title = isAvailable()
            ? 'Enable Rive GPU Canvas in generated snippets and standalone HTML.'
            : 'GPU Canvas requires the WebGL 2 renderer.';
    }

    function setEnabled(nextEnabled) {
        enabled = isAvailable() && Boolean(nextEnabled);
        syncControl();
        onInvalidatePreview();
        onChange(enabled);
        return enabled;
    }

    function initializeFromToolbar() {
        enabled = isAvailable() && Boolean(getToolbarEnabled());
        syncControl();
        return enabled;
    }

    function setup() {
        toggle?.addEventListener('change', (event) => setEnabled(event.target.checked));
    }

    return { getEnabled, initializeFromToolbar, isAvailable, setEnabled, setup };
}
