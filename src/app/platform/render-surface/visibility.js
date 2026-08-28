function isVisible(element) {
    return Boolean(element && element.hidden === false && element.getAttribute?.('aria-hidden') !== 'true');
}

export function hasBlockingMainUi(documentRef, elements = {}) {
    if (documentRef?.querySelector?.('dialog[open]')) {
        return true;
    }
    return isVisible(elements.installCounterNotice)
        || isVisible(elements.settingsPopover)
        || Boolean(elements.error?.classList?.contains?.('visible'));
}

export function observeBlockingMainUi({
    documentRef,
    elements = {},
    MutationObserverCtor,
    onChange,
} = {}) {
    if (typeof MutationObserverCtor !== 'function' || !documentRef?.body) return null;
    const observer = new MutationObserverCtor(onChange);
    observer.observe(documentRef.body, {
        attributeFilter: ['open'],
        attributes: true,
        subtree: true,
    });
    [elements.installCounterNotice, elements.settingsPopover].filter(Boolean).forEach((element) => {
        observer.observe(element, {
            attributeFilter: ['aria-hidden', 'hidden'],
            attributes: true,
        });
    });
    if (elements.error) {
        observer.observe(elements.error, {
            attributeFilter: ['class', 'hidden'],
            attributes: true,
        });
    }
    return observer;
}

export function createRenderSurfaceVisibilityController({
    canShowMainCanvas = () => true,
    documentRef,
    elements = {},
    invokeQuietly,
    isActive,
} = {}) {
    let syncChain = Promise.resolve(false);

    function setMainCanvasVisible(visible) {
        const canvas = elements.canvasContainer?.querySelector?.('#rive-canvas');
        if (!canvas) return;
        canvas.style.visibility = visible ? '' : 'hidden';
        canvas.style.pointerEvents = visible ? '' : 'none';
    }

    async function applyCurrentVisibility() {
        if (!isActive?.()) {
            setMainCanvasVisible(canShowMainCanvas());
            return false;
        }
        if (hasBlockingMainUi(documentRef, elements)) {
            await invokeQuietly('park_render_surface');
            setMainCanvasVisible(canShowMainCanvas());
            return false;
        }
        const shown = await invokeQuietly('restore_render_surface');
        setMainCanvasVisible(!shown && canShowMainCanvas());
        return shown;
    }

    function sync() {
        syncChain = syncChain.then(applyCurrentVisibility, applyCurrentVisibility);
        return syncChain;
    }

    function canReveal() {
        return canShowMainCanvas() && !hasBlockingMainUi(documentRef, elements);
    }

    return {
        canReveal,
        setMainCanvasVisible,
        sync,
    };
}
