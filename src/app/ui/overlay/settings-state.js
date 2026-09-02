import {
    isValidCanvasDimensionInput,
    normalizeCanvasSizingState,
} from '../../core/canvas-sizing.js';

function optionSnapshot(option) {
    return {
        disabled: Boolean(option.disabled),
        label: option.textContent || option.label || option.value || '',
        value: option.value || '',
    };
}

export function captureSettingsOverlayState(elements = {}, {
    canvasSizingState = null,
    defaultRivAppState = null,
    telemetryState = null,
} = {}) {
    const runtimeSelect = elements.runtimeVersionSelect;
    const telemetryButton = elements.installCounterEnabledButton;
    const canonicalSizing = canvasSizingState && typeof canvasSizingState === 'object'
        ? normalizeCanvasSizingState(canvasSizingState)
        : null;
    const currentBundlePath = String(defaultRivAppState?.currentBundlePath || '');
    const contentTypeHandlers = Array.isArray(defaultRivAppState?.contentTypeHandlers)
        ? defaultRivAppState.contentTypeHandlers.map((entry) => ({
            contentType: String(entry?.contentType || ''),
            handlerPath: String(entry?.handlerPath || ''),
        })).filter((entry) => entry.contentType)
        : [];
    return {
        canvas: {
            color: elements.canvasColorInput?.value || '#0d1117',
            transparent: Boolean(elements.canvasColorResetButton?.classList?.contains('is-active')),
            sizing: {
                aspectLabel: elements.canvasSizeAspectValue?.textContent || '--',
                height: canonicalSizing?.height ?? (Number(elements.canvasSizeHeightInput?.value) || 720),
                heightDraft: elements.canvasSizeHeightInput?.value ?? '',
                lockAspectRatio: elements.canvasSizeLockButton?.getAttribute?.('aria-pressed') === 'true',
                mode: elements.canvasSizeFixedButton?.getAttribute?.('aria-pressed') === 'true'
                    ? 'fixed'
                    : 'auto',
                note: elements.canvasSizeModeNote?.textContent || '',
                width: canonicalSizing?.width ?? (Number(elements.canvasSizeWidthInput?.value) || 1280),
                widthDraft: elements.canvasSizeWidthInput?.value ?? '',
            },
        },
        defaultRivApp: {
            available: Boolean(defaultRivAppState?.available),
            busy: Boolean(defaultRivAppState?.busy),
            canonicalHandlerPath: String(defaultRivAppState?.canonicalHandlerPath || ''),
            contentTypeHandlers,
            currentBundlePath,
            handlerName: String(defaultRivAppState?.handlerName || ''),
            legacyHandlerPath: String(defaultRivAppState?.legacyHandlerPath || ''),
            playHandlerPath: String(defaultRivAppState?.playHandlerPath || ''),
            reason: String(defaultRivAppState?.reason || ''),
            resolvedContentType: String(defaultRivAppState?.resolvedContentType || ''),
            resolvedHandlerPath: String(defaultRivAppState?.resolvedHandlerPath || ''),
            riviewHandlerPath: String(defaultRivAppState?.riviewHandlerPath || ''),
            state: String(defaultRivAppState?.state || 'unavailable'),
        },
        runtime: {
            customValue: elements.runtimeVersionCustomInput?.value || '',
            customVisible: elements.runtimeVersionCustomRow?.hidden === false,
            disabled: Boolean(runtimeSelect?.disabled),
            options: Array.from(runtimeSelect?.options || [], optionSnapshot),
            value: runtimeSelect?.value || 'latest',
        },
        telemetry: {
            available: telemetryState
                ? Boolean(telemetryState.available)
                : Boolean(telemetryButton && telemetryButton.textContent !== 'UNAVAILABLE'),
            busy: Boolean(telemetryState?.busy),
            enabled: telemetryState
                ? Boolean(telemetryState.enabled)
                : telemetryButton?.getAttribute?.('aria-pressed') === 'true',
        },
    };
}

