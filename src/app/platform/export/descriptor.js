import { DEFAULT_CANVAS_COLOR } from '../../core/constants.js';
import { normalizeStateMachineSelection } from '../../rive/default-state-machine.js';
import { getRuntimePackageName } from '../runtime-utils.js';

export function normalizeAnimationSelection(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return [value];
    }
    return [];
}

export function resolveLivePlaybackSelection({
    artboardState = {},
    editorConfig = {},
    detectedStateMachines = [],
} = {}) {
    const artboard = artboardState.currentArtboard || editorConfig.artboard || null;
    if (artboardState.currentPlaybackType === 'stateMachine' && artboardState.currentPlaybackName) {
        return { animations: [], artboard, stateMachines: [artboardState.currentPlaybackName] };
    }
    if (artboardState.currentPlaybackType === 'animation' && artboardState.currentPlaybackName) {
        return { animations: [artboardState.currentPlaybackName], artboard, stateMachines: [] };
    }

    const stateMachines = normalizeStateMachineSelection(editorConfig.stateMachines);
    if (stateMachines.length > 0) {
        return { animations: [], artboard, stateMachines };
    }

    const animations = normalizeAnimationSelection(editorConfig.animations);
    if (animations.length > 0) {
        return { animations, artboard, stateMachines: [] };
    }

    return {
        animations: [],
        artboard,
        stateMachines: detectedStateMachines.filter((entry) => typeof entry === 'string' && entry.trim().length > 0),
    };
}

export function buildEffectiveInstantiationDescriptor({
    currentFileName = 'animation.riv',
    currentLayoutAlignment = 'center',
    currentLayoutFit = 'contain',
    detectedStateMachines = [],
    editorCode = '',
    editorConfig = {},
    artboardState = {},
    runtimeName = 'webgl2',
    runtimeVersion = null,
    sourceMode = 'internal',
    transparencyState = {},
} = {}) {
    const normalizedSourceMode = sourceMode === 'editor' ? 'editor' : 'internal';
    const effectiveEditorConfig = normalizedSourceMode === 'editor' && editorConfig && typeof editorConfig === 'object'
        ? editorConfig
        : {};
    const playbackSelection = resolveLivePlaybackSelection({
        artboardState,
        editorConfig: effectiveEditorConfig,
        detectedStateMachines,
    });
    const canvasTransparent = Boolean(transparencyState.canvasTransparent);
    const canvasColor = canvasTransparent ? null : (transparencyState.canvasColor || DEFAULT_CANVAS_COLOR);
    const packageName = getRuntimePackageName(runtimeName);
    const effectiveRuntimeVersion = String(runtimeVersion || '').trim() || 'latest';

    return {
        animations: playbackSelection.animations,
        artboard: playbackSelection.artboard,
        autoBind: typeof effectiveEditorConfig.autoBind === 'boolean' ? effectiveEditorConfig.autoBind : true,
        autoplay: typeof effectiveEditorConfig.autoplay === 'boolean' ? effectiveEditorConfig.autoplay : true,
        canvasColor,
        canvasTransparent,
        editorCode: normalizedSourceMode === 'editor' ? String(editorCode || '').trim() : '',
        fileName: currentFileName || 'animation.riv',
        layoutAlignment: currentLayoutAlignment,
        layoutFit: currentLayoutFit,
        runtimeName,
        runtimePackageName: packageName,
        runtimeVersion: effectiveRuntimeVersion,
        runtimeCdnUrl: `https://unpkg.com/${packageName}@${effectiveRuntimeVersion}`,
        sourceMode: normalizedSourceMode,
        stateMachines: playbackSelection.stateMachines,
        useOffscreenRenderer: runtimeName !== 'canvas' && canvasTransparent
            ? (typeof effectiveEditorConfig.useOffscreenRenderer === 'boolean' ? effectiveEditorConfig.useOffscreenRenderer : true)
            : effectiveEditorConfig.useOffscreenRenderer,
    };
}
