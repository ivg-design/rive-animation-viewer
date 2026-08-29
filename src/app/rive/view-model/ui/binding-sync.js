import { argbToColorMeta } from '../color-utils.js';

export function updateStringInputRows(input, value) {
    if (!input || typeof input.rows !== 'number') {
        return;
    }
    const text = typeof value === 'string' ? value : '';
    input.rows = /\r\n|\r|\n/.test(text) ? 2 : 1;
}

// Runtime values retain their full precision; this is only the presentation
// format used by the visible number controls. Keeping the conversion here
// means initial render, polling, and reactive updates all use the same shape.
export function formatVmNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toFixed(2) : '0.00';
}

export function syncVmBindings(
    bindings,
    resolveControlAccessor,
    documentRef,
    force = false,
    getLoadedRuntime = () => null,
    canMutateBinding = () => true,
) {
    const isEditingControl = (element) => documentRef.activeElement === element;

    bindings.forEach((binding) => {
        const accessor = binding.accessor || resolveControlAccessor(binding.descriptor);
        const canEdit = Boolean(accessor) && canMutateBinding(binding.descriptor);
        const canDecodeImage = binding.usesAuthoritativeImageTransport === true
            || typeof getLoadedRuntime()?.decodeImage === 'function';

        const setDisabled = (element, disabled) => {
            if (element && element.disabled !== disabled) element.disabled = disabled;
        };
        setDisabled(binding.input, !canEdit || (binding.kind === 'image' && !canDecodeImage));
        setDisabled(binding.colorInput, !canEdit);
        setDisabled(binding.alphaInput, !canEdit);
        setDisabled(binding.clearButton, !canEdit);
        setDisabled(binding.button, !canEdit);
        if (binding.browseButton) {
            setDisabled(binding.browseButton, !canEdit || !canDecodeImage);
        }
        if (binding.assetSelect) {
            setDisabled(binding.assetSelect, !canEdit);
            Array.from(binding.assetSelect.options).forEach((option) => {
                if (option.value === '__open__' || option.value.startsWith('embedded:')) {
                    setDisabled(option, !canDecodeImage);
                }
            });
        }
        if (!canEdit) return;

        if (binding.kind === 'image') {
            binding.syncImageSelection?.(accessor.metadata);
            return;
        }

        if (binding.kind === 'number') {
            const value = Number(accessor.value);
            if (!Number.isFinite(value) || (!force && isEditingControl(binding.input))) return;
            const nextValue = formatVmNumber(value);
            if (binding.input.value !== nextValue) binding.input.value = nextValue;
            return;
        }

        if (binding.kind === 'boolean') {
            const nextValue = Boolean(accessor.value);
            if (binding.input.checked !== nextValue) binding.input.checked = nextValue;
            return;
        }

        if (binding.kind === 'string') {
            const nextValue = typeof accessor.value === 'string' ? accessor.value : '';
            if (!force && isEditingControl(binding.input)) {
                updateStringInputRows(binding.input, binding.input.value);
                return;
            }
            if (binding.input.value !== nextValue) binding.input.value = nextValue;
            updateStringInputRows(binding.input, nextValue);
            return;
        }

        if (binding.kind === 'enum') {
            const nextValue = typeof accessor.value === 'string' ? accessor.value : '';
            // A native select's popup is owned by the browser. Updating its
            // value while it has focus closes that popup, so defer routine
            // canonical deltas until the user finishes choosing an option.
            if (!force && isEditingControl(binding.input)) return;
            if (binding.input.value !== nextValue) binding.input.value = nextValue;
            return;
        }

        if (binding.kind === 'color') {
            const meta = argbToColorMeta(accessor.value);
            if (!force && (isEditingControl(binding.colorInput) || isEditingControl(binding.alphaInput))) return;
            if (binding.colorInput.value !== meta.hex) binding.colorInput.value = meta.hex;
            const nextAlpha = formatVmNumber(meta.alphaPercent);
            if (binding.alphaInput.value !== nextAlpha) binding.alphaInput.value = nextAlpha;
        }
    });
}

export function resetVmInputControls(elements, message = 'No bound ViewModel inputs detected.') {
    const count = elements.vmControlsCount;
    const empty = elements.vmControlsEmpty;
    const tree = elements.vmControlsTree;
    if (!count || !empty || !tree) return;
    tree.innerHTML = '';
    count.textContent = '0';
    empty.hidden = false;
    empty.textContent = message;
}
