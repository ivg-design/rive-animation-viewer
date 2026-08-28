import { createDefaultRivAppController } from '../../../src/app/platform/default-riv-app/controller.js';

function createElements() {
    document.body.innerHTML = `
        <span id="default-riv-app-status" role="status">CHECKING…</span>
        <button id="default-riv-app-action-btn" disabled>UNAVAILABLE</button>
    `;
    return {
        defaultRivAppActionButton: document.getElementById('default-riv-app-action-btn'),
        defaultRivAppStatus: document.getElementById('default-riv-app-status'),
    };
}

describe('platform/default-riv-app-controller', () => {
    it('shows the named non-RAV handler and preserves the make-default action', async () => {
        const elements = createElements();
        const invoke = vi.fn(async (command) => {
            if (command === 'get_riv_default_app_status') {
                return { available: true, handlerName: 'Rive', state: 'other-app' };
            }
            if (command === 'make_rav_default_for_riv') {
                return { available: true, handlerName: 'RAV', state: 'rav-default' };
            }
            return null;
        });
        const controller = createDefaultRivAppController({
            elements,
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
        });

        await controller.setup();
        expect(elements.defaultRivAppStatus.textContent).toBe('Rive');
        expect(elements.defaultRivAppActionButton.textContent).toBe('MAKE DEFAULT');
        expect(elements.defaultRivAppActionButton.disabled).toBe(false);

        await expect(controller.apply()).resolves.toBe(true);
        expect(elements.defaultRivAppStatus.textContent).toBe('RAV DEFAULT');
        expect(elements.defaultRivAppActionButton.textContent).toBe('REPAIR ICON');
        controller.dispose();
    });

    it('uses a generic fallback only when the current handler name is absent', async () => {
        const elements = createElements();
        const controller = createDefaultRivAppController({
            elements,
            getTauriInvoker: () => async () => ({ available: true, handlerName: '', state: 'partial' }),
            isTauriEnvironment: () => true,
        });
        await controller.setup();
        expect(elements.defaultRivAppStatus.textContent).toBe('PARTIAL');
        expect(elements.defaultRivAppActionButton.textContent).toBe('MAKE DEFAULT');
        controller.dispose();
    });

    it('labels an unresolvable non-RAV handler as unknown instead of inventing an app name', async () => {
        const elements = createElements();
        const controller = createDefaultRivAppController({
            elements,
            getTauriInvoker: () => async () => ({ available: true, handlerName: '', state: 'other-app' }),
            isTauriEnvironment: () => true,
        });
        await controller.setup();
        expect(elements.defaultRivAppStatus.textContent).toBe('UNKNOWN APP');
        expect(elements.defaultRivAppActionButton.textContent).toBe('MAKE DEFAULT');
        controller.dispose();
    });

    it('keeps duplicate-copy status compact and preserves the native reason as detail', async () => {
        const elements = createElements();
        const controller = createDefaultRivAppController({
            elements,
            getTauriInvoker: () => async () => ({
                available: true,
                handlerName: 'Another RAV copy',
                reason: 'macOS is still using /tmp/RAV b0220.app.',
                state: 'rav-other-copy',
            }),
            isTauriEnvironment: () => true,
        });

        await controller.setup();
        expect(elements.defaultRivAppStatus.textContent).toBe('ANOTHER RAV');
        expect(elements.defaultRivAppStatus.title)
            .toBe('macOS is still using /tmp/RAV b0220.app.');
        expect(elements.defaultRivAppActionButton.textContent).toBe('MAKE DEFAULT');
        controller.dispose();
    });
});
