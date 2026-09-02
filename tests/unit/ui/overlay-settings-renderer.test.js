import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsOverlayRenderer } from '../../../src/app/ui/overlay/settings-renderer.js';

function fixture() {
    document.body.innerHTML = `
        <div class="ui-overlay-settings-body"></div>
        <select id="runtime-version-select"></select>
        <div id="runtime-version-custom-row"></div>
        <input id="runtime-version-custom-input" />
        <input id="canvas-color-input" type="color" />
        <button id="canvas-color-reset-btn"></button>
        <button id="canvas-size-auto-btn"></button>
        <button id="canvas-size-fixed-btn"></button>
        <input id="canvas-size-width-input" />
        <input id="canvas-size-height-input" />
        <button id="canvas-size-lock-btn"></button>
        <span id="canvas-size-aspect-value"></span>
        <span id="canvas-size-mode-note"></span>
        <button id="install-counter-enabled-btn"></button>
        <span id="default-riv-app-status"></span>
        <button id="default-riv-app-action-btn"></button>
        <button id="settings-about-btn"></button>
    `;
}

function state(overrides = {}) {
    return {
        runtime: { options: [{ value: 'latest', label: 'Latest' }], value: 'latest' },
        canvas: { color: '#0d1117', sizing: { aspectLabel: '16:9', height: 720, lockAspectRatio: false, mode: 'auto', note: 'Canvas follows viewer.', width: 1280 } },
        telemetry: { available: true, enabled: true },
        defaultRivApp: { available: true, state: 'other-app', handlerName: 'Rive' },
        ...overrides,
    };
}

describe('overlay/settings-renderer', () => {
    let emitAction;
    let requestAnimationFrame;
    let renderer;

    beforeEach(() => {
        fixture();
        emitAction = vi.fn(() => Promise.resolve(true));
        requestAnimationFrame = vi.fn((callback) => {
            callback();
            return 1;
        });
        renderer = createSettingsOverlayRenderer({
            documentRef: document,
            emitAction,
            windowRef: { cancelAnimationFrame: vi.fn(), requestAnimationFrame },
        });
    });

    it('renders native settings state without changing the focused draft and reports actual handler names', () => {
        const custom = document.getElementById('runtime-version-custom-input');
        custom.value = '2.40.0';
        custom.focus();
        renderer.render(state({
            runtime: { customValue: '2.41.0', customVisible: true, options: [{ value: 'latest', label: 'Latest' }], value: 'latest' },
        }));

        expect(custom.value).toBe('2.40.0');
        expect(document.getElementById('default-riv-app-status').textContent).toBe('Rive');
        expect(document.getElementById('default-riv-app-action-btn').textContent).toBe('MAKE DEFAULT');
        expect(document.getElementById('install-counter-enabled-btn').textContent).toBe('ON');
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('uses UNKNOWN APP only when native status has no resolvable handler name', () => {
        renderer.render(state({
            defaultRivApp: { available: true, state: 'other-app', handlerName: '' },
        }));
        expect(document.getElementById('default-riv-app-status').textContent).toBe('UNKNOWN APP');
        expect(document.getElementById('default-riv-app-action-btn').textContent).toBe('MAKE DEFAULT');
    });

    it('keeps duplicate DEV status compact while exposing the native reason as detail', () => {
        renderer.render(state({
            defaultRivApp: {
                available: true,
                handlerName: 'Another RAV copy',
                reason: 'macOS is still using /tmp/RAV b0220.app.',
                state: 'rav-other-copy',
            },
        }));

        expect(document.getElementById('default-riv-app-status').textContent).toBe('ANOTHER RAV');
        expect(document.getElementById('default-riv-app-status').title)
            .toBe('macOS is still using /tmp/RAV b0220.app.');
        expect(document.getElementById('default-riv-app-action-btn').textContent).toBe('MAKE DEFAULT');
    });

    it('renders an unconfirmed assignment as compact pending status', () => {
        renderer.render(state({
            defaultRivApp: {
                available: true,
                reason: 'macOS accepted the request but has not confirmed both content types.',
                state: 'pending',
            },
        }));

        expect(document.getElementById('default-riv-app-status').textContent).toBe('PENDING');
        expect(document.getElementById('default-riv-app-status').title)
            .toContain('has not confirmed both content types');
    });

    it('never exposes registered alias counts as a click-through workflow', () => {
        renderer.render(state({
            defaultRivApp: {
                available: true,
                claimedContentTypeCount: 7,
                reason: 'RAV owns 7 of 30 discovered .riv content types.',
                state: 'partial',
                totalContentTypeCount: 30,
            },
        }));

        expect(document.getElementById('default-riv-app-status').textContent).toBe('UNKNOWN APP');
        expect(document.getElementById('default-riv-app-action-btn').textContent).toBe('MAKE DEFAULT');
        expect(document.getElementById('default-riv-app-action-btn').title)
            .toBe('Make RAV the default app for .riv files');
    });

    it('applies the measured overflow class only when the Settings body exceeds its viewport', () => {
        const body = document.querySelector('.ui-overlay-settings-body');
        Object.defineProperties(body, {
            clientHeight: { configurable: true, value: 100 },
            scrollHeight: { configurable: true, value: 102 },
        });
        renderer.render(state());
        expect(body.classList.contains('is-scroll-constrained')).toBe(false);

        Object.defineProperty(body, 'scrollHeight', { value: 103 });
        renderer.scheduleOverflowSync();
        expect(body.classList.contains('is-scroll-constrained')).toBe(true);
    });

    it('binds the default-app action and validates dimension drafts before dispatching', async () => {
        renderer.render(state());
        renderer.bind();
        document.getElementById('default-riv-app-action-btn').click();
        expect(emitAction).toHaveBeenCalledWith('default-riv-app-apply');

        const width = document.getElementById('canvas-size-width-input');
        width.value = '9000';
        width.dispatchEvent(new Event('input', { bubbles: true }));
        expect(width.getAttribute('aria-invalid')).toBe('true');
        expect(emitAction).not.toHaveBeenCalledWith('canvas-width-draft', '9000');

        width.dispatchEvent(new Event('change', { bubbles: true }));
        expect(width.value).toBe('1280');
        expect(width.hasAttribute('aria-invalid')).toBe(false);
        expect(emitAction).not.toHaveBeenCalledWith('canvas-width', '9000');

        width.value = '640';
        width.dispatchEvent(new Event('input', { bubbles: true }));
        expect(emitAction).toHaveBeenCalledWith('canvas-width-draft', '640');
    });
});
