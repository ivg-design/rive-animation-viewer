import { dispatchVmControlMutation } from '../control-events.js';

export function appendVmImageControl({
    canMutateRemoteControls = () => true,
    descriptor,
    documentRef,
    getEmbeddedImageAssets = () => [],
    getLoadedRuntime,
    inputContainer,
    isControlCurrent = () => true,
    isAuthoritativeChildMode = false,
    logEvent,
    onRemoteMutationFailure = () => {},
    pickImageFile = null,
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
    imageInput.tabIndex = -1;

    const canDecode = () => isAuthoritativeChildMode
        || typeof getLoadedRuntime()?.decodeImage === 'function';
    const isDisabled = () => !resolveControlAccessor({ ...descriptor, kind: 'image' });
    let imageRequestSequence = 0;
    let imagePickerPending = false;
    let disposed = false;
    let imageInteractionActive = false;
    let onImageInteractionEnd = () => {};
    let pendingImageSelection;
    let hasPendingImageSelection = false;
    let displayedImageSelection = descriptor.metadata || null;
    const isCurrent = () => !disposed && isControlCurrent();
    const isCurrentRequest = (requestId) => isCurrent() && requestId === imageRequestSequence;
    imageInput.disabled = isDisabled() || !canDecode();
    assetSelect.disabled = isDisabled();
    openOption.disabled = !canDecode();
    embeddedAssets.forEach((_asset, index) => {
        assetSelect.options[index + 1].disabled = !canDecode();
    });

    const applyImageSelection = (selection) => {
        const normalized = selection && typeof selection === 'object' ? selection : null;
        const fileOption = assetSelect.querySelector('option[data-image-file-option]');
        if (normalized?.kind === 'embedded') {
            const index = embeddedAssets.findIndex((asset) => asset?.key === normalized.key);
            if (index >= 0) {
                fileOption?.remove();
                imageInput.value = '';
                assetSelect.value = `embedded:${index}`;
                displayedImageSelection = normalized;
                return;
            }
        }
        if (normalized?.kind === 'file' && typeof normalized.label === 'string' && normalized.label) {
            let nextFileOption = fileOption;
            if (!nextFileOption) {
                nextFileOption = documentRef.createElement('option');
                nextFileOption.value = '__file__';
                nextFileOption.setAttribute('data-image-file-option', 'true');
                assetSelect.insertBefore(nextFileOption, openOption);
            }
            nextFileOption.textContent = normalized.label;
            assetSelect.value = '__file__';
            displayedImageSelection = normalized;
            return;
        }
        fileOption?.remove();
        imageInput.value = '';
        assetSelect.value = '';
        displayedImageSelection = null;
    };
    const syncImageSelection = (selection) => {
        if (!isCurrent()) return;
        if (imageInteractionActive) {
            pendingImageSelection = selection;
            hasPendingImageSelection = true;
            return;
        }
        applyImageSelection(selection);
    };
    const beginImageInteraction = () => {
        imageInteractionActive = true;
    };
    const endImageInteraction = ({ applyPending = true } = {}) => {
        if (!imageInteractionActive && !hasPendingImageSelection) return;
        imageInteractionActive = false;
        if (applyPending && hasPendingImageSelection) applyImageSelection(pendingImageSelection);
        pendingImageSelection = undefined;
        hasPendingImageSelection = false;
        onImageInteractionEnd();
    };

    assetSelect.addEventListener('pointerdown', beginImageInteraction);
    assetSelect.addEventListener('mousedown', beginImageInteraction);
    assetSelect.addEventListener('touchstart', beginImageInteraction, { passive: true });
    // Focus alone does not open a native select popup. Treating it as an
    // interaction traps canonical image ACKs when focus returns from the
    // desktop file sheet. Pointer/touch and keyboard-open events below cover
    // every real popup interaction without leaving the selector stale.
    assetSelect.addEventListener('keydown', (event) => {
        if ([' ', 'ArrowDown', 'ArrowUp', 'Enter', 'F4'].includes(event.key)) beginImageInteraction();
        if (event.key === 'Escape') endImageInteraction();
    });
    assetSelect.addEventListener('blur', () => endImageInteraction());

    const applyImageBytes = async (bytes, sourceLabel, requestId, imageSelection = null) => {
        if (isAuthoritativeChildMode) {
            if (!isCurrentRequest(requestId)) return false;
            if (!canMutateRemoteControls()) {
                onRemoteMutationFailure(`Playback controls are unavailable while ${descriptor.path} recovers.`);
                return false;
            }
            const sent = dispatchVmControlMutation(documentRef, {
                action: 'set-image',
                descriptor,
                kind: 'image',
                imageSelection,
                value: Array.from(new Uint8Array(bytes)),
            });
            if (!sent) {
                onRemoteMutationFailure(`Unable to send ${descriptor.path} image to the playback surface.`);
                return false;
            }
            logEvent('ui', 'vm-image', `Requested ${descriptor.path} image from ${sourceLabel}.`);
            return true;
        }
        const runtime = getLoadedRuntime();
        const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'image' });
        if (!isCurrentRequest(requestId) || !runtime || typeof runtime.decodeImage !== 'function' || !liveAccessor) return false;
        let image = null;
        try {
            image = await runtime.decodeImage(new Uint8Array(bytes));
            if (!image) throw new Error('The runtime could not decode this image.');
            if (!isCurrentRequest(requestId)) return false;
            liveAccessor.value = image;
            logEvent('ui', 'vm-image', `Set ${descriptor.path} image from ${sourceLabel}.`);
            return true;
        } catch (error) {
            if (isCurrentRequest(requestId)) {
                logEvent('ui', 'vm-image-error', `Unable to set ${descriptor.path} image: ${error.message}`);
            }
            return false;
        } finally {
            image?.unref?.();
        }
    };

    const toImageBytes = (value) => {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (Array.isArray(value)) return new Uint8Array(value);
        throw new Error('The image picker returned invalid image bytes.');
    };

    const applyPickedImage = async ({ bytes, name }, requestId) => {
        if (!isCurrentRequest(requestId)) return false;
        const sourceLabel = typeof name === 'string' && name ? name : 'selected image';
        const imageBytes = toImageBytes(bytes);
        if (!await applyImageBytes(imageBytes, sourceLabel, requestId, {
            kind: 'file',
            label: sourceLabel,
        })) return false;
        if (!isCurrentRequest(requestId)) return false;
        // The dedicated playback child owns image decoding and assignment.
        // Keep the last acknowledged selector state until its canonical delta
        // confirms both operations. Local/browser playback can commit here
        // because this function performed the decode and assignment itself.
        if (!isAuthoritativeChildMode) {
            applyImageSelection({ kind: 'file', label: sourceLabel });
        }
        return true;
    };

    const openBrowserPicker = () => {
        // WKWebView can reject a programmatic click even when it originated in
        // a select change. `showPicker` is the standards path when available;
        // the native Tauri dialog above is used in desktop builds first.
        try {
            if (typeof imageInput.showPicker === 'function') {
                imageInput.showPicker();
                return;
            }
        } catch {
            // Fall through for browsers that expose but reject showPicker.
        }
        imageInput.click();
    };

    assetSelect.addEventListener('change', async () => {
        const selectedValue = assetSelect.value;
        // The explicit choice supersedes any canonical tick deferred while
        // the popup was open. Capture it before releasing the interaction.
        endImageInteraction({ applyPending: false });
        if (selectedValue === '__open__') {
            if (imagePickerPending) {
                applyImageSelection(displayedImageSelection);
                return;
            }
            const requestId = ++imageRequestSequence;
            const previousImageSelection = displayedImageSelection;
            // Selecting the action option temporarily changes the native
            // select's value. Restore its last canonical display while the
            // picker is open so cancel/error is a real no-op.
            applyImageSelection(previousImageSelection);
            if (typeof pickImageFile !== 'function') {
                openBrowserPicker();
                return;
            }
            imagePickerPending = true;
            openOption.disabled = true;
            assetSelect.setAttribute('aria-busy', 'true');
            try {
                const picked = await pickImageFile();
                if (!isCurrentRequest(requestId)) return;
                if (!picked || !await applyPickedImage(picked, requestId)) {
                    if (isCurrentRequest(requestId)) applyImageSelection(previousImageSelection);
                }
            } catch (error) {
                if (isCurrentRequest(requestId)) {
                    const message = `Unable to open image file: ${error.message || error}`;
                    logEvent('ui', 'vm-image-error', message);
                    onRemoteMutationFailure(message);
                    applyImageSelection(previousImageSelection);
                }
            } finally {
                imagePickerPending = false;
                if (isCurrent()) {
                    openOption.disabled = !canDecode();
                    assetSelect.removeAttribute('aria-busy');
                }
            }
            return;
        }
        if (selectedValue === '__clear__') {
            imageRequestSequence += 1;
            if (isAuthoritativeChildMode) {
                applyImageSelection(displayedImageSelection);
                if (!canMutateRemoteControls()) {
                    onRemoteMutationFailure(`Playback controls are unavailable while ${descriptor.path} recovers.`);
                    return;
                }
                const sent = dispatchVmControlMutation(documentRef, {
                    action: 'clear-image',
                    descriptor,
                    kind: 'image',
                    imageSelection: null,
                    value: null,
                });
                if (!sent) {
                    applyImageSelection(displayedImageSelection);
                    onRemoteMutationFailure(`Unable to clear ${descriptor.path} in the playback surface.`);
                    return;
                }
                logEvent('ui', 'vm-image', `Requested clearing ${descriptor.path} image.`);
                return;
            }
            const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'image' });
            if (!liveAccessor) {
                applyImageSelection(displayedImageSelection);
                return;
            }
            liveAccessor.value = null;
            imageInput.value = '';
            assetSelect.querySelector('option[data-image-file-option]')?.remove();
            assetSelect.value = '';
            displayedImageSelection = null;
            logEvent('ui', 'vm-image', `Cleared ${descriptor.path} image.`);
            return;
        }
        const selectedIndex = Number.parseInt(selectedValue.replace(/^embedded:/, ''), 10);
        const selected = Number.isInteger(selectedIndex) ? embeddedAssets[selectedIndex] : null;
        if (selected) {
            const requestId = ++imageRequestSequence;
            const previousImageSelection = displayedImageSelection;
            const imageSelection = {
                key: selected.key,
                kind: 'embedded',
                label: selected.label || selected.name,
            };
            if (isAuthoritativeChildMode) applyImageSelection(previousImageSelection);
            void applyImageBytes(selected.bytes, `embedded asset ${selected.name}`, requestId, imageSelection)
                .then((applied) => {
                    if (applied && isCurrentRequest(requestId) && !isAuthoritativeChildMode) {
                        applyImageSelection(imageSelection);
                    }
                    else if (isCurrentRequest(requestId)) applyImageSelection(previousImageSelection);
                });
        }
    });

    imageInput.addEventListener('change', async () => {
        const file = imageInput.files?.[0];
        if (!file) return;
        const requestId = ++imageRequestSequence;
        let bytes;
        try {
            bytes = await file.arrayBuffer();
        } catch (error) {
            if (isCurrentRequest(requestId)) {
                logEvent('ui', 'vm-image-error', `Unable to read ${file.name}: ${error.message}`);
            }
            return;
        }
        await applyPickedImage({ bytes, name: file.name }, requestId);
    });

    registerVmControlBinding(descriptor, {
        assetSelect,
        dispose: () => {
            disposed = true;
            imageRequestSequence += 1;
            imagePickerPending = false;
            pendingImageSelection = undefined;
            hasPendingImageSelection = false;
        },
        input: imageInput,
        isInteractionActive: () => imageInteractionActive,
        kind: 'image',
        setInteractionEndHandler: (handler) => {
            onImageInteractionEnd = typeof handler === 'function' ? handler : () => {};
        },
        syncImageSelection,
        usesAuthoritativeImageTransport: isAuthoritativeChildMode,
    });
    syncImageSelection(descriptor.metadata);
    control.appendChild(assetSelect);
    control.appendChild(imageInput);
    inputContainer.appendChild(control);
}
