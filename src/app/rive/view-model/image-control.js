export function appendVmImageControl({
    descriptor,
    documentRef,
    getLoadedRuntime,
    inputContainer,
    logEvent,
    registerVmControlBinding,
    resolveControlAccessor,
}) {
    const imageInput = documentRef.createElement('input');
    imageInput.type = 'file';
    imageInput.accept = 'image/*';
    const clearButton = documentRef.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';

    const canDecode = () => typeof getLoadedRuntime()?.decodeImage === 'function';
    const isDisabled = () => !resolveControlAccessor({ ...descriptor, kind: 'image' });
    imageInput.disabled = isDisabled() || !canDecode();
    clearButton.disabled = isDisabled();

    imageInput.addEventListener('change', async () => {
        const file = imageInput.files?.[0];
        const runtime = getLoadedRuntime();
        const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'image' });
        if (!file || !runtime || typeof runtime.decodeImage !== 'function' || !liveAccessor) return;
        try {
            const image = await runtime.decodeImage(new Uint8Array(await file.arrayBuffer()));
            if (!image) throw new Error('The runtime could not decode this image.');
            liveAccessor.value = image;
            image.unref?.();
            logEvent('ui', 'vm-image', `Set ${descriptor.path} image from ${file.name}.`);
        } catch (error) {
            logEvent('ui', 'vm-image-error', `Unable to set ${descriptor.path} image: ${error.message}`);
        }
    });
    clearButton.addEventListener('click', () => {
        const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'image' });
        if (!liveAccessor) return;
        liveAccessor.value = null;
        imageInput.value = '';
        logEvent('ui', 'vm-image', `Cleared ${descriptor.path} image.`);
    });

    registerVmControlBinding(descriptor, {
        clearButton,
        input: imageInput,
        kind: 'image',
    });
    inputContainer.appendChild(imageInput);
    inputContainer.appendChild(clearButton);
}
