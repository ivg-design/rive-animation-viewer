import {
    clamp,
    createShellController,
    parseCssPixels,
} from '../../../src/app/ui/shell-controller.js';

function createElements() {
    document.body.innerHTML = `
        <button id="settings-btn"></button>
        <div id="settings-popover" hidden></div>
        <select id="runtime-select">
            <option value="webgl2">WebGL</option>
            <option value="canvas">Canvas</option>
        </select>
        <select id="layout-select">
            <option value="contain">contain</option>
            <option value="cover">cover</option>
        </select>
        <select id="alignment-select">
            <option value="center">center</option>
            <option value="topLeft">topLeft</option>
        </select>
        <button id="demo-bundle-btn"></button>
        <div id="main-grid"></div>
        <div id="config-panel"></div>
        <div id="right-panel"></div>
        <div id="event-log-panel"></div>
        <div id="center-panel"></div>
        <div id="left-resizer"></div>
        <div id="right-resizer"></div>
        <div id="center-resizer"></div>
        <button id="toggle-left-panel-btn"></button>
        <button id="toggle-right-panel-btn"></button>
        <button id="show-left-panel-btn" hidden></button>
        <button id="show-right-panel-btn" hidden></button>
    `;

    const configPanel = document.getElementById('config-panel');
    const rightPanel = document.getElementById('right-panel');
    Object.defineProperty(configPanel, 'offsetWidth', { configurable: true, value: 340 });
    Object.defineProperty(rightPanel, 'offsetWidth', { configurable: true, value: 330 });

    return {
        centerPanel: document.getElementById('center-panel'),
        centerResizer: document.getElementById('center-resizer'),
        configPanel,
        demoBundleButton: document.getElementById('demo-bundle-btn'),
        eventLogPanel: document.getElementById('event-log-panel'),
        alignmentSelect: document.getElementById('alignment-select'),
        layoutSelect: document.getElementById('layout-select'),
        leftResizer: document.getElementById('left-resizer'),
        mainGrid: document.getElementById('main-grid'),
        rightPanel,
        rightResizer: document.getElementById('right-resizer'),
        runtimeSelect: document.getElementById('runtime-select'),
        settingsButton: document.getElementById('settings-btn'),
        settingsPopover: document.getElementById('settings-popover'),
        showLeftPanelButton: document.getElementById('show-left-panel-btn'),
        showRightPanelButton: document.getElementById('show-right-panel-btn'),
        toggleLeftPanelButton: document.getElementById('toggle-left-panel-btn'),
        toggleRightPanelButton: document.getElementById('toggle-right-panel-btn'),
    };
}

