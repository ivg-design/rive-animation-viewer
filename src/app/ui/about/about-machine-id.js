const COPY_FEEDBACK_MS = 1500;

export function createMachineIdRow({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
    const dt = documentRef.createElement('dt');
    dt.textContent = 'Machine ID';

    const dd = documentRef.createElement('dd');
    dd.className = 'about-dialog-machine-id-cell';

    const valueSpan = documentRef.createElement('span');
    valueSpan.className = 'about-dialog-machine-id-value';
    valueSpan.dataset.aboutMachineIdDetail = 'true';
    valueSpan.textContent = '…';

    const copyButton = documentRef.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'about-dialog-machine-id-copy';
    copyButton.textContent = 'COPY';
    copyButton.disabled = true;

    let resetTimer = null;

    copyButton.addEventListener('click', async () => {
        const writeText = windowRef?.navigator?.clipboard?.writeText;
        if (typeof writeText !== 'function' || copyButton.disabled) {
            return;
        }
        globalThis.clearTimeout?.(resetTimer);
        try {
            await writeText.call(windowRef.navigator.clipboard, valueSpan.textContent || '');
            copyButton.textContent = 'COPIED';
            copyButton.classList.add('copied');
        } catch {
            copyButton.textContent = 'COPY FAILED';
            copyButton.classList.remove('copied');
        }
        resetTimer = globalThis.setTimeout?.(() => {
            copyButton.textContent = 'COPY';
            copyButton.classList.remove('copied');
        }, COPY_FEEDBACK_MS);
    });

    dd.append(valueSpan, copyButton);

    return { dt, dd, valueSpan, copyButton };
}

export async function refreshMachineId({
    valueSpan,
    copyButton,
    getTauriInvoker = () => null,
} = {}) {
    if (!valueSpan || !copyButton) {
        return;
    }

    valueSpan.textContent = '…';
    copyButton.disabled = true;

    const invoke = typeof getTauriInvoker === 'function' ? getTauriInvoker() : null;
    if (typeof invoke !== 'function') {
        valueSpan.textContent = 'Desktop only';
        return;
    }

    try {
        const status = await invoke('entitlement_status');
        const machineId = String(status?.machine_id || '').trim();
        if (!machineId) {
            throw new Error('Machine ID unavailable');
        }
        valueSpan.textContent = machineId;
        copyButton.disabled = false;
    } catch (error) {
        valueSpan.textContent = error?.message || 'Machine ID unavailable';
        copyButton.disabled = true;
    }
}

export async function fetchMachineId({ getTauriInvoker } = {}) {
    const invoke = typeof getTauriInvoker === 'function' ? getTauriInvoker() : null;
    if (typeof invoke !== 'function') return { machineId: null, error: 'Desktop only' };
    try {
        const status = await invoke('entitlement_status');
        const machineId = String(status?.machine_id || '').trim();
        return machineId ? { machineId, error: null } : { machineId: null, error: 'Unavailable' };
    } catch (error) {
        return { machineId: null, error: String(error?.message || error || 'Unavailable') };
    }
}
