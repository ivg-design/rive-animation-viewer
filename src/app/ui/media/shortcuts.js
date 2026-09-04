export function isRecordingShortcut(event) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey
        || !(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key?.toLowerCase() !== 'r') return false;
    const path = event.composedPath?.() || [event.target];
    return !path.some((node) => node?.isContentEditable || node?.closest?.(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .cm-editor',
    ));
}

export function bindRecordingShortcut(target, toggle) {
    const handler = (event) => {
        if (!isRecordingShortcut(event)) return;
        event.preventDefault();
        void toggle();
    };
    target.addEventListener('keydown', handler);
    return () => target.removeEventListener('keydown', handler);
}
