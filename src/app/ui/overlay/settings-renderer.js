import { isValidCanvasDimensionInput } from '../../core/canvas-sizing.js';

function setPressed(target, pressed) {
    target?.classList.toggle('is-active', Boolean(pressed));
    target?.setAttribute('aria-pressed', String(Boolean(pressed)));
}

/**
 * Native Settings overlay presentation and event bindings.
 *
 * The parent window remains the state owner; this renderer only reflects the
 * latest supplied snapshot and sends explicit overlay actions back to it.
 */
export function createSettingsOverlayRenderer({
    documentRef = globalThis.document,
    emitAction = () => Promise.resolve(false),
    windowRef = globalThis.window,
} = {}) {
    const element = (id) => documentRef?.getElementById?.(id);
    let settingsOverflowFrame = 0;

    function scheduleOverflowSync() {
        if (settingsOverflowFrame) windowRef?.cancelAnimationFrame?.(settingsOverflowFrame);
        settingsOverflowFrame = windowRef?.requestAnimationFrame?.(() => {
            settingsOverflowFrame = 0;
            const body = documentRef?.querySelector?.('.ui-overlay-settings-body');
            if (!body) return;
            body.classList.toggle(
                'is-scroll-constrained',
                body.scrollHeight > body.clientHeight + 2,
            );
        }) || 0;
    }

    function render(state = {}) {
        const runtime = state.runtime || {};
        const canvas = state.canvas || {};
        const sizing = canvas.sizing || {};
        const telemetry = state.telemetry || {};
        const defaultRivApp = state.defaultRivApp || {};
        const runtimeSelect = element('runtime-version-select');
        const previousRuntimeValue = runtimeSelect?.value;
        if (runtimeSelect && Array.isArray(runtime.options)) {
            const optionsSignature = JSON.stringify(runtime.options.map((entry) => [
                String(entry.value ?? ''),
                String(entry.label ?? entry.value ?? ''),
                Boolean(entry.disabled),
            ]));
            if (runtimeSelect.dataset.optionsSignature !== optionsSignature) {
                runtimeSelect.replaceChildren(...runtime.options.map((entry) => {
                    const option = documentRef.createElement('option');
                    option.value = String(entry.value ?? '');
                    option.textContent = String(entry.label ?? entry.value ?? '');
                    option.disabled = Boolean(entry.disabled);
                    return option;
                }));
                runtimeSelect.dataset.optionsSignature = optionsSignature;
            }
            if (documentRef.activeElement !== runtimeSelect) {
                runtimeSelect.value = String(runtime.value ?? previousRuntimeValue ?? 'latest');
            }
            runtimeSelect.disabled = Boolean(runtime.disabled);
        }
        const customRow = element('runtime-version-custom-row');
        if (customRow) customRow.hidden = !runtime.customVisible;
        const customInput = element('runtime-version-custom-input');
        if (customInput && documentRef.activeElement !== customInput) customInput.value = String(runtime.customValue || '');

        const colorInput = element('canvas-color-input');
        if (colorInput && documentRef.activeElement !== colorInput) {
            colorInput.value = String(canvas.color || '#0d1117');
            colorInput.classList.toggle('is-transparent', Boolean(canvas.transparent));
        }
        setPressed(element('canvas-color-reset-btn'), canvas.transparent);
        const fixed = sizing.mode === 'fixed';
        setPressed(element('canvas-size-auto-btn'), !fixed);
        setPressed(element('canvas-size-fixed-btn'), fixed);
        const widthInput = element('canvas-size-width-input');
        const heightInput = element('canvas-size-height-input');
        if (widthInput) {
            if (documentRef.activeElement !== widthInput) widthInput.value = String(sizing.widthDraft ?? sizing.width ?? 1280);
            widthInput.dataset.lastCommittedValue = String(sizing.width ?? 1280);
            widthInput.disabled = !fixed;
        }
        if (heightInput) {
            if (documentRef.activeElement !== heightInput) heightInput.value = String(sizing.heightDraft ?? sizing.height ?? 720);
            heightInput.dataset.lastCommittedValue = String(sizing.height ?? 720);
            heightInput.disabled = !fixed;
        }
        const lockButton = element('canvas-size-lock-btn');
        if (lockButton) lockButton.disabled = !fixed;
        setPressed(lockButton, sizing.lockAspectRatio);
        if (element('canvas-size-aspect-value')) element('canvas-size-aspect-value').textContent = String(sizing.aspectLabel || '--');
        if (element('canvas-size-mode-note')) element('canvas-size-mode-note').textContent = String(sizing.note || '');
        const telemetryButton = element('install-counter-enabled-btn');
        if (telemetryButton) {
            telemetryButton.disabled = !telemetry.available || Boolean(telemetry.busy);
            telemetryButton.textContent = telemetry.available ? (telemetry.enabled ? 'ON' : 'OFF') : 'UNAVAILABLE';
            setPressed(telemetryButton, telemetry.available && telemetry.enabled);
        }
        const defaultRivAppStatus = element('default-riv-app-status');
        const defaultRivAppButton = element('default-riv-app-action-btn');
        const defaultRivAppAvailable = Boolean(defaultRivApp.available);
        const defaultRivAppDefault = defaultRivApp.state === 'rav-default';
        const defaultRivAppLabel = defaultRivApp.busy
            ? 'CHECKING…'
            : (!defaultRivAppAvailable
                ? 'UNAVAILABLE'
                : (defaultRivAppDefault
                    ? 'RAV DEFAULT'
                    : (defaultRivApp.state === 'pending'
                        ? 'PENDING'
                        : (defaultRivApp.state === 'rav-other-copy'
                            ? 'ANOTHER RAV'
                            : (defaultRivApp.handlerName || 'UNKNOWN APP')))));
        const defaultRivAppDetail = String(defaultRivApp.reason || '');
        if (defaultRivAppStatus) {
            defaultRivAppStatus.textContent = defaultRivAppLabel;
            defaultRivAppStatus.title = defaultRivAppDetail;
            defaultRivAppStatus.setAttribute('aria-label', `Default .riv app: ${defaultRivAppLabel}${defaultRivAppDetail ? `. ${defaultRivAppDetail}` : ''}`);
        }
        if (defaultRivAppButton) {
            defaultRivAppButton.disabled = !defaultRivAppAvailable || Boolean(defaultRivApp.busy);
            defaultRivAppButton.textContent = defaultRivApp.busy
                ? 'WORKING…'
                : (!defaultRivAppAvailable
                    ? 'UNAVAILABLE'
                    : (defaultRivAppDefault ? 'REPAIR ICON' : 'MAKE DEFAULT'));
            defaultRivAppButton.title = defaultRivAppDefault
                ? 'Refresh RAV’s .riv registration and document icon metadata'
                : 'Make RAV the default app for .riv files';
            defaultRivAppButton.setAttribute('aria-label', defaultRivAppButton.title);
        }
        scheduleOverflowSync();
    }

    function bindDimensionInput(id, action) {
        const input = element(id);
        const clearValidation = () => {
            input?.removeAttribute('aria-invalid');
            input?.setCustomValidity?.('');
            input?.removeAttribute('title');
        };
        const reject = () => {
            input?.setAttribute('aria-invalid', 'true');
            input?.setCustomValidity?.('Use a whole number from 1 to 8192 pixels.');
            input?.setAttribute('title', 'Use a whole number from 1 to 8192 pixels.');
        };
        const restore = () => {
            if (!input) return;
            input.value = input.dataset.lastCommittedValue || '';
            clearValidation();
        };
        input?.addEventListener('input', () => {
            if (!isValidCanvasDimensionInput(input.value, { allowEmpty: true })) {
                reject();
                return;
            }
            clearValidation();
            void emitAction(`${action}-draft`, input.value);
        });
        input?.addEventListener('change', () => {
            if (!isValidCanvasDimensionInput(input.value)) {
                restore();
                return;
            }
            clearValidation();
            const nextValue = input.value;
            void emitAction(action, nextValue).then((applied) => {
                if (!applied) restore();
            });
        });
        input?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    function bind() {
        element('runtime-version-select')?.addEventListener('change', (event) => void emitAction('runtime-select', event.target.value));
        element('runtime-version-apply-btn')?.addEventListener('click', () => void emitAction('runtime-custom-apply', element('runtime-version-custom-input')?.value || ''));
        element('runtime-version-custom-input')?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void emitAction('runtime-custom-apply', event.target.value);
        });
        element('runtime-version-custom-input')?.addEventListener('input', (event) => void emitAction('runtime-custom-draft', event.target.value));
        element('canvas-color-input')?.addEventListener('input', (event) => void emitAction('canvas-color', event.target.value));
        element('canvas-color-reset-btn')?.addEventListener('click', () => void emitAction('canvas-transparent'));
        element('canvas-size-auto-btn')?.addEventListener('click', () => void emitAction('canvas-mode', 'auto'));
        element('canvas-size-fixed-btn')?.addEventListener('click', () => void emitAction('canvas-mode', 'fixed'));
        element('canvas-size-lock-btn')?.addEventListener('click', () => void emitAction('canvas-lock'));
        bindDimensionInput('canvas-size-width-input', 'canvas-width');
        bindDimensionInput('canvas-size-height-input', 'canvas-height');
        element('install-counter-enabled-btn')?.addEventListener('click', () => void emitAction('telemetry-toggle'));
        element('default-riv-app-action-btn')?.addEventListener('click', () => void emitAction('default-riv-app-apply'));
        element('settings-about-btn')?.addEventListener('click', () => void emitAction('about'));
    }

    return { bind, render, scheduleOverflowSync };
}
