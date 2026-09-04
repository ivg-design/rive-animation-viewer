import { createUiOverlayController } from '../../../src/app/ui/overlay/controller.js';
import { createSettingsOverlayAdapter } from '../../../src/app/ui/overlay/shell-adapter.js';
import {
    applySettingsOverlayAction,
    captureSettingsOverlayState,
    measureSettingsOverlay,
} from '../../../src/app/ui/overlay/settings-state.js';
import { isValidCanvasDimensionInput } from '../../../src/app/core/canvas-sizing.js';

function createElements() {
    document.body.innerHTML = `
        <div class="app-shell">
        <button id="settings-btn"></button>
        <div id="settings-popover" hidden>
            <button data-settings-action="about"></button>
        </div>
        <select id="runtime-version-select"><option value="latest">Latest</option><option value="2.39.2">2.39.2</option></select>
        <div id="runtime-version-custom-row" hidden></div>
        <input id="runtime-version-custom-input">
        <button id="runtime-version-apply-btn"></button>
        <input id="canvas-color-input" type="color" value="#112233">
        <button id="canvas-color-reset-btn" aria-pressed="false"></button>
        <button id="canvas-size-auto-btn" aria-pressed="true"></button>
        <button id="canvas-size-fixed-btn" aria-pressed="false"></button>
        <input id="canvas-size-width-input" value="800">
        <input id="canvas-size-height-input" value="600">
        <button id="canvas-size-lock-btn" aria-pressed="false"></button>
        <span id="canvas-size-aspect-value">4:3</span>
        <span id="canvas-size-mode-note">Canvas follows the viewer size.</span>
        <span id="default-riv-app-status" role="status">CHECKING…</span>
        <button id="default-riv-app-action-btn" disabled>UNAVAILABLE</button>
        <button id="install-counter-enabled-btn" aria-pressed="true">ON</button>
        </div>
    `;
    const byId = (id) => document.getElementById(id);
    return {
        canvasColorInput: byId('canvas-color-input'),
        canvasColorResetButton: byId('canvas-color-reset-btn'),
        canvasSizeAspectValue: byId('canvas-size-aspect-value'),
        canvasSizeAutoButton: byId('canvas-size-auto-btn'),
        canvasSizeFixedButton: byId('canvas-size-fixed-btn'),
        canvasSizeHeightInput: byId('canvas-size-height-input'),
        canvasSizeLockButton: byId('canvas-size-lock-btn'),
        canvasSizeModeNote: byId('canvas-size-mode-note'),
        canvasSizeWidthInput: byId('canvas-size-width-input'),
        defaultRivAppActionButton: byId('default-riv-app-action-btn'),
        defaultRivAppStatus: byId('default-riv-app-status'),
        installCounterEnabledButton: byId('install-counter-enabled-btn'),
        runtimeVersionApplyButton: byId('runtime-version-apply-btn'),
        runtimeVersionCustomInput: byId('runtime-version-custom-input'),
        runtimeVersionCustomRow: byId('runtime-version-custom-row'),
        runtimeVersionSelect: byId('runtime-version-select'),
        settingsButton: byId('settings-btn'),
        settingsPopover: byId('settings-popover'),
    };
}

