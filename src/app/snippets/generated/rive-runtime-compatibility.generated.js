// Shared by RAV and its standalone demo. Keep this factory dependency-free.
function createRiveRuntimeCompatibility() {
    const inspectionMetadata = new WeakMap();
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

    function setInspectionMetadata(instance, metadata) {
        if (!instance) return;
        if (Array.isArray(metadata?.artboards)) inspectionMetadata.set(instance, metadata);
        else inspectionMetadata.delete(instance);
    }

    function getInspectionMetadata(instance) { return instance ? inspectionMetadata.get(instance) || null : null; }

    // Inspected metadata is immutable, but Rive.load() can reuse a wrapper. Call at
    // the start of onLoad before rebuilding controls or invoking user code.
    function clearInspectionMetadata(instance) {
        if (instance) inspectionMetadata.delete(instance);
    }

    return { isModernRuntime, getStateMachineNames, normalizePlaybackConfig, clearInspectionMetadata, setInspectionMetadata, getInspectionMetadata };
}

export { createRiveRuntimeCompatibility };
