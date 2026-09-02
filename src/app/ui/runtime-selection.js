import { getRuntimeDisplayName } from './status/status-controller.js';

export function createRuntimeSelectionController({ callbacks = {}, elements = {} } = {}) {
    const {
        ensureRuntime = async () => {},
        getCurrentRuntime = () => 'webgl2',
        logEvent = () => {},
        refreshInfoStrip = () => {},
        reloadActiveAnimation = async () => {},
        setCurrentRuntime = () => {},
        showError = () => {},
        updateInfo = () => {},
        updateVersionInfo = () => {},
    } = callbacks;

    async function select(selected) {
        if (!selected) throw new Error('Runtime is required.');
        if (elements.runtimeSelect) elements.runtimeSelect.value = selected;
        if (selected === getCurrentRuntime()) return { changed: false, runtime: selected };

        setCurrentRuntime(selected);
        updateInfo(`Runtime changed to: ${getRuntimeDisplayName(selected)}`);
        refreshInfoStrip();
        updateVersionInfo('Loading runtime...');
        logEvent('ui', 'runtime-change', `Runtime set to ${getRuntimeDisplayName(selected)}`);
        await ensureRuntime(selected);
        updateVersionInfo();
        await reloadActiveAnimation();
        return { changed: true, runtime: selected };
    }

    function setup() {
        elements.runtimeSelect?.addEventListener('change', async (event) => {
            const selected = event.target.value;
            try {
                await select(selected);
            } catch (error) {
                showError(`Failed to load runtime: ${error.message}`);
                logEvent('native', 'runtime-load-failed', `Failed to load runtime ${selected}.`, error);
            }
        });
    }

    return { select, setup };
}