describe('bounded UI overlay', () => {
    it.each([
        ['1', true],
        ['8192', true],
        ['', true],
        ['0', false],
        ['8193', false],
        ['19250', false],
        ['1.5', false],
        ['1024px', false],
    ])('validates canvas dimension draft %j as %s', (value, expected) => {
        expect(isValidCanvasDimensionInput(value, { allowEmpty: true })).toBe(expected);
    });

    it('captures Settings state without inventing a second authority model', () => {
        const state = captureSettingsOverlayState(createElements());
        expect(state).toEqual(expect.objectContaining({
            canvas: expect.objectContaining({
                color: '#112233',
                sizing: expect.objectContaining({ height: 600, mode: 'auto', width: 800 }),
            }),
            runtime: expect.objectContaining({ value: 'latest' }),
            telemetry: { available: true, busy: false, enabled: true },
            defaultRivApp: expect.objectContaining({ available: false, state: 'unavailable' }),
        }));
    });

    it('captures the Default .riv App status strictly as Settings display state', () => {
        const state = captureSettingsOverlayState(createElements(), {
            defaultRivAppState: {
                available: true,
                canonicalHandlerPath: '/Applications/RAV.app',
                contentTypeHandlers: [
                    { contentType: 'test.vendor.riv', handlerPath: '/Applications/RAV.app' },
                ],
                currentBundlePath: '/Applications/RAV.app',
                handlerName: 'RAV',
                legacyHandlerPath: '/Applications/RAV.app',
                playHandlerPath: '/Applications/RAV.app',
                reason: '',
                resolvedContentType: 'test.vendor.riv',
                resolvedHandlerPath: '/Applications/RAV.app',
                riviewHandlerPath: '/Applications/RAV.app',
                state: 'rav-default',
            },
        });
        expect(state.defaultRivApp).toEqual(expect.objectContaining({
            available: true,
            contentTypeHandlers: [
                { contentType: 'test.vendor.riv', handlerPath: '/Applications/RAV.app' },
            ],
            handlerName: 'RAV',
            resolvedContentType: 'test.vendor.riv',
            state: 'rav-default',
        }));
    });

    it('keeps committed canvas dimensions separate from a valid uncommitted draft', () => {
        const elements = createElements();
        elements.canvasSizeWidthInput.value = '1925';
        const state = captureSettingsOverlayState(elements, {
            canvasSizingState: {
                mode: 'fixed', width: 1280, height: 720, lockAspectRatio: false, aspectRatio: 16 / 9,
            },
        });
        expect(state.canvas.sizing).toEqual(expect.objectContaining({
            width: 1280,
            widthDraft: '1925',
        }));
    });

    it('routes overlay intents through the original Settings controls', () => {
        const elements = createElements();
        const colorInput = vi.fn();
        const fixedClick = vi.fn();
        elements.canvasColorInput.addEventListener('input', colorInput);
        elements.canvasSizeFixedButton.addEventListener('click', fixedClick);
        expect(applySettingsOverlayAction({ action: 'canvas-color', value: '#abcdef' }, elements)).toBe(true);
        expect(applySettingsOverlayAction({ action: 'canvas-mode', value: 'fixed' }, elements)).toBe(true);
        expect(elements.canvasColorInput.value).toBe('#abcdef');
        expect(colorInput).toHaveBeenCalledTimes(1);
        expect(fixedClick).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid dimension actions before they reach the original controls', () => {
        const elements = createElements();
        const change = vi.fn();
        elements.canvasSizeWidthInput.addEventListener('change', change);

        expect(applySettingsOverlayAction({ action: 'canvas-width', value: '19250' }, elements)).toBe(false);
        expect(elements.canvasSizeWidthInput.value).toBe('800');
        expect(change).not.toHaveBeenCalled();
    });

    it('preserves runtime and fixed-size drafts when Settings state is recaptured', () => {
        const elements = createElements();
        elements.runtimeVersionCustomInput.value = '2.40.1-custom';
        elements.canvasSizeWidthInput.value = '1024draft';
        elements.canvasSizeHeightInput.value = '768draft';
        elements.canvasSizeFixedButton.setAttribute('aria-pressed', 'true');
        elements.canvasSizeAutoButton.setAttribute('aria-pressed', 'false');

        const state = captureSettingsOverlayState(elements);

        expect(state.runtime.customValue).toBe('2.40.1-custom');
        expect(state.canvas.sizing).toEqual(expect.objectContaining({
            heightDraft: '768draft',
            mode: 'fixed',
            widthDraft: '1024draft',
        }));
    });

    it('measures an exact bounded rectangle anchored to the Settings button', () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        expect(measureSettingsOverlay({
            button: elements.settingsButton,
            popover: elements.settingsPopover,
            viewportHeight: 900,
            viewportWidth: 1000,
        })).toEqual({ height: 310, width: 520, x: 460, y: 78 });
        expect(elements.settingsPopover.hidden).toBe(true);
    });

    it('clamps Settings to a small viewport so styled overflow remains reachable', () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 45, right: 390 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        expect(measureSettingsOverlay({
            button: elements.settingsButton,
            popover: elements.settingsPopover,
            viewportHeight: 200,
            viewportWidth: 400,
        })).toEqual({ height: 184, width: 384, x: 8, y: 8 });
    });

    it('opens once, rejects stale actions, and closes the matching epoch', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: { innerHeight: 900, innerWidth: 1000, clearTimeout, setTimeout },
        });
        await controller.setup();
        expect(invoke).toHaveBeenCalledWith('close_ui_overlay', { expectedEpoch: null });
        await expect(controller.openSettings()).resolves.toBe(true);
        expect(invoke).toHaveBeenCalledWith('show_ui_overlay', expect.objectContaining({
            request: expect.objectContaining({ purpose: 'settings' }),
        }));
        const closeCallsBeforeStaleAction = invoke.mock.calls
            .filter(([command]) => command === 'close_ui_overlay').length;
        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'close', epoch: 6, purpose: 'settings', requestToken: 'test-overlay-token',
            },
        });
        expect(invoke.mock.calls.filter(([command]) => command === 'close_ui_overlay'))
            .toHaveLength(closeCallsBeforeStaleAction);
        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'close', epoch: 7, purpose: 'settings', requestToken: 'test-overlay-token',
            },
        });
        expect(invoke).toHaveBeenCalledWith('close_ui_overlay', { expectedEpoch: 7 });
        controller.dispose();
    });

    it('closes on an authoritative child pointer without stealing focus', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        elements.settingsButton.focus = vi.fn();
        const listeners = new Map();
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: window,
        });
        await controller.setup();
        await controller.openSettings();

        document.dispatchEvent(new CustomEvent('rav:render-surface-pointerdown'));
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('close_ui_overlay', { expectedEpoch: 7 }));
        expect(elements.settingsButton.focus).not.toHaveBeenCalled();
        controller.dispose();
    });

    it('closes on any main-UI pointer outside its originating toolbar control', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async () => () => {},
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: window,
        });
        await controller.setup();
        await controller.openSettings();

        const appShell = document.querySelector('.app-shell');
        const underlyingHandler = vi.fn();
        elements.canvasSizeAutoButton.addEventListener('pointerdown', underlyingHandler);
        expect(appShell.hasAttribute('inert')).toBe(true);
        expect(appShell.classList.contains('is-native-overlay-blocked')).toBe(true);

        const pointerEvent = new Event('pointerdown', { bubbles: true, cancelable: true });
        elements.canvasSizeAutoButton.dispatchEvent(pointerEvent);
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('close_ui_overlay', { expectedEpoch: 7 }));
        expect(pointerEvent.defaultPrevented).toBe(true);
        expect(underlyingHandler).not.toHaveBeenCalled();
        expect(appShell.hasAttribute('inert')).toBe(false);
        expect(appShell.classList.contains('is-native-overlay-blocked')).toBe(false);
        controller.dispose();
    });

    it('restores parent interaction when a native overlay fails to open', async () => {
        const elements = createElements();
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') throw new Error('window rejected');
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'failed-overlay-token',
                getTauriEventListener: async () => async () => () => {},
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: window,
        });
        await controller.setup();

        await expect(controller.openPurpose({
            bounds: { height: 400, width: 500, x: 100, y: 100 },
            purpose: 'export',
        })).resolves.toBe(false);

        const appShell = document.querySelector('.app-shell');
        expect(appShell.hasAttribute('inert')).toBe(false);
        expect(appShell.classList.contains('is-native-overlay-blocked')).toBe(false);
        controller.dispose();
    });

    it('does not show a prepared child until the trusted main UI acknowledges its epoch', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        let resolveShow;
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') {
                return new Promise((resolve) => { resolveShow = resolve; });
            }
            if (command === 'acknowledge_ui_overlay_adopted') {
                resolveShow?.(11);
            }
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: { innerHeight: 900, innerWidth: 1000, clearTimeout, setTimeout },
        });
        await controller.setup();
        const opening = controller.openSettings();
        await vi.waitFor(() => expect(resolveShow).toBeTypeOf('function'));
        expect(invoke).not.toHaveBeenCalledWith('acknowledge_ui_overlay_adopted', expect.anything());
        await listeners.get('ui-overlay:prepared')({
            payload: {
                epoch: 11,
                protocolVersion: 1,
                purpose: 'settings',
                requestToken: 'spoofed-token',
            },
        });
        expect(invoke).not.toHaveBeenCalledWith('acknowledge_ui_overlay_adopted', expect.anything());
        await listeners.get('ui-overlay:prepared')({
            payload: {
                epoch: 11,
                protocolVersion: 1,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
            },
        });
        await expect(opening).resolves.toBe(true);
        expect(invoke).toHaveBeenCalledWith('acknowledge_ui_overlay_adopted', { epoch: 11 });
        controller.dispose();
    });

    it('commits a restacked epoch from the ACK even when the opened event is dropped', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: window,
        });
        await controller.setup();
        await controller.openSettings();

        await listeners.get('ui-overlay:prepared')({
            payload: {
                epoch: 8,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
            },
        });
        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'close', epoch: 8, purpose: 'settings', requestToken: 'test-overlay-token',
            },
        });

        expect(invoke).toHaveBeenCalledWith('acknowledge_ui_overlay_adopted', { epoch: 8 });
        expect(invoke).toHaveBeenCalledWith('close_ui_overlay', { expectedEpoch: 8 });
        controller.dispose();
    });

    it('ignores an older opened receipt while a newer restack epoch is pending', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        let resolveAck;
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 2;
            if (command === 'acknowledge_ui_overlay_adopted') {
                return new Promise((resolve) => { resolveAck = resolve; });
            }
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: window,
        });
        await controller.setup();
        await controller.openSettings();

        const prepared = listeners.get('ui-overlay:prepared')({
            payload: {
                epoch: 3,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
            },
        });
        await vi.waitFor(() => expect(resolveAck).toBeTypeOf('function'));
        listeners.get('ui-overlay:opened')({
            payload: {
                epoch: 2,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
            },
        });
        resolveAck();
        await prepared;
        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'close', epoch: 3, purpose: 'settings', requestToken: 'test-overlay-token',
            },
        });

        expect(invoke).toHaveBeenCalledWith('close_ui_overlay', { expectedEpoch: 3 });
        controller.dispose();
    });

    it('retains the focused overlay control in state sent after a restack', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: { innerHeight: 900, innerWidth: 1000, clearTimeout, setTimeout },
        });
        await controller.setup();
        await controller.openSettings();

        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'focus-target',
                epoch: 7,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
                value: 'canvas-size-width-input',
            },
        });
        await listeners.get('ui-overlay:prepared')({
            payload: { epoch: 8, purpose: 'settings', requestToken: 'test-overlay-token' },
        });

        await vi.waitFor(() => {
            const updates = invoke.mock.calls
                .filter(([command]) => command === 'update_ui_overlay_state')
                .map(([, args]) => args);
            expect(updates.at(-1)).toEqual(expect.objectContaining({
                epoch: 8,
                state: expect.objectContaining({ focusTarget: 'canvas-size-width-input' }),
            }));
        });
        controller.dispose();
    });

    it('drains an in-flight action before adopting a restacked overlay epoch', async () => {
        const elements = createElements();
        const listeners = new Map();
        let actionStarted;
        let releaseAction;
        let selectedMode = 'compact';
        const started = new Promise((resolve) => { actionStarted = resolve; });
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: window,
        });
        await controller.setup();
        await controller.openPurpose({
            bounds: { height: 300, width: 500, x: 20, y: 20 },
            getState: () => ({ snippetMode: selectedMode }),
            handleAction: async ({ value }) => {
                actionStarted();
                await new Promise((resolve) => { releaseAction = resolve; });
                selectedMode = value;
            },
            purpose: 'export',
        });

        const action = listeners.get('ui-overlay:action')({
            payload: {
                action: 'snippet-mode',
                actionId: '7-1',
                epoch: 7,
                purpose: 'export',
                requestToken: 'test-overlay-token',
                value: 'scaffold',
            },
        });
        await started;
        const prepared = listeners.get('ui-overlay:prepared')({
            payload: { epoch: 8, purpose: 'export', requestToken: 'test-overlay-token' },
        });
        expect(invoke).not.toHaveBeenCalledWith('acknowledge_ui_overlay_adopted', expect.anything());

        releaseAction();
        await action;
        await prepared;
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
            'update_ui_overlay_state',
            expect.objectContaining({
                epoch: 8,
                state: expect.objectContaining({ snippetMode: 'scaffold' }),
            }),
        ));
        expect(invoke).toHaveBeenCalledWith('acknowledge_ui_overlay_adopted', { epoch: 8 });
        controller.dispose();
    });

    it('applies an old-child action forwarded while restack adoption is in flight', async () => {
        const elements = createElements();
        const listeners = new Map();
        let resolveAck;
        let selectedMode = 'compact';
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            if (command === 'acknowledge_ui_overlay_adopted') {
                return new Promise((resolve) => { resolveAck = resolve; });
            }
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: window,
        });
        await controller.setup();
        await controller.openPurpose({
            bounds: { height: 300, width: 500, x: 20, y: 20 },
            getState: () => ({ snippetMode: selectedMode }),
            handleAction: async ({ value }) => { selectedMode = value; },
            purpose: 'export',
        });

        const prepared = listeners.get('ui-overlay:prepared')({
            payload: { epoch: 8, purpose: 'export', requestToken: 'test-overlay-token' },
        });
        await vi.waitFor(() => expect(resolveAck).toBeTypeOf('function'));
        const oldChildAction = listeners.get('ui-overlay:action')({
            payload: {
                action: 'snippet-mode',
                actionId: '7-2',
                epoch: 7,
                purpose: 'export',
                requestToken: 'test-overlay-token',
                value: 'scaffold',
            },
        });
        resolveAck();
        await prepared;
        await oldChildAction;

        expect(selectedMode).toBe('scaffold');
        expect(invoke).toHaveBeenCalledWith(
            'update_ui_overlay_state',
            expect.objectContaining({
                epoch: 8,
                state: expect.objectContaining({ snippetMode: 'scaffold' }),
            }),
        );
        controller.dispose();
    });

    it('keeps inline Settings usable when native overlays are unsupported', async () => {
        const elements = createElements();
        const invoke = vi.fn(async (command) => command === 'is_ui_overlay_supported' ? false : null);
        const adapter = createSettingsOverlayAdapter({
            callbacks: {
                getTauriEventListener: async () => null,
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            syncCanvasSizingControls: vi.fn(),
            windowRef: window,
        });
        adapter.setup();
        elements.settingsButton.click();
        await vi.waitFor(() => expect(elements.settingsPopover.hidden).toBe(false));
        expect(invoke).not.toHaveBeenCalledWith('show_ui_overlay', expect.anything());
        adapter.dispose();
    });

    it('refreshes Default .riv App status once before native Settings opens', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        const refreshDefaultRivAppStatus = vi.fn(async () => {});
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const adapter = createSettingsOverlayAdapter({
            callbacks: {
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                refreshDefaultRivAppStatus,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            syncCanvasSizingControls: vi.fn(),
            windowRef: { innerHeight: 900, innerWidth: 1000, clearTimeout, setTimeout },
        });
        adapter.setup();
        elements.settingsButton.click();
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('show_ui_overlay', expect.anything()));
        expect(refreshDefaultRivAppStatus).toHaveBeenCalledTimes(1);
        adapter.dispose();
    });

    it('applies the authenticated Default .riv App action in the main controller only', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        const makeRavDefaultForRiv = vi.fn(async () => true);
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getDefaultRivAppStatus: () => ({ available: true, busy: false, state: 'other-app' }),
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                makeRavDefaultForRiv,
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: { innerHeight: 900, innerWidth: 1000, clearTimeout, setTimeout },
        });
        await controller.setup();
        await controller.openSettings();
        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'default-riv-app-apply',
                actionId: '7-1',
                epoch: 7,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
            },
        });
        expect(makeRavDefaultForRiv).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith('complete_ui_overlay_action', {
            actionId: '7-1', epoch: 7, message: '', ok: true,
        });
        controller.dispose();
    });

    it('reports the native Default .riv App failure reason instead of replacing it', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        const showError = vi.fn();
        let status = { available: true, busy: false, state: 'other-app' };
        const makeRavDefaultForRiv = vi.fn(async () => {
            status = {
                ...status,
                handlerName: 'Rive',
                reason: 'macOS did not confirm RAV for both .riv content types.',
                state: 'partial',
            };
            return false;
        });
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getDefaultRivAppStatus: () => status,
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                makeRavDefaultForRiv,
                showError,
            },
            documentRef: document,
            elements,
            windowRef: { innerHeight: 900, innerWidth: 1000, clearTimeout, setTimeout },
        });
        await controller.setup();
        await controller.openSettings();
        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'default-riv-app-apply',
                actionId: '7-2',
                epoch: 7,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
            },
        });
        expect(invoke).toHaveBeenCalledWith('complete_ui_overlay_action', {
            actionId: '7-2',
            epoch: 7,
            message: 'macOS did not confirm RAV for both .riv content types.',
            ok: false,
        });
        expect(showError).toHaveBeenCalledWith(expect.stringContaining(
            'macOS did not confirm RAV for both .riv content types.',
        ));
        controller.dispose();
    });

    it('identifies the handler macOS kept when Default .riv App has no reason', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        const showError = vi.fn();
        const status = {
            available: true,
            busy: false,
            canonicalHandlerPath: '/Applications/Rive.app',
            handlerName: 'Rive',
            state: 'other-app',
        };
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 8;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getDefaultRivAppStatus: () => status,
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                makeRavDefaultForRiv: vi.fn(async () => false),
                showError,
            },
            documentRef: document,
            elements,
            windowRef: { innerHeight: 900, innerWidth: 1000, clearTimeout, setTimeout },
        });
        await controller.setup();
        await controller.openSettings();
        await listeners.get('ui-overlay:action')({
            payload: {
                action: 'default-riv-app-apply',
                actionId: '8-1',
                epoch: 8,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
            },
        });
        expect(invoke).toHaveBeenCalledWith('complete_ui_overlay_action', {
            actionId: '8-1',
            epoch: 8,
            message: 'macOS still reports Rive as the default .riv app.',
            ok: false,
        });
        expect(showError).toHaveBeenCalledWith(expect.stringContaining(
            'macOS still reports Rive as the default .riv app.',
        ));
        controller.dispose();
    });

    it('falls back inline when native overlay cleanup fails during setup', async () => {
        const elements = createElements();
        const showError = vi.fn();
        const invoke = vi.fn(async (command) => {
            if (command === 'close_ui_overlay') throw new Error('native cleanup unavailable');
            if (command === 'is_ui_overlay_supported') return true;
            return null;
        });
        const adapter = createSettingsOverlayAdapter({
            callbacks: {
                getTauriEventListener: async () => async () => () => {},
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                showError,
            },
            documentRef: document,
            elements,
            syncCanvasSizingControls: vi.fn(),
            windowRef: window,
        });
        adapter.setup();
        elements.settingsButton.click();

        await vi.waitFor(() => expect(elements.settingsPopover.hidden).toBe(false));
        expect(showError).toHaveBeenCalledWith(expect.stringContaining('native cleanup unavailable'));
        expect(invoke).not.toHaveBeenCalledWith('show_ui_overlay', expect.anything());
        adapter.dispose();
    });

    it('waits for persisted telemetry state before completing the overlay action', async () => {
        const elements = createElements();
        elements.settingsButton.getBoundingClientRect = () => ({ bottom: 70, right: 980 });
        elements.settingsPopover.getBoundingClientRect = () => ({ height: 310, width: 520 });
        const listeners = new Map();
        let resolvePreference;
        let telemetryStatus = { available: true, busy: false, enabled: true };
        const invoke = vi.fn(async (command) => {
            if (command === 'is_ui_overlay_supported') return true;
            if (command === 'show_ui_overlay') return 7;
            return null;
        });
        const controller = createUiOverlayController({
            callbacks: {
                createOverlayRequestToken: () => 'test-overlay-token',
                getInstallCounterStatus: () => telemetryStatus,
                getTauriEventListener: async () => async (name, handler) => {
                    listeners.set(name, handler);
                    return () => listeners.delete(name);
                },
                getTauriInvoker: () => invoke,
                isTauriEnvironment: () => true,
                setInstallCounterEnabled: vi.fn(async () => new Promise((resolve) => {
                    telemetryStatus = { ...telemetryStatus, busy: true };
                    resolvePreference = (value) => {
                        telemetryStatus = { available: true, busy: false, enabled: false };
                        resolve(value);
                    };
                })),
                showError: vi.fn(),
            },
            documentRef: document,
            elements,
            windowRef: window,
        });
        await controller.setup();
        await controller.openSettings();

        const applying = listeners.get('ui-overlay:action')({
            payload: {
                action: 'telemetry-toggle',
                actionId: '7-1',
                epoch: 7,
                purpose: 'settings',
                requestToken: 'test-overlay-token',
            },
        });
        await vi.waitFor(() => expect(resolvePreference).toBeTypeOf('function'));
        expect(invoke).not.toHaveBeenCalledWith('complete_ui_overlay_action', expect.anything());
        resolvePreference(true);
        await applying;

        expect(invoke).toHaveBeenCalledWith('complete_ui_overlay_action', {
            actionId: '7-1',
            epoch: 7,
            message: '',
            ok: true,
        });
        controller.dispose();
    });
});
