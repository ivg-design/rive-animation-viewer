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
        expect(elements.defaultRivAppStatus.textContent).toBe('UNKNOWN APP');
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

    it('preserves every dynamically discovered .riv handler in the status snapshot', async () => {
        const elements = createElements();
        const dynamicHandlers = Array.from({ length: 30 }, (_, index) => ({
            contentType: `test.vendor.${index}.riv`,
            handlerPath: '/Applications/RAV.app',
        }));
        const controller = createDefaultRivAppController({
            elements,
            getTauriInvoker: () => async () => ({
                available: true,
                contentTypeHandlers: dynamicHandlers,
                currentBundlePath: '/Applications/RAV.app',
                handlerName: 'RAV',
                resolvedContentType: dynamicHandlers[0].contentType,
                resolvedHandlerPath: '/Applications/RAV.app',
                state: 'rav-default',
            }),
            isTauriEnvironment: () => true,
        });

        await controller.setup();
        const snapshot = controller.getStatusSnapshot();
        expect(snapshot.contentTypeHandlers).toEqual(dynamicHandlers);
        expect(snapshot.resolvedContentType).toBe('test.vendor.0.riv');
        expect(snapshot).not.toHaveProperty('claimedContentTypeCount');
        expect(snapshot).not.toHaveProperty('totalContentTypeCount');
        snapshot.contentTypeHandlers[0].contentType = 'mutated';
        expect(controller.getStatusSnapshot().contentTypeHandlers[0].contentType)
            .toBe('test.vendor.0.riv');
        controller.dispose();
    });

    it('treats one effective .riv claim as complete without exposing alias counts', async () => {
        const elements = createElements();
        const currentBundlePath = '/Applications/RAV.app';
        const otherBundlePath = '/Applications/Other.app';
        const invoke = vi.fn(async (command) => {
            if (command === 'get_riv_default_app_status') {
                return {
                    available: true,
                    contentTypeHandlers: [
                        { contentType: 'vendor.one.riv', handlerPath: otherBundlePath },
                        { contentType: 'vendor.two.riv', handlerPath: otherBundlePath },
                    ],
                    currentBundlePath,
                    handlerName: 'Other',
                    state: 'other-app',
                };
            }
            return {
                available: true,
                contentTypeHandlers: [
                    { contentType: 'vendor.one.riv', handlerPath: currentBundlePath },
                    { contentType: 'vendor.two.riv', handlerPath: otherBundlePath },
                ],
                currentBundlePath,
                handlerName: 'RAV',
                resolvedContentType: 'vendor.one.riv',
                resolvedHandlerPath: currentBundlePath,
                state: 'rav-default',
            };
        });
        const controller = createDefaultRivAppController({
            elements,
            getTauriInvoker: () => invoke,
            isTauriEnvironment: () => true,
        });

        await controller.setup();
        await expect(controller.apply()).resolves.toBe(true);
        expect(elements.defaultRivAppStatus.textContent).toBe('RAV DEFAULT');
        expect(elements.defaultRivAppActionButton.textContent).toBe('REPAIR ICON');
        expect(elements.defaultRivAppActionButton.title).not.toMatch(/next|remaining|\d+\//i);
        controller.dispose();
    });
});
