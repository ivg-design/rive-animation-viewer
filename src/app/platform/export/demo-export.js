import { buildDemoBundlePayload } from './demo-payload.js';
export { arrayBufferToBase64, resolveExportStateMachines, buildDemoBundlePayload } from './demo-payload.js';
import { createSourceScope, sourceScopesMatch } from '../../rive/inspection/source-scope.js';
import {
    controlSelectionKeyForDescriptor,
    isControlDescriptorSelected,
    normalizeControlSelectionKey,
} from '../../rive/vm-controls.js';
import {
    buildEffectiveInstantiationDescriptor,
    buildWebInstantiationResult,
} from './web-instantiation.js';
import { createRenderSourceIdentityResolver } from './render-source-identity.js';

export function createDemoExportController({
    callbacks = {},
    getArtboardStateSnapshot = () => ({}),
    captureVmControlSnapshot = () => [],
    getCurrentFileBuffer = () => null,
    getCurrentFileName = () => null,
    getCurrentFilePreferenceId = () => null,
    getControlSnapshotScope = () => null,
    getInspectionMetadata = () => null,
    getCurrentCanvasSizing = () => null,
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
    getSelectedControlKeys = () => null,
    getCanvasBackgroundStateSnapshot = () => ({}),
    getChangedVmControlSnapshot = () => [],
    serializeVmHierarchy = () => null,
} = {}) {
    const {
        ensureRuntime = async () => {},
        getTauriInvoker = () => null,
        logEvent = () => {},
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;
    const resolveRenderSourceIdentity = createRenderSourceIdentityResolver();

    function resolveSelectedControlKeys(selectedControlKeys) {
        const explicitKeys = Array.isArray(selectedControlKeys)
            ? selectedControlKeys
            : getSelectedControlKeys();
        const sourceKeys = Array.isArray(explicitKeys)
            ? explicitKeys
            : getChangedVmControlSnapshot()
                .map((entry) => controlSelectionKeyForDescriptor(entry?.descriptor))
                .filter(Boolean);
        return Array.from(new Set(
            sourceKeys
                .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
                .map((entry) => normalizeControlSelectionKey(entry))
                .filter(Boolean),
        ));
    }

    function resolveSelectedControlSnapshot(selectedControlKeys) {
        const resolvedKeys = resolveSelectedControlKeys(selectedControlKeys);
        if (!resolvedKeys.length) {
            return [];
        }

        const allowedKeys = new Set(resolvedKeys);

        return captureVmControlSnapshot().filter((entry) =>
            isControlDescriptorSelected(entry?.descriptor, allowedKeys));
    }

    function resolveAllControlSnapshot() {
        return captureVmControlSnapshot();
    }

    async function buildInstantiationContext({ packageSource = 'local', selectedControlKeys, snippetMode = 'compact' } = {}) {
        const currentFileName = getCurrentFileName();
        if (!currentFileName) {
            throw new Error('Please load a Rive file first.');
        }

        const runtimeName = getCurrentRuntime();
        const buffer = getCurrentFileBuffer();
        const preferenceId = getCurrentFilePreferenceId();
        const selection = getArtboardStateSnapshot();
        const runtimeToken = getRuntimeVersionToken();
        await ensureRuntime(runtimeName);
        if (currentFileName !== getCurrentFileName() || buffer !== getCurrentFileBuffer()
            || preferenceId !== getCurrentFilePreferenceId() || runtimeName !== getCurrentRuntime()
            || runtimeToken !== getRuntimeVersionToken()
            || JSON.stringify(selection) !== JSON.stringify(getArtboardStateSnapshot())) {
            throw new Error('Snippet source changed during preparation.');
        }
        const runtimeAsset = getRuntimeAsset(runtimeName);
        const selectedRuntimeSemver = runtimeAsset?.version || getEffectiveRuntimeVersionToken(getRuntimeVersionToken());
        const metadata = getInspectionMetadata();
        const canCapture = sourceScopesMatch(getControlSnapshotScope(), createSourceScope({
            sourceIdentity: metadata?.sourceIdentity, runtimeKey: `${runtimeName}@${selectedRuntimeSemver}`,
            artboardKey: selection.currentArtboard, vmInstanceKey: selection.currentVmInstanceName,
        }));
        const liveConfigState = getLiveConfigState();
        const controlSelectionKeys = resolveSelectedControlKeys(selectedControlKeys);
        const controlSnapshot = !canCapture ? [] : snippetMode === 'scaffold'
            ? resolveAllControlSnapshot()
            : resolveSelectedControlSnapshot(controlSelectionKeys);
        const descriptor = buildEffectiveInstantiationDescriptor({
            artboardState: getArtboardStateSnapshot(),
            currentFileName,
            currentCanvasSizing: getCurrentCanvasSizing(),
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
            canvasBackgroundState: getCanvasBackgroundStateSnapshot(),
        });

        return {
            controlSnapshot,
            descriptor,
            result: buildWebInstantiationResult(descriptor, {
                controlSnapshot,
                packageSource,
                selectedControlKeys: controlSelectionKeys,
                snippetMode,
            }),
        };
    }

    async function buildExportContext({ packageSource = 'cdn', selectedControlKeys, snippetMode = 'compact' } = {}) {
        const currentFileBuffer = getCurrentFileBuffer();
        const currentFileName = getCurrentFileName();
        if (!currentFileBuffer || !currentFileName) {
            throw new Error('Please load a Rive file first.');
        }

        const runtimeName = getCurrentRuntime();
        const preferenceId = getCurrentFilePreferenceId();
        const runtimeToken = getRuntimeVersionToken();
        const initialSelection = JSON.stringify(getArtboardStateSnapshot());
        const assertCurrent = () => {
            if (currentFileBuffer !== getCurrentFileBuffer() || currentFileName !== getCurrentFileName()
                || preferenceId !== getCurrentFilePreferenceId() || runtimeName !== getCurrentRuntime()
                || runtimeToken !== getRuntimeVersionToken() || initialSelection !== JSON.stringify(getArtboardStateSnapshot())) {
                throw new Error('Export source changed during preparation.');
            }
        };
        const sourceIdentity = await resolveRenderSourceIdentity(currentFileBuffer, preferenceId);
        assertCurrent();
        await ensureRuntime(runtimeName);
        assertCurrent();

        const runtimeAsset = getRuntimeAsset(runtimeName);
        if (!runtimeAsset?.text) {
            throw new Error(`Runtime data for ${runtimeName} is not ready yet. Please wait for it to finish loading.`);
        }

        const selectedRuntimeSemver = runtimeAsset.version || getEffectiveRuntimeVersionToken(getRuntimeVersionToken());
        const selection = getArtboardStateSnapshot();
        const sourceScope = createSourceScope({ sourceIdentity,
            runtimeKey: `${runtimeName}@${selectedRuntimeSemver}`,
            artboardKey: selection.currentArtboard, vmInstanceKey: selection.currentVmInstanceName });
        const canCapture = sourceScopesMatch(getControlSnapshotScope(), sourceScope);
        const defaultPackageSource = packageSource === 'local' ? 'local' : 'cdn';
        const controlSelectionKeys = resolveSelectedControlKeys(selectedControlKeys);
        const controlSnapshot = canCapture ? resolveSelectedControlSnapshot(controlSelectionKeys) : [];
        const descriptor = buildEffectiveInstantiationDescriptor({
            artboardState: getArtboardStateSnapshot(),
            currentFileName,
            currentCanvasSizing: getCurrentCanvasSizing(),
            currentLayoutAlignment: getCurrentLayoutAlignment(),
            currentLayoutFit: getCurrentLayoutFit(),
            detectedStateMachines: Array.isArray(getRiveInstance()?.stateMachineNames)
                ? getRiveInstance().stateMachineNames
                : [],
            editorCode: getLiveConfigState().appliedEditorCode,
            editorConfig: getEditorConfig(),
            runtimeName,
            runtimeVersion: selectedRuntimeSemver,
            sourceMode: getLiveConfigState().sourceMode,
            canvasBackgroundState: getCanvasBackgroundStateSnapshot(),
        });
        const instantiationSnippets = {
            cdn: buildWebInstantiationResult(descriptor, {
                controlSnapshot: snippetMode === 'scaffold' && canCapture ? resolveAllControlSnapshot() : controlSnapshot,
                packageSource: 'cdn',
                selectedControlKeys: controlSelectionKeys,
                snippetMode,
            }),
            local: buildWebInstantiationResult(descriptor, {
                controlSnapshot: snippetMode === 'scaffold' && canCapture ? resolveAllControlSnapshot() : controlSnapshot,
                packageSource: 'local',
                selectedControlKeys: controlSelectionKeys,
                snippetMode,
            }),
        };
        const payload = buildDemoBundlePayload({
            artboardState: {
                currentArtboard: descriptor.artboard,
                currentPlaybackName: descriptor.animations[0] || descriptor.stateMachines[0] || null,
                currentPlaybackType: descriptor.animations.length > 0 ? 'animation' : (descriptor.stateMachines.length > 0 ? 'stateMachine' : null),
                currentVmInstanceName: descriptor.viewModelInstanceName,
            },
            controlSnapshot,
            controlSelectionKeys,
            currentFileBuffer,
            currentFileName,
            currentCanvasSizing: descriptor.canvasSizing,
            currentLayoutAlignment: getCurrentLayoutAlignment(),
            currentLayoutFit: getCurrentLayoutFit(),
            defaultInstantiationPackageSource: defaultPackageSource,
            editorCode: descriptor.editorCode,
            editorConfig: {
                autoplay: descriptor.autoplay,
            },
            instantiationCode: instantiationSnippets[defaultPackageSource].code,
            instantiationSnippets: {
                cdn: instantiationSnippets.cdn.code,
                local: instantiationSnippets.local.code,
            },
            instantiationSourceMode: instantiationSnippets[defaultPackageSource].sourceMode,
            layoutState: getLayoutStateSnapshot(),
            runtimeName,
            runtimeScript: runtimeAsset.text,
            runtimeVersion: selectedRuntimeSemver,
            stateMachines: descriptor.stateMachines,
            canvasBackgroundState: getCanvasBackgroundStateSnapshot(),
            vmHierarchy: canCapture ? serializeVmHierarchy() : null,
            inspectionMetadata: getInspectionMetadata(),
        });

        assertCurrent();
        if (sourceIdentity !== await resolveRenderSourceIdentity(currentFileBuffer, preferenceId)) {
            throw new Error('Export source bytes changed during preparation.');
        }
        assertCurrent();
        return {
            assertCurrent, sourceScope,
            currentFileName,
            instantiationResult: instantiationSnippets[defaultPackageSource],
            instantiationSnippets,
            payload,
            runtimeName,
            runtimeVersion: selectedRuntimeSemver,
            sourceIdentity,
        };
    }

    async function buildRenderSurfaceContext() {
        const context = await buildExportContext({
            packageSource: 'cdn',
            selectedControlKeys: [],
            snippetMode: 'compact',
        });
        context.assertCurrent();
        const controlSnapshot = sourceScopesMatch(getControlSnapshotScope(), context.sourceScope)
            ? resolveAllControlSnapshot() : [];
        return {
            ...context,
            payload: {
                ...context.payload,
                control_selection_keys: null,
                control_snapshot: JSON.stringify(controlSnapshot),
            },
        };
    }

    async function createDemoBundle(options = {}) {
        const strictResult = options.strictResult === true;
        const exportOptions = { ...options };
        delete exportOptions.strictResult;
        const invoke = getTauriInvoker();
        if (!invoke) {
            const message = 'Demo bundles can only be created inside the desktop app.';
            showError(message);
            if (strictResult) throw new Error(message);
            return null;
        }

        const runtimeName = getCurrentRuntime();
        let context;
        try {
            context = await buildExportContext(exportOptions);
        } catch (error) {
            const message = String(error?.message || error || 'Failed to create demo bundle.');
            showError(message);
            if (strictResult) throw new Error(message);
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
            if (strictResult) return { outputPath, status: 'saved' };
            return outputPath;
        } catch (error) {
            const message = String(error?.message || error || '');
            if (message.toLowerCase().includes('cancel')) {
                updateInfo('Export cancelled.');
                logEvent('ui', 'demo-build-cancelled', 'Export cancelled by user.');
                if (strictResult) return { status: 'cancelled' };
                return null;
            }
            const failureMessage = `Failed to create demo bundle: ${message}`;
            showError(failureMessage);
            logEvent('ui', 'demo-build-failed', 'Failed to build demo bundle.', error);
            if (strictResult) throw new Error(failureMessage);
            return null;
        }
    }

    async function exportDemoToPath(outputPath, options = {}) {
        const invoke = getTauriInvoker();
        if (!invoke) {
            throw new Error('Export requires the Tauri desktop app');
        }

        const context = await buildExportContext(options);
        logEvent('mcp', 'export', `Exporting demo to ${outputPath}`);
        const result = await invoke('make_demo_bundle_to_path', { payload: context.payload, outputPath });
        logEvent('mcp', 'export-complete', `Demo saved: ${result}`);
        return result;
    }

    async function openIsolatedPlayback(options = {}) {
        const invoke = getTauriInvoker();
        if (!invoke) {
            throw new Error('Isolated playback requires the Tauri desktop app');
        }

        const context = await buildExportContext(options);
        logEvent(
            'ui',
            'isolated-playback-open',
            `Opening isolated playback for ${context.currentFileName} (${context.runtimeName}@${context.runtimeVersion}).`,
        );
        const result = await invoke('open_isolated_playback', { payload: context.payload });
        logEvent('ui', 'isolated-playback-opened', `Opened isolated playback: ${result?.windowLabel || 'window'}.`);
        return result;
    }

    async function generateWebInstantiationCode({ packageSource = 'cdn', selectedControlKeys, snippetMode = 'compact' } = {}) {
        const context = await buildInstantiationContext({ packageSource, selectedControlKeys, snippetMode });
        return context.result;
    }

    return {
        buildExportContext,
        buildRenderSurfaceContext,
        createDemoBundle,
        exportDemoToPath,
        generateWebInstantiationCode,
        openIsolatedPlayback,
    };
}
