export function parsePlaybackTarget(target) {
    if (!target) {
        return { type: null, name: null };
    }
    if (target.startsWith('sm:')) {
        return { type: 'stateMachine', name: target.slice(3) };
    }
    if (target.startsWith('anim:')) {
        return { type: 'animation', name: target.slice(5) };
    }
    return { type: 'stateMachine', name: target };
}

export function createArtboardSwitcherController({
    elements,
    callbacks = {},
    documentRef = globalThis.document,
    getCurrentFileName = () => null,
    getCurrentFileUrl = () => null,
    getRiveInstance = () => null,
} = {}) {
    const {
        initLucideIcons = () => {},
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        renderVmInputControls = () => {},
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    let currentArtboardName = null;
    let currentPlaybackType = null;
    let currentPlaybackName = null;
    let defaultArtboardName = null;
    let defaultPlaybackKey = null;
    let fileContentsCache = null;

    function resetForNewFile() {
        currentArtboardName = null;
        currentPlaybackType = null;
        currentPlaybackName = null;
        defaultArtboardName = null;
        defaultPlaybackKey = null;
        fileContentsCache = null;
    }

    function syncStateFromConfig({
        artboard = null,
        configuredStateMachines = [],
        animations = null,
        hasConfiguredAnimation = false,
    } = {}) {
        if (artboard) {
            currentArtboardName = artboard;
        }
        if (configuredStateMachines.length) {
            currentPlaybackType = 'stateMachine';
            currentPlaybackName = configuredStateMachines[0];
        } else if (hasConfiguredAnimation) {
            currentPlaybackType = 'animation';
            currentPlaybackName = Array.isArray(animations) ? animations[0] : animations;
        }
    }

    function syncStateAfterLoad(riveInstance, config = {}) {
        currentArtboardName = riveInstance?.artboard?.name || currentArtboardName || config.artboard || null;
    }

    function populateArtboardSwitcher() {
        const switcher = elements.artboardSwitcher;
        const artboardSelect = elements.artboardSelect;
        const riveInstance = getRiveInstance();
        if (!switcher || !artboardSelect || !riveInstance) {
            if (switcher) {
                switcher.hidden = true;
            }
            return;
        }

        const contents = riveInstance.contents;
        if (!contents?.artboards?.length) {
            fileContentsCache = null;
            switcher.hidden = true;
            return;
        }
        fileContentsCache = contents;

        artboardSelect.innerHTML = '';
        const artboards = contents.artboards;
        artboards.forEach((artboard) => {
            const name = typeof artboard === 'string' ? artboard : artboard.name;
            const option = documentRef.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === currentArtboardName) {
                option.selected = true;
            }
            artboardSelect.appendChild(option);
        });

        if (defaultArtboardName === null) {
            defaultArtboardName = currentArtboardName || (artboards[0]?.name ?? artboards[0]);
        }

        populatePlaybackSelect();
        populateVmInstanceSelect();

        if (elements.artboardSwitcherCount) {
            elements.artboardSwitcherCount.textContent = String(artboards.length);
        }

        switcher.hidden = false;
        initLucideIcons();
    }

    function populatePlaybackSelect() {
        const select = elements.playbackSelect;
        if (!select || !fileContentsCache) {
            return;
        }

        select.innerHTML = '';
        const selectedArtboardName = elements.artboardSelect?.value || currentArtboardName;
        const artboards = fileContentsCache?.artboards || [];
        const artboard = artboards.find((entry) => {
            const name = typeof entry === 'string' ? entry : entry.name;
            return name === selectedArtboardName;
        });

        if (!artboard || typeof artboard === 'string') {
            return;
        }

        const stateMachines = artboard.stateMachines || [];
        stateMachines.forEach((stateMachine) => {
            const name = typeof stateMachine === 'string' ? stateMachine : stateMachine.name;
            const option = documentRef.createElement('option');
            option.value = `sm:${name}`;
            option.textContent = name;
            select.appendChild(option);
        });

        const animations = artboard.animations || [];
        animations.forEach((animation) => {
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
    }

    function populateVmInstanceSelect() {
        const row = elements.vmInstanceRow;
        const select = elements.vmInstanceSelect;
        const riveInstance = getRiveInstance();
        if (!row || !select || !riveInstance) {
            if (row) {
                row.hidden = true;
            }
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

    async function switchArtboard(artboardName, playbackTarget) {
        if (!getCurrentFileUrl() || !getCurrentFileName()) {
            return;
        }

        const { type: playbackType, name: playbackName } = parsePlaybackTarget(playbackTarget);
        logEvent(
            'ui',
            'artboard-switch',
            `Switching to artboard "${artboardName}" ${playbackType ? `with ${playbackType} "${playbackName}"` : '(auto)'}.`,
        );
        updateInfo(`Switching to "${artboardName}"...`);

        const previousState = {
            artboardName: currentArtboardName,
            playbackType: currentPlaybackType,
            playbackName: currentPlaybackName,
        };

        currentArtboardName = artboardName;
        currentPlaybackType = playbackType;
        currentPlaybackName = playbackName;

        const overrides = { artboard: artboardName, autoplay: true, autoBind: true };
        if (playbackType === 'stateMachine' && playbackName) {
            overrides.stateMachines = playbackName;
            delete overrides.animations;
        } else if (playbackType === 'animation' && playbackName) {
            overrides.animations = playbackName;
            delete overrides.stateMachines;
        }

        try {
            await new Promise((resolve, reject) => {
                let settled = false;
                const resolveOnce = () => {
                    if (!settled) {
                        settled = true;
                        resolve();
                    }
                };
                const rejectOnce = (error) => {
                    if (!settled) {
                        settled = true;
                        reject(error || new Error('Switch failed'));
                    }
                };

                loadRiveAnimation(getCurrentFileUrl(), getCurrentFileName(), {
                    forceAutoplay: true,
                    configOverrides: overrides,
                    onLoaded: resolveOnce,
                    onLoadError: rejectOnce,
                }).catch(rejectOnce);
            });
            updateInfo(`Playing "${artboardName}"`);
        } catch (error) {
            currentArtboardName = previousState.artboardName;
            currentPlaybackType = previousState.playbackType;
            currentPlaybackName = previousState.playbackName;
            showError(`Failed to switch artboard: ${error?.message || error}`);
        }
    }

    function resetToDefaultArtboard() {
        if (!defaultArtboardName) {
            showError('No default artboard. Reload the file.');
            return;
        }

        currentPlaybackType = null;
        currentPlaybackName = null;

        const playbackTarget = defaultPlaybackKey || null;
        logEvent('ui', 'artboard-reset', `Reset to default artboard "${defaultArtboardName}".`);
        switchArtboard(defaultArtboardName, playbackTarget);
    }

    function switchVmInstance(instanceKey) {
        const riveInstance = getRiveInstance();
        if (!riveInstance || !instanceKey) {
            return;
        }

        try {
            const viewModelDefinition = typeof riveInstance.defaultViewModel === 'function'
                ? riveInstance.defaultViewModel()
                : null;
            if (!viewModelDefinition) {
                console.warn('[rive-viewer] No ViewModel definition for current artboard');
                return;
            }

            let newInstance = null;
            if (typeof viewModelDefinition.instanceByName === 'function') {
                try {
                    newInstance = viewModelDefinition.instanceByName(instanceKey);
                } catch {
                    /* not found */
                }
            }
            if (!newInstance) {
                const index = Number.parseInt(instanceKey, 10);
                if (!Number.isNaN(index) && typeof viewModelDefinition.instanceByIndex === 'function') {
                    newInstance = viewModelDefinition.instanceByIndex(index);
                }
            }

            if (!newInstance) {
                console.warn('[rive-viewer] VM instance not found:', instanceKey);
                return;
            }

            if (typeof riveInstance.bindViewModelInstance === 'function') {
                riveInstance.bindViewModelInstance(newInstance);
                renderVmInputControls();
                logEvent(
                    'ui',
                    'vm-instance-switch',
                    `Bound instance "${instanceKey}" from ${viewModelDefinition.name || 'ViewModel'}`,
                );
                return;
            }

            console.warn('[rive-viewer] bindViewModelInstance not available on this runtime version');
        } catch (error) {
            console.warn('[rive-viewer] VM instance switch failed:', error);
        }
    }

    function setupArtboardSwitcher() {
        const artboardSelect = elements.artboardSelect;
        const playbackSelect = elements.playbackSelect;
        const viewModelSelect = elements.vmInstanceSelect;
        const resetButton = elements.artboardResetBtn;

        if (artboardSelect) {
            artboardSelect.addEventListener('change', () => {
                populatePlaybackSelect();
                const playbackTarget = elements.playbackSelect?.value || null;
                switchArtboard(artboardSelect.value, playbackTarget);
            });
        }

        if (playbackSelect) {
            playbackSelect.addEventListener('change', () => {
                const artboard = elements.artboardSelect?.value || currentArtboardName;
                switchArtboard(artboard, playbackSelect.value);
            });
        }

        if (viewModelSelect) {
            viewModelSelect.addEventListener('change', () => {
                switchVmInstance(viewModelSelect.value);
            });
        }

        if (resetButton) {
            resetButton.addEventListener('click', () => {
                resetToDefaultArtboard();
            });
        }
    }

    function getStateSnapshot() {
        return {
            contents: fileContentsCache,
            currentArtboard: currentArtboardName,
            currentPlaybackName,
            currentPlaybackType,
            defaultArtboard: defaultArtboardName,
            defaultPlaybackKey,
        };
    }

    return {
        getStateSnapshot,
        parsePlaybackTarget,
        populateArtboardSwitcher,
        populatePlaybackSelect,
        populateVmInstanceSelect,
        resetForNewFile,
        resetToDefaultArtboard,
        setupArtboardSwitcher,
        switchArtboard,
        switchVmInstance,
        syncStateAfterLoad,
        syncStateFromConfig,
    };
}
