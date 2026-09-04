export function createOverlayParentLock(documentRef = globalThis.document) {
    let state = null;

    function lock() {
        if (state) return;
        const appShell = documentRef?.querySelector?.('.app-shell');
        if (!appShell) return;
        state = {
            appShell,
            hadBlockedClass: appShell.classList.contains('is-native-overlay-blocked'),
            hadInertAttribute: appShell.hasAttribute('inert'),
        };
        appShell.setAttribute('inert', '');
        appShell.classList.add('is-native-overlay-blocked');
    }

    function unlock() {
        if (!state) return;
        const { appShell, hadBlockedClass, hadInertAttribute } = state;
        state = null;
        if (!hadInertAttribute) appShell.removeAttribute('inert');
        if (!hadBlockedClass) appShell.classList.remove('is-native-overlay-blocked');
    }

    function consumePointer(event, trigger) {
        event?.preventDefault?.();
        event?.stopImmediatePropagation?.();
        event?.stopPropagation?.();
        const path = event?.composedPath?.() || [];
        return Boolean(trigger && (path.includes(trigger) || trigger.contains?.(event?.target)));
    }

    return { consumePointer, isLocked: () => Boolean(state), lock, unlock };
}
