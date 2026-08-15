export {
    argbToColorMeta,
    clamp,
    hexToRgb,
    rgbAlphaToArgb,
    toHexByte,
} from './view-model/color-utils.js';

export {
    controlSnapshotKeyForDescriptor,
    controlSelectionKeyForDescriptor,
    getStateMachineInputKind,
    getVmAccessor,
    getVmListItemAt,
    getVmListItemName,
    getVmListLength,
    navigateToVmInstance,
    isControlDescriptorSelected,
    normalizeControlSelectionKey,
    resolveVmRootInstance,
    safeVmMethodCall,
    shouldResumePlaybackForTrigger,
} from './view-model/accessors.js';

export {
    buildStateMachineHierarchy,
    buildVmHierarchy,
    countAllInputs,
    formatVmListItemLabel,
    stripNestedRootVmInputs,
} from './view-model/hierarchy.js';

export { createVmControlsController } from './view-model/controller.js';