describe('ui/shell-controller', () => {
    it('clamps numeric values and parses pixel strings', () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(Number.NaN, 2, 4)).toBe(2);
        expect(parseCssPixels('320px', 100)).toBe(320);
        expect(parseCssPixels('', 100)).toBe(100);
    });

    it('handles runtime and layout changes and captures layout state', async () => {
        const elements = createElements();
        const ensureRuntime = vi.fn().mockResolvedValue(undefined);
        const reloadCurrentAnimation = vi.fn().mockResolvedValue(undefined);
        let currentRuntime = 'webgl2';
        let currentLayoutAlignment = 'center';
        let currentLayoutFit = 'contain';
        const setCurrentRuntime = vi.fn((value) => {
            currentRuntime = value;
        });
        const setCurrentLayoutAlignment = vi.fn((value) => {
            currentLayoutAlignment = value;
        });
        const setCurrentLayoutFit = vi.fn((value) => {
            currentLayoutFit = value;
        });
        const handleResize = vi.fn();
        const timeoutCallbacks = [];
        const windowListeners = {};
        const windowRef = {
            addEventListener: vi.fn((type, handler) => {
                windowListeners[type] = handler;
            }),
            getComputedStyle: vi.fn((element) => ({
                getPropertyValue: (property) => {
                    if (element === elements.mainGrid && property === '--right-width') {
                        return '388px';
                    }
                    if (element === elements.centerPanel && property === '--center-log-height') {
                        return '211px';
                    }
                    return '';
                },
            })),
            removeEventListener: vi.fn(),
        };
        const controller = createShellController({
            callbacks: {
                ensureRuntime,
                getCurrentFileName: () => 'demo.riv',
                getCurrentFileUrl: () => 'blob:demo',
                getCurrentLayoutAlignment: () => currentLayoutAlignment,
                getCurrentLayoutFit: () => currentLayoutFit,
                getCurrentRuntime: () => currentRuntime,
                getEventLogFilterState: () => ({ native: true }),
                getTauriInvoker: () => vi.fn(),
                getTransparencyStateSnapshot: () => ({
                    clickThroughMode: 'passthrough',
                    transparencyMode: 'transparent',
                }),
                handleResize,
                reloadCurrentAnimation,
                logEvent: vi.fn(),
                refreshInfoStrip: vi.fn(),
                setCurrentLayoutAlignment,
                setCurrentLayoutFit,
                setCurrentRuntime,
                showError: vi.fn(),
                syncTransparencyControls: vi.fn(),
                updateInfo: vi.fn(),
                updateVersionInfo: vi.fn(),
            },
            elements,
            setTimeoutFn: (callback) => {
                timeoutCallbacks.push(callback);
                return `timer-${timeoutCallbacks.length}`;
            },
            windowRef,
        });

        controller.setupRuntimeSelect();
        controller.setupAlignmentSelect();
        controller.setupLayoutSelect();
        controller.setupPanelVisibilityToggles();

        elements.runtimeSelect.value = 'canvas';
        elements.runtimeSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(setCurrentRuntime).toHaveBeenCalledWith('canvas');
        expect(ensureRuntime).toHaveBeenCalledWith('canvas');
        expect(reloadCurrentAnimation).toHaveBeenCalledTimes(1);

        elements.layoutSelect.value = 'cover';
        elements.layoutSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(setCurrentLayoutFit).toHaveBeenCalledWith('cover');

        elements.alignmentSelect.value = 'topLeft';
        elements.alignmentSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(setCurrentLayoutAlignment).toHaveBeenCalledWith('topLeft');

        elements.toggleRightPanelButton.click();
        timeoutCallbacks[timeoutCallbacks.length - 1]();

        expect(elements.mainGrid.classList.contains('right-hidden')).toBe(true);
        expect(handleResize).toHaveBeenCalled();
        expect(controller.captureLayoutStateForExport()).toEqual(expect.objectContaining({
            clickThroughMode: 'passthrough',
            eventFilters: { native: true },
            eventLogHeight: 211,
            layoutAlignment: 'topLeft',
            layoutFit: 'cover',
            rightPanelVisible: false,
            rightPanelWidth: 388,
            transparencyMode: 'transparent',
        }));
    });

    it('manages settings popover, demo button state, and cleanup', () => {
        const elements = createElements();
        const intervalCallbacks = [];
        const clearIntervalFn = vi.fn();
        const clearTimeoutFn = vi.fn();
        const controller = createShellController({
            callbacks: {
                getCurrentLayoutFit: () => 'contain',
                getCurrentRuntime: () => 'webgl2',
                getTauriInvoker: () => null,
                syncTransparencyControls: vi.fn(),
            },
            clearIntervalFn,
            clearTimeoutFn,
            elements,
            setIntervalFn: (callback) => {
                intervalCallbacks.push(callback);
                return 'interval-1';
            },
            setTimeoutFn: () => 'timeout-1',
            windowRef: {
                addEventListener: vi.fn(),
                getComputedStyle: vi.fn(() => ({ getPropertyValue: () => '' })),
            },
        });

        controller.setupSettingsPopover();
        controller.setupDemoButton();

        elements.settingsButton.click();
        expect(elements.settingsPopover.hidden).toBe(false);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(elements.settingsPopover.hidden).toBe(true);

        expect(elements.demoBundleButton.disabled).toBe(true);
        expect(intervalCallbacks).toHaveLength(1);

        controller.dispose();
        expect(clearIntervalFn).toHaveBeenCalledWith('interval-1');
    });

    it('resizes right and center panels during drag gestures', () => {
        const elements = createElements();
        const listeners = {};
        elements.mainGrid.getBoundingClientRect = () => ({ width: 1200 });
        elements.centerPanel.getBoundingClientRect = () => ({ height: 900 });
        const handleResize = vi.fn();
        const controller = createShellController({
            callbacks: {
                getCurrentLayoutFit: () => 'contain',
                getCurrentRuntime: () => 'webgl2',
                handleResize,
            },
            elements,
            windowRef: {
                addEventListener: vi.fn((type, handler) => {
                    listeners[type] = handler;
                }),
                getComputedStyle: vi.fn(() => ({ getPropertyValue: () => '' })),
                removeEventListener: vi.fn(),
            },
        });

        controller.setupPanelVisibilityToggles();
        controller.setupPanelResizers();
        controller.setupCenterResizer();

        elements.rightResizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 600 }));
        listeners.mousemove(new MouseEvent('mousemove', { clientX: 550 }));
        listeners.mouseup(new MouseEvent('mouseup', { clientX: 550 }));
        expect(elements.mainGrid.style.getPropertyValue('--right-width')).toBe('380px');

        elements.centerResizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 300 }));
        listeners.mousemove(new MouseEvent('mousemove', { clientY: 0 }));
        listeners.mouseup(new MouseEvent('mouseup', { clientY: 0 }));
        expect(elements.centerPanel.style.getPropertyValue('--center-log-height')).toBe('530px');
        expect(handleResize).toHaveBeenCalled();
    });

    it('handles runtime failures, invalid layout selections, and outside-click settings dismissal', async () => {
        const elements = createElements();
        const showError = vi.fn();
        const logEvent = vi.fn();
        const refreshInfoStrip = vi.fn();
        const updateVersionInfo = vi.fn();
        const controller = createShellController({
            callbacks: {
                ensureRuntime: vi.fn().mockRejectedValue(new Error('runtime failed')),
                getCurrentFileName: () => null,
                getCurrentFileUrl: () => null,
                getCurrentLayoutAlignment: () => 'center',
                getCurrentLayoutFit: () => 'contain',
                getCurrentRuntime: () => 'webgl2',
                logEvent,
                refreshInfoStrip,
                setCurrentRuntime: vi.fn(),
                showError,
                syncTransparencyControls: vi.fn(),
                updateInfo: vi.fn(),
                updateVersionInfo,
            },
            elements,
            windowRef: {
                addEventListener: vi.fn(),
                getComputedStyle: vi.fn(() => ({ getPropertyValue: () => '' })),
            },
        });

        controller.setupRuntimeSelect();
        controller.setupAlignmentSelect();
        controller.setupLayoutSelect();
        controller.setupSettingsPopover();

        elements.runtimeSelect.value = 'canvas';
        elements.runtimeSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();

        expect(showError).toHaveBeenCalledWith('Failed to load runtime: runtime failed');
        expect(logEvent).toHaveBeenCalledWith('native', 'runtime-load-failed', 'Failed to load runtime canvas.', expect.any(Error));
        expect(refreshInfoStrip).toHaveBeenCalled();
        expect(updateVersionInfo).toHaveBeenCalledWith('Loading runtime...');

        elements.layoutSelect.appendChild(new Option('bogus', 'bogus'));
        elements.layoutSelect.value = 'bogus';
        elements.layoutSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(showError).toHaveBeenCalledWith('Unsupported layout fit: bogus');

        elements.alignmentSelect.appendChild(new Option('bogus', 'bogus'));
        elements.alignmentSelect.value = 'bogus';
        elements.alignmentSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(showError).toHaveBeenCalledWith('Unsupported layout alignment: bogus');

        elements.settingsButton.click();
        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(elements.settingsPopover.hidden).toBe(true);
    });

    it('runs the combined setup path and can reveal both side panels', () => {
        const elements = createElements();
        const handleResize = vi.fn();
        const windowListeners = {};
        const clearTimeoutFn = vi.fn();
        const controller = createShellController({
            callbacks: {
                getCurrentLayoutAlignment: () => 'center',
                getCurrentLayoutFit: () => 'contain',
                getCurrentRuntime: () => 'webgl2',
                handleResize,
                syncTransparencyControls: vi.fn(),
            },
            clearTimeoutFn,
            elements,
            setIntervalFn: () => 'interval-setup',
            setTimeoutFn: () => 'timeout-setup',
            windowRef: {
                addEventListener: vi.fn((type, handler) => {
                    windowListeners[type] = handler;
                }),
                getComputedStyle: vi.fn(() => ({ getPropertyValue: () => '' })),
                removeEventListener: vi.fn(),
            },
        });

        controller.setup();

        elements.showLeftPanelButton.click();
        elements.toggleLeftPanelButton.click();
        elements.toggleRightPanelButton.click();
        expect(elements.showLeftPanelButton.hidden).toBe(false);
        expect(elements.showRightPanelButton.hidden).toBe(false);

        elements.showLeftPanelButton.click();
        elements.showRightPanelButton.click();

        expect(elements.showLeftPanelButton.hidden).toBe(true);
        expect(elements.showRightPanelButton.hidden).toBe(true);
        expect(windowListeners['tauri://ready']).toBeTypeOf('function');

        controller.dispose();
        expect(clearTimeoutFn).toHaveBeenCalledWith('timeout-setup');
        expect(handleResize).toHaveBeenCalled();
    });

    it('ignores no-op selections, clears demo polling when ready, and guards hidden left-panel drags', async () => {
        const elements = createElements();
        const intervalCallbacks = [];
        const timeoutCallbacks = [];
        const clearIntervalFn = vi.fn();
        const clearTimeoutFn = vi.fn();
        const windowListeners = {};
        const documentListeners = {};
        let tauriInvoker = null;
        const controller = createShellController({
            callbacks: {
                ensureRuntime: vi.fn(),
                getCurrentFileName: () => null,
                getCurrentFileUrl: () => null,
                getCurrentLayoutAlignment: () => 'center',
                getCurrentLayoutFit: () => 'contain',
                getCurrentRuntime: () => 'webgl2',
                getTauriInvoker: () => tauriInvoker,
                handleResize: vi.fn(),
                loadRiveAnimation: vi.fn(),
                logEvent: vi.fn(),
                reloadCurrentAnimation: vi.fn(),
                setCurrentLayoutAlignment: vi.fn(),
                setCurrentLayoutFit: vi.fn(),
                setCurrentRuntime: vi.fn(),
                syncTransparencyControls: vi.fn(),
                updateInfo: vi.fn(),
                updateVersionInfo: vi.fn(),
            },
            clearIntervalFn,
            clearTimeoutFn,
            documentRef: {
                ...document,
                addEventListener: vi.fn((type, handler) => {
                    documentListeners[type] = handler;
                }),
                body: document.body,
            },
            elements,
            setIntervalFn: vi.fn((callback) => {
                intervalCallbacks.push(callback);
                return `interval-${intervalCallbacks.length}`;
            }),
            setTimeoutFn: vi.fn((callback) => {
                timeoutCallbacks.push(callback);
                return `timeout-${timeoutCallbacks.length}`;
            }),
            windowRef: {
                addEventListener: vi.fn((type, handler) => {
                    windowListeners[type] = handler;
                }),
                getComputedStyle: vi.fn(() => ({ getPropertyValue: () => '' })),
                removeEventListener: vi.fn(),
            },
        });

        controller.setup();

        elements.runtimeSelect.value = 'webgl2';
        elements.runtimeSelect.dispatchEvent(new Event('change'));
        elements.layoutSelect.value = 'contain';
        elements.layoutSelect.dispatchEvent(new Event('change'));
        await Promise.resolve();

        expect(intervalCallbacks).toHaveLength(1);
        expect(timeoutCallbacks).toHaveLength(1);

        tauriInvoker = vi.fn();
        intervalCallbacks[0]();
        expect(clearIntervalFn).toHaveBeenCalledWith('interval-1');

        windowListeners['tauri://ready']();
        expect(elements.demoBundleButton.disabled).toBe(false);

        elements.settingsButton.click();
        documentListeners.click({ target: document.createElement('div') });
        expect(elements.settingsPopover.hidden).toBe(true);

        document.body.style.cursor = '';
        elements.leftResizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300 }));
        expect(document.body.style.cursor).toBe('');

        controller.dispose();
        expect(clearTimeoutFn).toHaveBeenCalledWith('timeout-1');
    });
});
