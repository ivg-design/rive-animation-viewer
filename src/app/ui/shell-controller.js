import { LAYOUT_ALIGNMENTS, LAYOUT_FITS } from '../core/constants.js';
import { resolveRiveAlignment, resolveRiveFit } from '../core/rive-layout.js';
import { dispatchPresentationChanged } from '../rive/control-events.js';
import { createDemoButtonController } from './layout/demo-button.js';
import { setupPropertiesPanelViewport } from './layout/properties-panel-viewport.js';
import { setupCenterPanelResizer, setupShellPanelResizers } from './layout/resizers.js';
import { createCanvasSizingControlsController } from './settings/canvas-sizing-controls.js';
import { getRuntimeDisplayName } from './status/status-controller.js';
import { createSettingsOverlayAdapter } from './overlay/shell-adapter.js';

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function parseCssPixels(value, fallback) {
    const numeric = Number.parseFloat(String(value || '').replace('px', '').trim());
    return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
}

export function createShellController({
    callbacks = {},
    clearIntervalFn = globalThis.clearInterval,
    clearTimeoutFn = globalThis.clearTimeout,
    documentRef = globalThis.document,
    elements,
    setIntervalFn = globalThis.setInterval,
    setTimeoutFn = globalThis.setTimeout,
    windowRef = globalThis.window,
} = {}) {
    const {
        ensureRuntime = async () => {},
        getCurrentFileName = () => null,
        getCurrentFileUrl = () => null,
        getCurrentLayoutAlignment = () => 'center',
        getCurrentLayoutFit = () => 'contain',
        getCurrentRuntime = () => 'webgl2',
        getEventLogFilterState = () => ({}),
        getRiveInstance = () => null,
        getTauriEventListener = async () => null,
        getTauriInvoker = () => null,
        getDefaultRivAppStatus = () => null,
        getInstallCounterStatus = () => null,
        handleResize = () => {},
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        reloadCurrentAnimation = async () => {},
        refreshInfoStrip = () => {},
        setCurrentCanvasSizing = () => {},
        setCurrentLayoutAlignment = () => {},
        setCurrentLayoutFit = () => {},
        setCurrentRuntime = () => {},
        setInstallCounterEnabled = async () => false,
        makeRavDefaultForRiv = async () => false,
        refreshDefaultRivAppStatus = null,
        showError = () => {},
        isTauriEnvironment = () => false,
        updateInfo = () => {},
        updateVersionInfo = () => {},
    } = callbacks;

    let isLeftPanelVisible = false;
    let isRightPanelVisible = true;
    let visibilityResizeTimeoutId = null;
    let disposePropertiesPanelViewport = () => {};
    function getSidebarVisibility() {
        return {
            left: isLeftPanelVisible,
            right: isRightPanelVisible,
        };
    }
    function persistPanelVisibility() { /* Visibility starts from a consistent default on every launch. */ }

    function applyPanelVisibilityState() {
        const grid = elements.mainGrid;
        const leftButton = elements.toggleLeftPanelButton;
        const rightButton = elements.toggleRightPanelButton;
        const showLeftButton = elements.showLeftPanelButton;
        const showRightButton = elements.showRightPanelButton;
        if (!grid || !leftButton || !rightButton || !showLeftButton || !showRightButton) {
            return getSidebarVisibility();
        }

        grid.classList.toggle('left-hidden', !isLeftPanelVisible);
        grid.classList.toggle('right-hidden', !isRightPanelVisible);
        leftButton.classList.toggle('is-collapsed', !isLeftPanelVisible);
        rightButton.classList.toggle('is-collapsed', !isRightPanelVisible);
        leftButton.setAttribute('aria-pressed', String(isLeftPanelVisible));
        rightButton.setAttribute('aria-pressed', String(isRightPanelVisible));
        leftButton.title = isLeftPanelVisible ? 'Hide Script Panel' : 'Show Script Panel';
        rightButton.title = isRightPanelVisible ? 'Hide Properties Panel' : 'Show Properties Panel';
        leftButton.setAttribute('aria-label', leftButton.title);
        rightButton.setAttribute('aria-label', rightButton.title);
        showLeftButton.hidden = isLeftPanelVisible;
        showRightButton.hidden = isRightPanelVisible;
        persistPanelVisibility();
        handleResize();
        updateVersionInfo();
        if (visibilityResizeTimeoutId) clearTimeoutFn(visibilityResizeTimeoutId);
        visibilityResizeTimeoutId = setTimeoutFn(handleResize, 250);
        return getSidebarVisibility();
    }
    function setSidebarVisibility(nextVisibility = {}) {
        if (typeof nextVisibility.left === 'boolean') {
            isLeftPanelVisible = nextVisibility.left;
        }
        if (typeof nextVisibility.right === 'boolean') {
            isRightPanelVisible = nextVisibility.right;
        }
        return applyPanelVisibilityState();
    }
    async function reloadActiveAnimation() {
        const currentFileUrl = getCurrentFileUrl();
        const currentFileName = getCurrentFileName();
        if (!currentFileUrl || !currentFileName) return;
        if (typeof reloadCurrentAnimation === 'function') {
            await reloadCurrentAnimation();
            return;
        }
        await loadRiveAnimation(currentFileUrl, currentFileName);
    }
    const canvasSizingControlsController = createCanvasSizingControlsController({
        callbacks: {
            getCurrentCanvasSizing: callbacks.getCurrentCanvasSizing,
            handleResize,
            refreshInfoStrip,
            setCurrentCanvasSizing,
            updateInfo,
        },
        documentRef,
        elements,
    });
    const {
        applyCanvasSizing: applyCanvasSizingState,
        setup: setupCanvasSizingControls,
        syncCanvasSizingControls,
    } = canvasSizingControlsController;
    const uiOverlayController = createSettingsOverlayAdapter({
        callbacks: {
            getCurrentCanvasSizing: callbacks.getCurrentCanvasSizing, getInstallCounterStatus,
            getDefaultRivAppStatus,
            getTauriEventListener,
            getTauriInvoker,
            isTauriEnvironment,
            setInstallCounterEnabled,
            makeRavDefaultForRiv,
            refreshDefaultRivAppStatus,
            showError,
        },
        documentRef,
        elements,
        syncCanvasSizingControls,
        windowRef,
    });
    const demoButtonController = createDemoButtonController({
        callbacks: {
            getTauriInvoker,
        },
        clearIntervalFn,
        documentRef,
        elements,
        setIntervalFn,
        windowRef,
    });

    function setupSettingsPopover() {
        uiOverlayController.setup();
    }
    function openUiOverlay(request) {
        return uiOverlayController.openPurpose(request);
    }
    function setupRuntimeSelect() {
        if (!elements.runtimeSelect) return;

        elements.runtimeSelect.addEventListener('change', async (event) => {
            const selected = event.target.value;
            if (selected === getCurrentRuntime()) {
                return;
            }

            setCurrentRuntime(selected);
            updateInfo(`Runtime changed to: ${getRuntimeDisplayName(selected)}`);
            refreshInfoStrip();
            updateVersionInfo('Loading runtime...');
            logEvent('ui', 'runtime-change', `Runtime set to ${getRuntimeDisplayName(selected)}`);

            try {
                await ensureRuntime(selected);
                updateVersionInfo();
                await reloadActiveAnimation();
            } catch (error) {
                showError(`Failed to load runtime: ${error.message}`);
                logEvent('native', 'runtime-load-failed', `Failed to load runtime ${selected}.`, error);
            }
        });
    }

    async function applyLiveLayout() {
        const instance = getRiveInstance();
        if (!instance) {
            return false;
        }
        const runtime = await ensureRuntime(getCurrentRuntime());
        if (!runtime?.Layout) {
            return false;
        }
        const nextLayout = {
            alignment: resolveRiveAlignment(runtime, getCurrentLayoutAlignment()),
            fit: resolveRiveFit(runtime, getCurrentLayoutFit()),
        };
        instance.layout = typeof instance.layout?.copyWith === 'function'
            ? instance.layout.copyWith(nextLayout)
            : new runtime.Layout(nextLayout);
        handleResize();
        return true;
    }

    function setupLayoutSelect() {
        const select = elements.layoutSelect;
        if (!select) return;

        select.value = getCurrentLayoutFit();
        select.addEventListener('change', async (event) => {
            const selected = event.target.value;
            if (!selected || selected === getCurrentLayoutFit()) {
                return;
            }
            if (!LAYOUT_FITS.includes(selected)) {
                showError(`Unsupported layout fit: ${selected}`);
                return;
            }
            setCurrentLayoutFit(selected);
            dispatchPresentationChanged(documentRef, { layoutFit: selected });
            updateInfo(`Layout fit set to: ${selected}`);
            logEvent('ui', 'layout-change', `Layout fit set to ${selected}`);
            try {
                await applyLiveLayout();
            } catch (error) {
                showError(`Failed to apply layout fit: ${error?.message || error}`);
            }
        });
    }

    function setupAlignmentSelect() {
        const select = elements.alignmentSelect;
        if (!select) return;

        select.value = getCurrentLayoutAlignment();
        select.addEventListener('change', async (event) => {
            const selected = event.target.value;
            if (!selected || selected === getCurrentLayoutAlignment()) {
                return;
            }
            if (!LAYOUT_ALIGNMENTS.includes(selected)) {
                showError(`Unsupported layout alignment: ${selected}`);
                return;
            }
            setCurrentLayoutAlignment(selected);
            dispatchPresentationChanged(documentRef, { layoutAlignment: selected });
            updateInfo(`Layout alignment set to: ${selected}`);
            logEvent('ui', 'alignment-change', `Layout alignment set to ${selected}`);
            try {
                await applyLiveLayout();
            } catch (error) {
                showError(`Failed to apply layout alignment: ${error?.message || error}`);
            }
        });
    }

    function setupDemoButton() {
        demoButtonController.setup();
    }

    function setupPanelResizers() {
        const grid = elements.mainGrid;
        if (!grid) {
            return;
        }
        setupShellPanelResizers({
            clamp,
            documentRef,
            elements,
            handleResize,
            isLeftPanelVisible: () => isLeftPanelVisible,
            isRightPanelVisible: () => isRightPanelVisible,
            setGridVar: (key, value) => {
                grid.style.setProperty(key, `${Math.round(value)}px`);
            },
            windowRef,
        });
    }

    function setupCenterResizer() {
        setupCenterPanelResizer({
            clamp,
            documentRef,
            elements,
            handleResize,
            windowRef,
        });
    }

    function setupPanelVisibilityToggles() {
        const leftButton = elements.toggleLeftPanelButton;
        const rightButton = elements.toggleRightPanelButton;
        const showLeftButton = elements.showLeftPanelButton;
        const showRightButton = elements.showRightPanelButton;
        if (!elements.mainGrid || !leftButton || !rightButton || !showLeftButton || !showRightButton) {
            return;
        }

        leftButton.addEventListener('click', () => {
            isLeftPanelVisible = !isLeftPanelVisible;
            applyPanelVisibilityState();
        });

        rightButton.addEventListener('click', () => {
            isRightPanelVisible = !isRightPanelVisible;
            applyPanelVisibilityState();
        });

        showLeftButton.addEventListener('click', () => {
            isLeftPanelVisible = true;
            applyPanelVisibilityState();
        });

        showRightButton.addEventListener('click', () => {
            isRightPanelVisible = true;
            applyPanelVisibilityState();
        });

        applyPanelVisibilityState();
    }

    function captureLayoutStateForExport() {
        const grid = elements.mainGrid;
        const centerPanel = elements.centerPanel;
        const eventLogPanel = elements.eventLogPanel;
        const gridStyles = grid ? windowRef.getComputedStyle(grid) : null;
        const centerStyles = centerPanel ? windowRef.getComputedStyle(centerPanel) : null;
        const rightWidth = parseCssPixels(
            grid?.style.getPropertyValue('--right-width') || gridStyles?.getPropertyValue('--right-width'),
            320,
        );
        const eventLogHeight = parseCssPixels(
            centerPanel?.style.getPropertyValue('--center-log-height') || centerStyles?.getPropertyValue('--center-log-height'),
            230,
        );

        return {
            rightPanelVisible: isRightPanelVisible,
            rightPanelWidth: rightWidth,
            eventLogCollapsed: Boolean(centerPanel?.classList.contains('event-log-collapsed') || eventLogPanel?.classList.contains('collapsed')),
            eventLogHeight,
            layoutAlignment: getCurrentLayoutAlignment(),
            layoutFit: getCurrentLayoutFit(),
            eventFilters: {
                ...getEventLogFilterState(),
            },
        };
    }

    function dispose() {
        demoButtonController.dispose();
        uiOverlayController.dispose();
        disposePropertiesPanelViewport();
        if (visibilityResizeTimeoutId) {
            clearTimeoutFn(visibilityResizeTimeoutId);
            visibilityResizeTimeoutId = null;
        }
    }

    function setup() {
        setupRuntimeSelect();
        setupLayoutSelect();
        setupAlignmentSelect();
        setupCanvasSizingControls();
        setupDemoButton();
        setupPanelResizers();
        setupCenterResizer();
        disposePropertiesPanelViewport = setupPropertiesPanelViewport({ elements });
        setupPanelVisibilityToggles();
        setupSettingsPopover();
    }

    return {
        applyPanelVisibilityState,
        applyCanvasSizingState,
        captureLayoutStateForExport,
        dispose,
        getSidebarVisibility,
        openUiOverlay,
        setSidebarVisibility,
        setup,
        setupAlignmentSelect,
        setupCanvasSizingControls,
        setupCenterResizer,
        setupDemoButton,
        setupLayoutSelect,
        setupPanelResizers,
        setupPanelVisibilityToggles,
        setupRuntimeSelect,
        setupSettingsPopover,
        uiOverlayController,
    };
}
