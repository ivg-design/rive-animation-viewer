import { LAYOUT_ALIGNMENTS, LAYOUT_FITS } from '../core/constants.js';
import { setupCenterPanelResizer, setupShellPanelResizers } from './layout/resizers.js';
import { getRuntimeDisplayName } from './status/status-controller.js';

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
        getTauriInvoker = () => null,
        getTransparencyStateSnapshot = () => ({
            canvasColor: '#000000',
            canvasTransparent: false,
            clickThroughMode: 'off',
            transparencyMode: 'opaque',
        }),
        handleResize = () => {},
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        reloadCurrentAnimation = async () => {},
        refreshInfoStrip = () => {},
        setCurrentLayoutAlignment = () => {},
        setCurrentLayoutFit = () => {},
        setCurrentRuntime = () => {},
        showError = () => {},
        syncTransparencyControls = () => {},
        updateInfo = () => {},
        updateVersionInfo = () => {},
    } = callbacks;

    let demoButtonIntervalId = null;
    let isLeftPanelVisible = false;
    let isRightPanelVisible = true;
    let visibilityResizeTimeoutId = null;

    function getSidebarVisibility() {
        return {
            left: isLeftPanelVisible,
            right: isRightPanelVisible,
        };
    }

    function persistPanelVisibility() {
        // Panel visibility now starts from a consistent workspace default on every launch.
    }

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

    function setupSettingsPopover() {
        const button = elements.settingsButton;
        const popover = elements.settingsPopover;
        if (!button || !popover) return;

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            popover.hidden = !popover.hidden;
        });

        documentRef.addEventListener('click', (event) => {
            if (!popover.hidden && !popover.contains(event.target) && event.target !== button) {
                popover.hidden = true;
            }
        });

        documentRef.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !popover.hidden) {
                popover.hidden = true;
            }
        });
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
            updateInfo(`Layout fit set to: ${selected}`);
            logEvent('ui', 'layout-change', `Layout fit set to ${selected}`);
            try {
                await reloadActiveAnimation();
            } catch {
                /* reloadCurrentAnimation already reports errors */
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
            updateInfo(`Layout alignment set to: ${selected}`);
            logEvent('ui', 'alignment-change', `Layout alignment set to ${selected}`);
            try {
                await reloadActiveAnimation();
            } catch {
                /* reloadCurrentAnimation already reports errors */
            }
        });
    }

    function setupDemoButton() {
        const button = elements.demoBundleButton || documentRef.getElementById('demo-bundle-btn');
        if (!button) return;

        const setButtonState = (enabled) => {
            button.disabled = !enabled;
            button.classList.toggle('demo-button--disabled', !enabled);
            button.title = enabled
                ? 'Package the current animation into a demo executable'
                : 'Available in the desktop app';
        };

        const refreshState = () => {
            setButtonState(Boolean(getTauriInvoker()));
            syncTransparencyControls();
        };

        refreshState();
        if (demoButtonIntervalId) {
            clearIntervalFn(demoButtonIntervalId);
            demoButtonIntervalId = null;
        }

        let attempts = 0;
        const maxAttempts = 20;
        demoButtonIntervalId = setIntervalFn(() => {
            refreshState();
            if (getTauriInvoker()) {
                clearIntervalFn(demoButtonIntervalId);
                demoButtonIntervalId = null;
                return;
            }
            attempts += 1;
            if (attempts >= maxAttempts) {
                clearIntervalFn(demoButtonIntervalId);
                demoButtonIntervalId = null;
            }
        }, 300);

        windowRef.addEventListener(
            'tauri://ready',
            () => {
                refreshState();
            },
            { once: true },
        );
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
        const transparencyState = getTransparencyStateSnapshot();
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
            transparencyMode: transparencyState.transparencyMode,
            clickThroughMode: transparencyState.clickThroughMode,
        };
    }

    function dispose() {
        if (demoButtonIntervalId) {
            clearIntervalFn(demoButtonIntervalId);
            demoButtonIntervalId = null;
        }
        if (visibilityResizeTimeoutId) {
            clearTimeoutFn(visibilityResizeTimeoutId);
            visibilityResizeTimeoutId = null;
        }
    }

    function setup() {
        setupRuntimeSelect();
        setupLayoutSelect();
        setupAlignmentSelect();
        setupDemoButton();
        setupPanelResizers();
        setupCenterResizer();
        setupPanelVisibilityToggles();
        setupSettingsPopover();
    }

    return {
        applyPanelVisibilityState,
        captureLayoutStateForExport,
        dispose,
        getSidebarVisibility,
        setSidebarVisibility,
        setup,
        setupAlignmentSelect,
        setupCenterResizer,
        setupDemoButton,
        setupLayoutSelect,
        setupPanelResizers,
        setupPanelVisibilityToggles,
        setupRuntimeSelect,
        setupSettingsPopover,
    };
}
