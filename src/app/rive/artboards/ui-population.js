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

    const contents = riveInstance.contents;
    if (!contents?.artboards?.length) {
        switcher.hidden = true;
        return { defaultArtboardName, fileContentsCache: null };
    }

    fileContentsCache = contents;
    artboardSelect.innerHTML = '';
    const artboards = contents.artboards;
    artboards.forEach((artboard) => {
        const name = typeof artboard === 'string' ? artboard : artboard.name;
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = name === currentArtboardName;
        artboardSelect.appendChild(option);
    });

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

    select.innerHTML = '';
    const selectedArtboardName = elements.artboardSelect?.value || currentArtboardName;
    const artboards = fileContentsCache?.artboards || [];
    const artboard = artboards.find((entry) => {
        const name = typeof entry === 'string' ? entry : entry.name;
        return name === selectedArtboardName;
    });
    if (!artboard || typeof artboard === 'string') {
        return { defaultPlaybackKey };
    }

    (artboard.stateMachines || []).forEach((stateMachine) => {
        const name = typeof stateMachine === 'string' ? stateMachine : stateMachine.name;
        const option = documentRef.createElement('option');
        option.value = `sm:${name}`;
        option.textContent = name;
        select.appendChild(option);
    });

    (artboard.animations || []).forEach((animation) => {
        const name = typeof animation === 'string' ? animation : animation.name;
        const option = documentRef.createElement('option');
        option.value = `anim:${name}`;
        option.textContent = name;
        select.appendChild(option);
    });

    if (currentPlaybackName) {
        const currentKey = currentPlaybackType === 'animation'
            ? `anim:${currentPlaybackName}`
            : `sm:${currentPlaybackName}`;
        const match = Array.from(select.options).find((option) => option.value === currentKey);
        if (match) {
            select.value = currentKey;
        }
    }

    if (defaultPlaybackKey === null && select.options.length > 0) {
        defaultPlaybackKey = select.value;
    }
    return { defaultPlaybackKey };
}

export function populateVmInstanceSelectUi({
    elements,
    getRiveInstance = () => null,
    documentRef = globalThis.document,
} = {}) {
    const row = elements.vmInstanceRow;
    const select = elements.vmInstanceSelect;
    const riveInstance = getRiveInstance();
    if (!row || !select || !riveInstance) {
        if (row) row.hidden = true;
        return;
    }

    select.innerHTML = '';

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
        if (instanceCount <= 1) {
            row.hidden = true;
            return;
        }

        const instanceNames = Array.isArray(viewModelDefinition.instanceNames)
            ? viewModelDefinition.instanceNames
            : [];

        if (instanceNames.length > 0) {
            instanceNames.forEach((name) => {
                const option = documentRef.createElement('option');
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            });
        } else {
            for (let index = 0; index < instanceCount; index += 1) {
                const option = documentRef.createElement('option');
                option.value = String(index);
                option.textContent = `Instance ${index}`;
                select.appendChild(option);
            }
        }

        const currentViewModelInstance = riveInstance.viewModelInstance;
        if (currentViewModelInstance?.name) {
            const match = Array.from(select.options).find((option) => option.value === currentViewModelInstance.name);
            if (match) {
                select.value = currentViewModelInstance.name;
            }
        }

        row.hidden = false;
    } catch (error) {
        console.warn('[rive-viewer] VM instance enumeration failed:', error);
        row.hidden = true;
    }
}
