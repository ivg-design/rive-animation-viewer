import { normalizeStateMachineSelection } from '../../rive/default-state-machine.js';

export function arrayBufferToBase64(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
        return '';
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}
export function resolveExportStateMachines(configStateMachines, detectedStateMachines = []) {
    const configuredStateMachines = normalizeStateMachineSelection(configStateMachines);
    return configuredStateMachines.length ? configuredStateMachines : detectedStateMachines;
}

export function buildDemoBundlePayload({
    artboardState = {},
    controlSelectionKeys = [],
    controlSnapshot = null,
    currentFileBuffer,
    currentLayoutAlignment = 'center',
    currentCanvasSizing = null,
    currentFileName,
    currentLayoutFit = 'contain',
    defaultInstantiationPackageSource = 'cdn',
    editorCode = '',
    editorConfig = {},
    layoutState = {},
    instantiationSnippets = null,
    inspectionMetadata = null,
    runtimeName,
    runtimeScript,
    runtimeVersion,
    stateMachines = [],
    canvasBackgroundState = {},
    vmHierarchy = null,
    instantiationCode = '',
    instantiationSourceMode = 'internal',
} = {}) {
    return {
        file_name: currentFileName,
        inspection_metadata: inspectionMetadata ? JSON.stringify(inspectionMetadata) : null,
        animation_base64: arrayBufferToBase64(currentFileBuffer),
        runtime_name: runtimeName,
        runtime_version: runtimeVersion,
        runtime_script: runtimeScript,
        autoplay: typeof editorConfig.autoplay === 'boolean' ? editorConfig.autoplay : true,
        layout_alignment: currentLayoutAlignment,
        layout_fit: currentLayoutFit,
        state_machines: stateMachines,
        animations: artboardState.currentPlaybackType === 'animation' && artboardState.currentPlaybackName ? [artboardState.currentPlaybackName] : [],
        artboard_name: artboardState.currentArtboard,
        canvas_color: canvasBackgroundState.canvasTransparent ? null : canvasBackgroundState.canvasColor,
        canvas_sizing: currentCanvasSizing ? JSON.stringify(currentCanvasSizing) : null,
        canvas_transparent: canvasBackgroundState.canvasTransparent,
        control_selection_keys: JSON.stringify(controlSelectionKeys),
        control_snapshot: controlSnapshot ? JSON.stringify(controlSnapshot) : null,
        default_instantiation_package_source: defaultInstantiationPackageSource,
        editor_code: editorCode,
        instantiation_code: instantiationCode,
        instantiation_snippets: instantiationSnippets ? JSON.stringify(instantiationSnippets) : null,
        instantiation_source_mode: instantiationSourceMode,
        layout_state: JSON.stringify(layoutState),
        view_model_instance_name: artboardState.currentVmInstanceName ?? null,
        vm_hierarchy: vmHierarchy ? JSON.stringify(vmHierarchy) : null,
    };
}
