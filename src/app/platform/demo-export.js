import { normalizeStateMachineSelection } from '../rive/default-state-machine.js';
import {
    buildEffectiveInstantiationDescriptor,
    buildWebInstantiationResult,
} from './web-instantiation.js';

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
    currentFileBuffer,
    currentLayoutAlignment = 'center',
    currentFileName,
    currentLayoutFit = 'contain',
    editorConfig = {},
    layoutState = {},
    runtimeName,
    runtimeScript,
    runtimeVersion,
    stateMachines = [],
    transparencyState = {},
    vmHierarchy = null,
    instantiationCode = '',
    instantiationSourceMode = 'internal',
} = {}) {
    return {
        file_name: currentFileName,
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
        canvas_color: transparencyState.canvasTransparent ? null : transparencyState.canvasColor,
        canvas_transparent: transparencyState.canvasTransparent,
        instantiation_code: instantiationCode,
        instantiation_source_mode: instantiationSourceMode,
        layout_state: JSON.stringify(layoutState),
        vm_hierarchy: vmHierarchy ? JSON.stringify(vmHierarchy) : null,
    };
}

export function createDemoExportController({
    callbacks = {},
    getArtboardStateSnapshot = () => ({}),
    getCurrentFileBuffer = () => null,
    getCurrentFileName = () => null,
    getCurrentLayoutAlignment = () => 'center',
    getCurrentLayoutFit = () => 'contain',
    getCurrentRuntime = () => 'webgl2',
    getEditorConfig = () => ({}),
    getEffectiveRuntimeVersionToken = (token) => token,
    getLiveConfigState = () => ({
        appliedEditorCode: '',
        sourceMode: 'internal',
    }),
    getLayoutStateSnapshot = () => ({}),
    getRiveInstance = () => null,
    getRuntimeAsset = () => null,
    getRuntimeVersionToken = () => 'latest',
    getTransparencyStateSnapshot = () => ({}),
    serializeVmHierarchy = () => null,
} = {}) {
    const {
        ensureRuntime = async () => {},
        getTauriInvoker = () => null,
        logEvent = () => {},
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    async function buildInstantiationContext({ packageSource = 'local' } = {}) {
        const currentFileName = getCurrentFileName();
        if (!currentFileName) {
            throw new Error('Please load a Rive file first.');
        }

        const runtimeName = getCurrentRuntime();
        await ensureRuntime(runtimeName);
        const runtimeAsset = getRuntimeAsset(runtimeName);
        const selectedRuntimeSemver = runtimeAsset?.version || getEffectiveRuntimeVersionToken(getRuntimeVersionToken());
        const liveConfigState = getLiveConfigState();
        const descriptor = buildEffectiveInstantiationDescriptor({
            artboardState: getArtboardStateSnapshot(),
            currentFileName,
            currentLayoutAlignment: getCurrentLayoutAlignment(),
            currentLayoutFit: getCurrentLayoutFit(),
            detectedStateMachines: Array.isArray(getRiveInstance()?.stateMachineNames)
                ? getRiveInstance().stateMachineNames
                : [],
            editorCode: liveConfigState.appliedEditorCode,
            editorConfig: getEditorConfig(),
            runtimeName,
            runtimeVersion: selectedRuntimeSemver,
            sourceMode: liveConfigState.sourceMode,
            transparencyState: getTransparencyStateSnapshot(),
        });

        return {
            descriptor,
            result: buildWebInstantiationResult(descriptor, { packageSource }),
        };
    }

    async function buildExportContext() {
        const currentFileBuffer = getCurrentFileBuffer();
        const currentFileName = getCurrentFileName();
        if (!currentFileBuffer || !currentFileName) {
            throw new Error('Please load a Rive file first.');
        }

        const runtimeName = getCurrentRuntime();
        await ensureRuntime(runtimeName);

        const runtimeAsset = getRuntimeAsset(runtimeName);
        if (!runtimeAsset?.text) {
            throw new Error(`Runtime data for ${runtimeName} is not ready yet. Please wait for it to finish loading.`);
        }

        const selectedRuntimeSemver = runtimeAsset.version || getEffectiveRuntimeVersionToken(getRuntimeVersionToken());
        const instantiationContext = await buildInstantiationContext({ packageSource: 'local' });
        const { descriptor, result: instantiationResult } = instantiationContext;
        const payload = buildDemoBundlePayload({
            artboardState: {
                currentArtboard: descriptor.artboard,
                currentPlaybackName: descriptor.animations[0] || descriptor.stateMachines[0] || null,
                currentPlaybackType: descriptor.animations.length > 0 ? 'animation' : (descriptor.stateMachines.length > 0 ? 'stateMachine' : null),
            },
            currentFileBuffer,
            currentFileName,
            currentLayoutAlignment: getCurrentLayoutAlignment(),
            currentLayoutFit: getCurrentLayoutFit(),
            editorConfig: {
                autoplay: descriptor.autoplay,
            },
            instantiationCode: instantiationResult.code,
            instantiationSourceMode: instantiationResult.sourceMode,
            layoutState: getLayoutStateSnapshot(),
            runtimeName,
            runtimeScript: runtimeAsset.text,
            runtimeVersion: selectedRuntimeSemver,
            stateMachines: descriptor.stateMachines,
            transparencyState: getTransparencyStateSnapshot(),
            vmHierarchy: serializeVmHierarchy(),
        });

        return {
            currentFileName,
            instantiationResult,
            payload,
            runtimeName,
            runtimeVersion: selectedRuntimeSemver,
        };
    }

    async function createDemoBundle() {
        const invoke = getTauriInvoker();
        if (!invoke) {
            showError('Demo bundles can only be created inside the desktop app.');
            return null;
        }

        const runtimeName = getCurrentRuntime();
        let context;
        try {
            context = await buildExportContext();
        } catch (error) {
            const message = String(error?.message || error || 'Failed to create demo bundle.');
            showError(message);
            if (message.startsWith('Runtime data') || message.startsWith('Please load')) {
                return null;
            }
            logEvent('ui', 'demo-build-runtime-error', `Runtime prep failed for ${runtimeName}.`, error);
            return null;
        }

        updateInfo('Building demo bundle...');
        logEvent(
            'ui',
            'demo-build',
            `Building demo bundle for ${context.currentFileName} (${context.runtimeName}@${context.runtimeVersion}).`,
        );

        try {
            const outputPath = await invoke('make_demo_bundle', { payload: context.payload });
            updateInfo(`Demo bundle saved to: ${outputPath}`);
            logEvent('ui', 'demo-build-success', `Demo bundle saved: ${outputPath}`);
            return outputPath;
        } catch (error) {
            const message = String(error?.message || error || '');
            if (message.toLowerCase().includes('cancel')) {
                updateInfo('Export cancelled.');
                logEvent('ui', 'demo-build-cancelled', 'Export cancelled by user.');
                return null;
            }
            showError(`Failed to create demo bundle: ${message}`);
            logEvent('ui', 'demo-build-failed', 'Failed to build demo bundle.', error);
            return null;
        }
    }

    async function exportDemoToPath(outputPath) {
        const invoke = getTauriInvoker();
        if (!invoke) {
            throw new Error('Export requires the Tauri desktop app');
        }

        const context = await buildExportContext();
        logEvent('mcp', 'export', `Exporting demo to ${outputPath}`);
        const result = await invoke('make_demo_bundle_to_path', { payload: context.payload, outputPath });
        logEvent('mcp', 'export-complete', `Demo saved: ${result}`);
        return result;
    }

    async function generateWebInstantiationCode({ packageSource = 'local' } = {}) {
        const context = await buildInstantiationContext({ packageSource });
        return context.result;
    }

    return {
        buildExportContext,
        createDemoBundle,
        exportDemoToPath,
        generateWebInstantiationCode,
    };
}
