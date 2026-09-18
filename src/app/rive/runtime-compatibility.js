import { createRiveRuntimeCompatibility } from '../snippets/generated/rive-runtime-compatibility.generated.js';

export const {
    isModernRuntime,
    getStateMachineNames,
    normalizePlaybackConfig,
    clearInspectionMetadata,
    setInspectionMetadata,
    getInspectionMetadata,
} = createRiveRuntimeCompatibility();
