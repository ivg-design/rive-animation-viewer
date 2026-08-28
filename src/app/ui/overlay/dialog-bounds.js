export function measureDialogOverlay({
    dialog,
    viewportHeight = globalThis.innerHeight,
    viewportWidth = globalThis.innerWidth,
} = {}) {
    if (!dialog) return null;
    const wasOpen = dialog.hasAttribute('open');
    const previousVisibility = dialog.style.visibility;
    const previousPointerEvents = dialog.style.pointerEvents;
    dialog.style.visibility = 'hidden';
    dialog.style.pointerEvents = 'none';
    dialog.setAttribute('open', '');
    const rect = dialog.getBoundingClientRect();
    if (!wasOpen) dialog.removeAttribute('open');
    dialog.style.visibility = previousVisibility;
    dialog.style.pointerEvents = previousPointerEvents;

    const maxWidth = Math.max(1, Number(viewportWidth || 0) - 32);
    const maxHeight = Math.max(1, Number(viewportHeight || 0) - 32);
    const width = Math.min(maxWidth, Math.max(1, Math.ceil(rect.width || 1040)));
    const height = Math.min(maxHeight, Math.max(1, Math.ceil(rect.height || 720)));
    return {
        height,
        width,
        x: Math.max(8, Math.round((Number(viewportWidth || width) - width) / 2)),
        y: Math.max(8, Math.round((Number(viewportHeight || height) - height) / 2)),
    };
}
