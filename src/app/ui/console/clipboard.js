export async function writeTextToClipboard(text, {
    documentRef = globalThis.document,
    navigatorRef = globalThis.navigator,
} = {}) {
    try {
        if (typeof navigatorRef?.clipboard?.writeText === 'function') {
            await navigatorRef.clipboard.writeText(text);
            return true;
        }
    } catch {
        /* fall through */
    }

    const textarea = documentRef?.createElement?.('textarea');
    if (!textarea) {
        return false;
    }

    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.style.inset = '0';
    documentRef.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
        copied = documentRef.execCommand?.('copy') === true;
    } catch {
        copied = false;
    } finally {
        textarea.remove();
    }

    return copied;
}