export function measureSettingsOverlay({
    button,
    popover,
    viewportHeight = globalThis.innerHeight,
    viewportWidth = globalThis.innerWidth,
} = {}) {
    if (!button || !popover) return null;
    const wasHidden = popover.hidden;
    const previousVisibility = popover.style.visibility;
    const previousPointerEvents = popover.style.pointerEvents;
    popover.style.visibility = 'hidden';
    popover.style.pointerEvents = 'none';
    popover.hidden = false;
    const panelRect = popover.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    popover.hidden = wasHidden;
    popover.style.visibility = previousVisibility;
    popover.style.pointerEvents = previousPointerEvents;

    const availableWidth = Math.max(1, Number(viewportWidth || 0) - 16);
    const availableHeight = Math.max(1, Number(viewportHeight || 0) - 16);
    const width = Math.min(
        availableWidth,
        Math.max(1, Math.ceil(panelRect.width || popover.scrollWidth || 520)),
    );
    const height = Math.min(
        availableHeight,
        Math.max(1, Math.ceil(panelRect.height || popover.scrollHeight || 310)),
    );
    const maxX = Math.max(8, Number(viewportWidth || 0) - width - 8);
    const maxY = Math.max(8, Number(viewportHeight || 0) - height - 8);
    return {
        height,
        width,
        x: Math.round(Math.min(maxX, Math.max(8, buttonRect.right - width))),
        y: Math.round(Math.min(maxY, Math.max(8, buttonRect.bottom + 8))),
    };
}

function dispatch(element, type) {
    if (!element) return false;
    const EventCtor = element.ownerDocument?.defaultView?.Event || globalThis.Event;
    element.dispatchEvent(new EventCtor(type, { bubbles: true }));
    return true;
}

export function applySettingsOverlayAction({ action, value }, elements = {}) {
    switch (action) {
    case 'runtime-select':
        if (elements.runtimeVersionSelect) elements.runtimeVersionSelect.value = String(value || '');
        return dispatch(elements.runtimeVersionSelect, 'change');
    case 'runtime-custom-apply':
        if (elements.runtimeVersionCustomInput) elements.runtimeVersionCustomInput.value = String(value || '');
        elements.runtimeVersionApplyButton?.click?.();
        return Boolean(elements.runtimeVersionApplyButton);
    case 'runtime-custom-draft':
        if (elements.runtimeVersionCustomInput) elements.runtimeVersionCustomInput.value = String(value || '');
        return Boolean(elements.runtimeVersionCustomInput);
    case 'canvas-color':
        if (elements.canvasColorInput) elements.canvasColorInput.value = String(value || '');
        return dispatch(elements.canvasColorInput, 'input');
    case 'canvas-transparent':
        elements.canvasColorResetButton?.click?.();
        return Boolean(elements.canvasColorResetButton);
    case 'canvas-mode':
        (value === 'fixed' ? elements.canvasSizeFixedButton : elements.canvasSizeAutoButton)?.click?.();
        return Boolean(value === 'fixed' ? elements.canvasSizeFixedButton : elements.canvasSizeAutoButton);
    case 'canvas-width':
        if (!isValidCanvasDimensionInput(value)) return false;
        if (elements.canvasSizeWidthInput) elements.canvasSizeWidthInput.value = String(value || '');
        return dispatch(elements.canvasSizeWidthInput, 'change');
    case 'canvas-width-draft':
        if (!isValidCanvasDimensionInput(value, { allowEmpty: true })) return false;
        if (elements.canvasSizeWidthInput) elements.canvasSizeWidthInput.value = String(value || '');
        return Boolean(elements.canvasSizeWidthInput);
    case 'canvas-height':
        if (!isValidCanvasDimensionInput(value)) return false;
        if (elements.canvasSizeHeightInput) elements.canvasSizeHeightInput.value = String(value || '');
        return dispatch(elements.canvasSizeHeightInput, 'change');
    case 'canvas-height-draft':
        if (!isValidCanvasDimensionInput(value, { allowEmpty: true })) return false;
        if (elements.canvasSizeHeightInput) elements.canvasSizeHeightInput.value = String(value || '');
        return Boolean(elements.canvasSizeHeightInput);
    case 'canvas-lock':
        elements.canvasSizeLockButton?.click?.();
        return Boolean(elements.canvasSizeLockButton);
    default:
        return false;
    }
}
