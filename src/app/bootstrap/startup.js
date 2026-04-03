import { createAppLifecycle } from './lifecycle.js';

export function startApp({
    elements,
    callbacks,
    globalBindingsController,
    setRefreshCurrentState,
} = {}) {
    const { initApp, refreshCurrentState } = createAppLifecycle({
        elements,
        callbacks,
    });

    setRefreshCurrentState?.(refreshCurrentState);
    globalBindingsController.bind();

    initApp().catch((error) => {
        console.error('[rive-viewer] initialization failed:', error);
        callbacks.showError?.(`Failed to initialize app: ${error?.message || error}`);
    });
}
