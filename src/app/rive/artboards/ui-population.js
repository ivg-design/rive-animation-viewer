import { AUTO_BOUND_VM_INSTANCE_KEY } from '../view-model/instances.js';
import { getInspectionMetadata } from '../runtime-compatibility.js';

function reconcileSelectOptions(select, options, selectedValue, documentRef = globalThis.document) {
    if (!select) return;
    const next = options.map(({ value, label }) => ({ value: String(value), label: String(label) }));
    const current = Array.from(select.options).map((option) => ({ value: option.value, label: option.textContent }));
    const unchanged = current.length === next.length
        && current.every((option, index) => option.value === next[index].value && option.label === next[index].label);
    if (!unchanged) {
        const fragment = documentRef.createDocumentFragment();
        next.forEach(({ value, label }) => {
            const option = documentRef.createElement('option');
            option.value = value;
            option.textContent = label;
            fragment.appendChild(option);
        });
        select.replaceChildren(fragment);
    }
    if (selectedValue !== null && typeof selectedValue !== 'undefined'
        && next.some((option) => option.value === String(selectedValue))) {
        select.value = String(selectedValue);
    }
}

export function populateArtboardSwitcherUi({
    currentArtboardName,
    defaultArtboardName,
    elements,
    fileContentsCache,
    getRiveInstance = () => null,
    initLucideIcons = () => {},
} = {}) {
    const switcher = elements.artboardSwitcher;
    const artboardSelect = elements.artboardSelect;
    const riveInstance = getRiveInstance();
    if (!switcher || !artboardSelect || !riveInstance) {
        if (switcher) switcher.hidden = true;
        return { defaultArtboardName, fileContentsCache };
    }

    const contents = getInspectionMetadata(riveInstance);
    if (!contents?.artboards?.length) {
        switcher.hidden = true;
        return { defaultArtboardName, fileContentsCache: null };
    }

    fileContentsCache = contents;
    const artboards = contents.artboards;
    const artboardOptions = artboards.map((artboard) => {
        const name = typeof artboard === 'string' ? artboard : artboard.name;
        return { value: name, label: name };
    });
    reconcileSelectOptions(artboardSelect, artboardOptions, currentArtboardName);

    if (defaultArtboardName === null) {
        defaultArtboardName = currentArtboardName || (artboards[0]?.name ?? artboards[0]);
    }

    if (elements.artboardSwitcherCount) {
        elements.artboardSwitcherCount.textContent = String(artboards.length);
    }
    switcher.hidden = false;
    initLucideIcons();
    return { defaultArtboardName, fileContentsCache };
}

export function populatePlaybackSelectUi({
    currentArtboardName,
    currentPlaybackName,
    currentPlaybackType,
    defaultPlaybackKey,
    elements,
    fileContentsCache,
    documentRef = globalThis.document,
} = {}) {
    const select = elements.playbackSelect;
    if (!select || !fileContentsCache) {
        return { defaultPlaybackKey };
    }

    const selectedArtboardName = elements.artboardSelect?.value || currentArtboardName;
    const artboards = fileContentsCache?.artboards || [];
    const artboard = artboards.find((entry) => {
        const name = typeof entry === 'string' ? entry : entry.name;
        return name === selectedArtboardName;
    });
    if (!artboard || typeof artboard === 'string') {
        return { defaultPlaybackKey };
    }

    const options = [];
    (artboard.stateMachines || []).forEach((stateMachine) => {
        const name = typeof stateMachine === 'string' ? stateMachine : stateMachine.name;
        options.push({ value: `sm:${name}`, label: name });
    });

    (artboard.animations || []).forEach((animation) => {
        const name = typeof animation === 'string' ? animation : animation.name;
        options.push({ value: `anim:${name}`, label: name });
    });
    const currentKey = currentPlaybackName
        ? (currentPlaybackType === 'animation'
            ? `anim:${currentPlaybackName}`
            : `sm:${currentPlaybackName}`)
        : select.value;
    reconcileSelectOptions(select, options, currentKey, documentRef);

    if (defaultPlaybackKey === null && select.options.length > 0) {
        defaultPlaybackKey = select.value;
    }
    return { defaultPlaybackKey };
}

export function populateVmInstanceSelectUi({
    elements,
    getRiveInstance = () => null,
    documentRef = globalThis.document,
    selectedInstanceKey = null,
} = {}) {
    const row = elements.vmInstanceRow;
    const select = elements.vmInstanceSelect;
    const riveInstance = getRiveInstance();
    if (!row || !select || !riveInstance) {
        if (row) row.hidden = true;
        return;
    }

    try {
        const viewModelDefinition = typeof riveInstance.defaultViewModel === 'function'
            ? riveInstance.defaultViewModel()
            : null;
        if (!viewModelDefinition) {
            row.hidden = true;
            return;
        }

        const instanceCount = typeof viewModelDefinition.instanceCount === 'number'
            ? viewModelDefinition.instanceCount
            : 0;
        if (instanceCount < 1) {
            row.hidden = true;
            return;
        }

        const instanceNames = Array.isArray(viewModelDefinition.instanceNames)
            ? viewModelDefinition.instanceNames
            : [];
        const instances = Array.from({ length: instanceCount }, (_unused, index) => {
            const authoredName = typeof instanceNames[index] === 'string'
                ? instanceNames[index].trim()
                : '';
            return {
                label: authoredName || `Instance ${index + 1}`,
                key: authoredName || String(index),
            };
        });

        const options = [{
            value: AUTO_BOUND_VM_INSTANCE_KEY,
            label: instanceCount === 1 ? `${instances[0].label} (auto)` : 'Default instance (auto)',
        }, ...instances.map(({ key, label }) => ({ value: key, label }))];

        const normalizedSelection = selectedInstanceKey === null || typeof selectedInstanceKey === 'undefined'
            ? AUTO_BOUND_VM_INSTANCE_KEY
            : String(selectedInstanceKey);
        reconcileSelectOptions(select, options,
            options.some((option) => String(option.value) === normalizedSelection)
                ? normalizedSelection
                : AUTO_BOUND_VM_INSTANCE_KEY,
        documentRef);

        row.hidden = false;
    } catch (error) {
        console.warn('[rive-viewer] VM instance enumeration failed:', error);
        row.hidden = true;
    }
}
