import { DEFAULT_CANVAS_COLOR } from '../core/constants.js';
import { normalizeStateMachineSelection } from '../rive/default-state-machine.js';
import { getRuntimePackageName } from './runtime-utils.js';

const CALLBACK_NAMES = [
    'onLoad',
    'onLoadError',
    'onPlay',
    'onPause',
    'onStop',
    'onLoop',
    'onStateChange',
    'onAdvance',
];

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
        return {
            animations: [],
            artboard,
            stateMachines: [artboardState.currentPlaybackName],
        };
    }
    if (artboardState.currentPlaybackType === 'animation' && artboardState.currentPlaybackName) {
        return {
            animations: [artboardState.currentPlaybackName],
            artboard,
            stateMachines: [],
        };
    }

    const stateMachines = normalizeStateMachineSelection(editorConfig.stateMachines);
    if (stateMachines.length > 0) {
        return {
            animations: [],
            artboard,
            stateMachines,
        };
    }

    const animations = normalizeAnimationSelection(editorConfig.animations);
    if (animations.length > 0) {
        return {
            animations,
            artboard,
            stateMachines: [],
        };
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
    const canvasColor = canvasTransparent
        ? null
        : (transparencyState.canvasColor || DEFAULT_CANVAS_COLOR);
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

function indentBlock(value, prefix = '  ') {
    return String(value || '')
        .split('\n')
        .map((line) => `${prefix}${line}`)
        .join('\n');
}

function buildConfigPropertyLines(descriptor, runtimeNamespace, useUserConfig = false) {
    const lines = [
        `src: "./${descriptor.fileName}",`,
        'canvas,',
        useUserConfig ? `autoplay: userConfig.autoplay ?? ${descriptor.autoplay},` : `autoplay: ${descriptor.autoplay},`,
        useUserConfig ? `autoBind: userConfig.autoBind ?? ${descriptor.autoBind},` : `autoBind: ${descriptor.autoBind},`,
    ];

    if (descriptor.artboard) {
        lines.push(`artboard: ${JSON.stringify(descriptor.artboard)},`);
    }
    if (descriptor.stateMachines.length > 0) {
        const stateMachineValue = descriptor.stateMachines.length === 1
            ? JSON.stringify(descriptor.stateMachines[0])
            : JSON.stringify(descriptor.stateMachines, null, 2);
        lines.push(`stateMachines: ${stateMachineValue},`);
    } else if (descriptor.animations.length > 0) {
        const animationValue = descriptor.animations.length === 1
            ? JSON.stringify(descriptor.animations[0])
            : JSON.stringify(descriptor.animations, null, 2);
        lines.push(`animations: ${animationValue},`);
    }

    lines.push('layout: new ' + runtimeNamespace + '.Layout({');
    if (useUserConfig) {
        lines.push('  ...(userConfig.layout || {}),');
    }
    lines.push(`  fit: ${JSON.stringify(descriptor.layoutFit)},`);
    lines.push(`  alignment: ${JSON.stringify(descriptor.layoutAlignment)},`);
    lines.push('}),');

    if (descriptor.useOffscreenRenderer !== undefined) {
        lines.push(
            useUserConfig
                ? `useOffscreenRenderer: userConfig.useOffscreenRenderer ?? ${descriptor.useOffscreenRenderer},`
                : `useOffscreenRenderer: ${descriptor.useOffscreenRenderer},`,
        );
    }

    lines.push('onLoad: (...args) => {');
    lines.push('  riveInst.resizeDrawingSurfaceToCanvas();');
    if (useUserConfig) {
        lines.push('  userConfig.onLoad?.(...args);');
    }
    lines.push('},');

    if (useUserConfig) {
        CALLBACK_NAMES.filter((name) => name !== 'onLoad').forEach((name) => {
            lines.push(`${name}: (...args) => userConfig.${name}?.(...args),`);
        });
    }

    return lines;
}

function buildRuntimeBlock(descriptor, { packageSource = 'local' } = {}) {
    if (packageSource === 'cdn') {
        return [
            `<script src="${descriptor.runtimeCdnUrl}"></script>`,
            '<script>',
            '  const rive = window.rive;',
            '  const canvas = document.getElementById("rive-canvas");',
        ];
    }

    return [
        `import * as rive from "${descriptor.runtimePackageName}";`,
        '',
        'const canvas = document.getElementById("rive-canvas");',
    ];
}

export function generateWebInstantiationCode(descriptor, { packageSource = 'local' } = {}) {
    const effectivePackageSource = packageSource === 'cdn' ? 'cdn' : 'local';
    const runtimeBlock = buildRuntimeBlock(descriptor, { packageSource: effectivePackageSource });
    const lines = [
        '<canvas id="rive-canvas"></canvas>',
        ...(effectivePackageSource === 'local' ? ['<script type="module">'] : []),
        ...runtimeBlock,
    ];

    if (descriptor.sourceMode === 'editor' && descriptor.editorCode) {
        lines.push('  const userConfig = (');
        lines.push(indentBlock(descriptor.editorCode, '    '));
        lines.push('  );');
    }

    lines.push('  let riveInst;');
    lines.push('');
    lines.push('  riveInst = new rive.Rive({');
    if (descriptor.sourceMode === 'editor' && descriptor.editorCode) {
        lines.push('    ...userConfig,');
    }
    buildConfigPropertyLines(descriptor, 'rive', descriptor.sourceMode === 'editor' && Boolean(descriptor.editorCode))
        .forEach((line) => {
            lines.push(`    ${line}`);
        });
    lines.push('  });');
    lines.push('');
    lines.push('  window.addEventListener("resize", () => {');
    lines.push('    riveInst?.resizeDrawingSurfaceToCanvas();');
    lines.push('  });');
    if (descriptor.canvasTransparent) {
        lines.push('  canvas.style.background = "transparent";');
    } else if (descriptor.canvasColor) {
        lines.push(`  canvas.style.background = ${JSON.stringify(descriptor.canvasColor)};`);
    }
    if (effectivePackageSource === 'local') {
        lines.push('</script>');
    } else {
        lines.push('</script>');
    }

    return lines.join('\n');
}

export function buildWebInstantiationResult(descriptor, { packageSource = 'local' } = {}) {
    const effectivePackageSource = packageSource === 'cdn' ? 'cdn' : 'local';
    return {
        code: generateWebInstantiationCode(descriptor, { packageSource: effectivePackageSource }),
        fileName: descriptor.fileName,
        packageSource: effectivePackageSource,
        runtimeName: descriptor.runtimeName,
        runtimePackageName: descriptor.runtimePackageName,
        runtimeVersion: descriptor.runtimeVersion,
        sourceMode: descriptor.sourceMode,
        notes: [
            `The snippet expects a canvas element with id "rive-canvas" and the .riv asset available at "./${descriptor.fileName}".`,
            descriptor.sourceMode === 'editor'
                ? 'The snippet mirrors the applied editor config and preserves RAV toolbar overrides for artboard/playback/layout.'
                : 'The snippet mirrors RAV internal wiring plus the currently active artboard/playback/layout state.',
            effectivePackageSource === 'cdn'
                ? `The CDN form uses the global runtime exposed by ${descriptor.runtimeCdnUrl}.`
                : `The local-package form imports ${descriptor.runtimePackageName} from your app bundle.`,
        ],
    };
}
