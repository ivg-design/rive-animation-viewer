import { argbToColorMeta } from '../color-utils.js';

export function updateStringInputRows(input, value) {
    if (!input || typeof input.rows !== 'number') {
        return;
    }
    const text = typeof value === 'string' ? value : '';
    input.rows = /\r\n|\r|\n/.test(text) ? 2 : 1;
}

export function syncVmBindings(bindings, resolveControlAccessor, documentRef, force = false, getLoadedRuntime = () => null) {
    const isEditingControl = (element) => documentRef.activeElement === element;

    bindings.forEach((binding) => {
        const accessor = binding.accessor || resolveControlAccessor(binding.descriptor);
        const canEdit = Boolean(accessor);

        if (binding.input) {
            binding.input.disabled = !canEdit
                || (binding.kind === 'image' && typeof getLoadedRuntime()?.decodeImage !== 'function');
        }
        if (binding.colorInput) binding.colorInput.disabled = !canEdit;
        if (binding.alphaInput) binding.alphaInput.disabled = !canEdit;
        if (binding.clearButton) binding.clearButton.disabled = !canEdit;
        if (binding.browseButton) {
            binding.browseButton.disabled = !canEdit || typeof getLoadedRuntime()?.decodeImage !== 'function';
        }
        if (binding.assetSelect) {
            const canDecodeImage = typeof getLoadedRuntime()?.decodeImage === 'function';
            binding.assetSelect.disabled = !canEdit;
            Array.from(binding.assetSelect.options).forEach((option) => {
                if (option.value === '__open__' || option.value.startsWith('embedded:')) {
                    option.disabled = !canDecodeImage;
                }
            });
        }
        if (!canEdit) return;

        if (binding.kind === 'number') {
            const value = Number(accessor.value);
            if (!Number.isFinite(value) || (!force && isEditingControl(binding.input))) return;
            const nextValue = String(value);
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
            if (binding.input.value !== nextValue) binding.input.value = nextValue;
            return;
        }

        if (binding.kind === 'color') {
            const meta = argbToColorMeta(accessor.value);
            if (!force && (isEditingControl(binding.colorInput) || isEditingControl(binding.alphaInput))) return;
            if (binding.colorInput.value !== meta.hex) binding.colorInput.value = meta.hex;
            const nextAlpha = String(meta.alphaPercent);
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
