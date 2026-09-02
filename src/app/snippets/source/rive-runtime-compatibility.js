// Shared by RAV and its standalone demo. Keep this factory dependency-free.
function createRiveRuntimeCompatibility() {
    const inputMetadata = new WeakMap();
    function names(value) {
        return (Array.isArray(value) ? value : [value])
            .filter((name) => typeof name === 'string' && name.trim().length > 0);
    }

    function isModernRuntime(version) {
        const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:\+[^\s]+)?$/.exec(String(version || '').trim());
        if (!match) return false;
        return Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 41);
    }

    function getStateMachineNames(config) {
        const singular = typeof config?.stateMachine === 'string' ? names(config.stateMachine) : [];
        return singular.length ? singular : names(config?.stateMachines);
    }

    function normalizePlaybackConfig(config, runtimeVersion) {
        const result = { ...config };
        const stateMachines = getStateMachineNames(config);
        const singularRequested = typeof config?.stateMachine === 'string' && names(config.stateMachine).length > 0;
        const animations = names(config?.animations);
        delete result.stateMachine;
        delete result.stateMachines;
        if (singularRequested || animations.length === 0) delete result.animations;
        if (!stateMachines.length) return result;

        // The singular API takes precedence over animations. Do not silently
        // convert a legacy mixed/multiple selection into single-SM playback.
        if (stateMachines.length === 1 && (singularRequested || animations.length === 0)) {
            result[isModernRuntime(runtimeVersion) ? 'stateMachine' : 'stateMachines'] = stateMachines[0];
        } else {
            result.stateMachines = stateMachines.length === 1 ? stateMachines[0] : stateMachines;
        }
        return result;
    }

    function getStateMachineInputMetadata(instance, stateMachineName) {
        try {
            const activeArtboard = instance?.activeArtboard;
            if (typeof activeArtboard !== 'string' || !activeArtboard) return null;
            let artboards = inputMetadata.get(instance);
            if (!artboards) {
                artboards = instance?.contents?.artboards;
                if (!Array.isArray(artboards)) return null;
                inputMetadata.set(instance, artboards);
            }
            const artboard = artboards.find((entry) => entry?.name === activeArtboard);
            if (!Array.isArray(artboard?.stateMachines)) return null;
            const machine = artboard.stateMachines.find((entry) => entry?.name === stateMachineName);
            return Array.isArray(machine?.inputs) ? machine.inputs : null;
        } catch {
            return null;
        }
    }

    // File contents are immutable, but Rive.load() can reuse a wrapper. Call at
    // the start of onLoad before rebuilding controls or invoking user code.
    function clearStateMachineInputMetadata(instance) {
        if (instance) inputMetadata.delete(instance);
    }

    return { isModernRuntime, getStateMachineNames, normalizePlaybackConfig, getStateMachineInputMetadata, clearStateMachineInputMetadata };
}
