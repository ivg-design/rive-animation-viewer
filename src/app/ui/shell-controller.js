import { LAYOUT_FITS } from '../core/constants.js';
import { getRuntimeDisplayName } from './status-controller.js';

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
        refreshInfoStrip = () => {},
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

    function setupSettingsPopover() {
        const button = elements.settingsButton;
        const popover = elements.settingsPopover;
        if (!button || !popover) {
            return;
        }

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
        if (!elements.runtimeSelect) {
            return;
        }

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
                const currentFileUrl = getCurrentFileUrl();
                const currentFileName = getCurrentFileName();
                if (currentFileUrl && currentFileName) {
                    await loadRiveAnimation(currentFileUrl, currentFileName);
                }
            } catch (error) {
                showError(`Failed to load runtime: ${error.message}`);
                logEvent('native', 'runtime-load-failed', `Failed to load runtime ${selected}.`, error);
            }
        });
    }

    function setupLayoutSelect() {
        const select = elements.layoutSelect;
        if (!select) {
            return;
        }

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
            const currentFileUrl = getCurrentFileUrl();
            const currentFileName = getCurrentFileName();
            if (currentFileUrl && currentFileName) {
                try {
                    await loadRiveAnimation(currentFileUrl, currentFileName);
                } catch {
                    /* loadRiveAnimation already reports errors */
                }
            }
        });
    }

    function setupDemoButton() {
        const button = elements.demoBundleButton || documentRef.getElementById('demo-bundle-btn');
        if (!button) {
            return;
        }

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
        const leftResizer = elements.leftResizer;
        const rightResizer = elements.rightResizer;
        if (!grid || !leftResizer || !rightResizer) {
            return;
        }

        const setGridVar = (key, value) => {
            grid.style.setProperty(key, `${Math.round(value)}px`);
        };

        const startResizerDrag = (event, side) => {
            if ((side === 'left' && !isLeftPanelVisible) || (side === 'right' && !isRightPanelVisible)) {
                return;
            }
            event.preventDefault();
            const gridRect = grid.getBoundingClientRect();
            const startX = event.clientX;
            const initialLeft = grid.style.getPropertyValue('--left-width')
                ? parseFloat(grid.style.getPropertyValue('--left-width'))
                : elements.configPanel?.offsetWidth || 340;
            const initialRight = grid.style.getPropertyValue('--right-width')
                ? parseFloat(grid.style.getPropertyValue('--right-width'))
                : elements.rightPanel?.offsetWidth || 330;

            const activeResizer = side === 'left' ? leftResizer : rightResizer;
            activeResizer.classList.add('is-dragging');
            documentRef.body.style.cursor = 'col-resize';
            documentRef.body.style.userSelect = 'none';

            const onMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;
                if (side === 'left') {
                    const maxLeft = Math.max(260, gridRect.width - initialRight - 380);
                    const nextLeft = clamp(initialLeft + deltaX, 240, maxLeft);
                    setGridVar('--left-width', nextLeft);
                } else {
                    const maxRight = Math.max(320, gridRect.width - initialLeft - 320);
                    const nextRight = clamp(initialRight - deltaX, 260, maxRight);
                    setGridVar('--right-width', nextRight);
                }
                handleResize();
            };

            const onUp = () => {
                activeResizer.classList.remove('is-dragging');
                documentRef.body.style.cursor = '';
                documentRef.body.style.userSelect = '';
                windowRef.removeEventListener('mousemove', onMove);
                windowRef.removeEventListener('mouseup', onUp);
                handleResize();
            };

            windowRef.addEventListener('mousemove', onMove);
            windowRef.addEventListener('mouseup', onUp);
        };

        leftResizer.addEventListener('mousedown', (event) => startResizerDrag(event, 'left'));
        rightResizer.addEventListener('mousedown', (event) => startResizerDrag(event, 'right'));
    }

    function setupCenterResizer() {
        const centerPanel = elements.centerPanel;
        const centerResizer = elements.centerResizer;
        if (!centerPanel || !centerResizer) {
            return;
        }

        centerResizer.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const startY = event.clientY;
            const startHeight = centerPanel.style.getPropertyValue('--center-log-height')
                ? parseFloat(centerPanel.style.getPropertyValue('--center-log-height'))
                : 230;

            centerResizer.classList.add('is-dragging');
            documentRef.body.style.cursor = 'row-resize';
            documentRef.body.style.userSelect = 'none';

            const onMove = (moveEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const nextHeight = clamp(startHeight - deltaY, 120, 420);
                centerPanel.style.setProperty('--center-log-height', `${Math.round(nextHeight)}px`);
                handleResize();
            };

            const onUp = () => {
                centerResizer.classList.remove('is-dragging');
                documentRef.body.style.cursor = '';
                documentRef.body.style.userSelect = '';
                windowRef.removeEventListener('mousemove', onMove);
                windowRef.removeEventListener('mouseup', onUp);
                handleResize();
            };

            windowRef.addEventListener('mousemove', onMove);
            windowRef.addEventListener('mouseup', onUp);
        });
    }

    function setupPanelVisibilityToggles() {
        const grid = elements.mainGrid;
        const leftButton = elements.toggleLeftPanelButton;
        const rightButton = elements.toggleRightPanelButton;
        const showLeftButton = elements.showLeftPanelButton;
        const showRightButton = elements.showRightPanelButton;
        if (!grid || !leftButton || !rightButton || !showLeftButton || !showRightButton) {
            return;
        }

        const applyVisibility = () => {
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
            handleResize();
            if (visibilityResizeTimeoutId) {
                clearTimeoutFn(visibilityResizeTimeoutId);
            }
            visibilityResizeTimeoutId = setTimeoutFn(handleResize, 250);
        };

        leftButton.addEventListener('click', () => {
            isLeftPanelVisible = !isLeftPanelVisible;
            applyVisibility();
        });

        rightButton.addEventListener('click', () => {
            isRightPanelVisible = !isRightPanelVisible;
            applyVisibility();
        });

        showLeftButton.addEventListener('click', () => {
            isLeftPanelVisible = true;
            applyVisibility();
        });

        showRightButton.addEventListener('click', () => {
            isRightPanelVisible = true;
            applyVisibility();
        });

        applyVisibility();
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
        setupDemoButton();
        setupPanelResizers();
        setupCenterResizer();
        setupPanelVisibilityToggles();
        setupSettingsPopover();
    }

    return {
        captureLayoutStateForExport,
        dispose,
        setup,
        setupCenterResizer,
        setupDemoButton,
        setupLayoutSelect,
        setupPanelResizers,
        setupPanelVisibilityToggles,
        setupRuntimeSelect,
        setupSettingsPopover,
    };
}
