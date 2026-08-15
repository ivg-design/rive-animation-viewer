export function appendVmImageControl({
    descriptor,
    documentRef,
    getEmbeddedImageAssets = () => [],
    getLoadedRuntime,
    inputContainer,
    logEvent,
    registerVmControlBinding,
    resolveControlAccessor,
}) {
    const embeddedAssets = getEmbeddedImageAssets();
    const control = documentRef.createElement('div');
    control.className = 'vm-image-control';

    const assetSelect = documentRef.createElement('select');
    assetSelect.className = 'vm-image-asset-select';
    assetSelect.setAttribute('aria-label', `Image source for ${descriptor.name}`);
    const placeholder = documentRef.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select image…';
    placeholder.disabled = true;
    placeholder.selected = true;
    assetSelect.appendChild(placeholder);
    embeddedAssets.forEach((asset, index) => {
        const option = documentRef.createElement('option');
        option.value = `embedded:${index}`;
        option.textContent = asset.label || asset.name;
        assetSelect.appendChild(option);
    });
    const openOption = documentRef.createElement('option');
    openOption.value = '__open__';
    openOption.textContent = 'Open file…';
    assetSelect.appendChild(openOption);
    const clearOption = documentRef.createElement('option');
    clearOption.value = '__clear__';
    clearOption.textContent = 'Clear';
    assetSelect.appendChild(clearOption);

    const imageInput = documentRef.createElement('input');
    imageInput.type = 'file';
    imageInput.accept = 'image/*';
    imageInput.className = 'vm-image-file-input';
    imageInput.hidden = true;
    imageInput.tabIndex = -1;

    const canDecode = () => typeof getLoadedRuntime()?.decodeImage === 'function';
    const isDisabled = () => !resolveControlAccessor({ ...descriptor, kind: 'image' });
    let imageRequestSequence = 0;
    imageInput.disabled = isDisabled() || !canDecode();
    assetSelect.disabled = isDisabled();
    openOption.disabled = !canDecode();
    embeddedAssets.forEach((_asset, index) => {
        assetSelect.options[index + 1].disabled = !canDecode();
    });

    const applyImageBytes = async (bytes, sourceLabel, requestId) => {
        const runtime = getLoadedRuntime();
        const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'image' });
        if (!runtime || typeof runtime.decodeImage !== 'function' || !liveAccessor) return false;
        let image = null;
        try {
            image = await runtime.decodeImage(new Uint8Array(bytes));
            if (!image) throw new Error('The runtime could not decode this image.');
            if (requestId !== imageRequestSequence) return false;
            liveAccessor.value = image;
            logEvent('ui', 'vm-image', `Set ${descriptor.path} image from ${sourceLabel}.`);
            return true;
        } catch (error) {
            logEvent('ui', 'vm-image-error', `Unable to set ${descriptor.path} image: ${error.message}`);
            return false;
        } finally {
            image?.unref?.();
        }
    };

    assetSelect.addEventListener('change', () => {
        if (assetSelect.value === '__open__') {
            imageRequestSequence += 1;
            assetSelect.value = '';
            imageInput.click();
            return;
        }
        if (assetSelect.value === '__clear__') {
            imageRequestSequence += 1;
            const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'image' });
            if (!liveAccessor) return;
            liveAccessor.value = null;
            imageInput.value = '';
            assetSelect.querySelector('option[data-image-file-option]')?.remove();
            assetSelect.value = '';
            logEvent('ui', 'vm-image', `Cleared ${descriptor.path} image.`);
            return;
        }
        const selectedIndex = Number.parseInt(assetSelect.value.replace(/^embedded:/, ''), 10);
        const selected = Number.isInteger(selectedIndex) ? embeddedAssets[selectedIndex] : null;
        if (selected) {
            const requestId = ++imageRequestSequence;
            applyImageBytes(selected.bytes, `embedded asset ${selected.name}`, requestId);
        }
    });

    imageInput.addEventListener('change', async () => {
        const file = imageInput.files?.[0];
        if (!file) return;
        const requestId = ++imageRequestSequence;
        let fileBytes;
        try {
            fileBytes = await file.arrayBuffer();
        } catch (error) {
            logEvent('ui', 'vm-image-error', `Unable to read ${file.name}: ${error.message}`);
            return;
        }
        if (!await applyImageBytes(fileBytes, file.name, requestId)) return;
        let fileOption = assetSelect.querySelector('option[data-image-file-option]');
        if (!fileOption) {
            fileOption = documentRef.createElement('option');
            fileOption.value = '__file__';
            fileOption.setAttribute('data-image-file-option', 'true');
            assetSelect.insertBefore(fileOption, openOption);
        }
        fileOption.textContent = file.name;
        assetSelect.value = '__file__';
    });

    registerVmControlBinding(descriptor, {
        assetSelect,
        input: imageInput,
        kind: 'image',
    });
    control.appendChild(assetSelect);
    control.appendChild(imageInput);
    inputContainer.appendChild(control);
}
