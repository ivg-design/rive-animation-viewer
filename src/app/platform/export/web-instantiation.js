import {
    buildPropertyUsageExamples,
    buildSelectedPropertyObjectLines,
    listSelectedPropertyObjectPaths,
} from './property-accessors.js';
import {
    buildEffectiveInstantiationDescriptor,
    normalizeAnimationSelection,
    resolveLivePlaybackSelection,
} from './descriptor.js';
import { buildRiveAlignmentExpression, buildRiveFitExpression } from '../../core/rive-layout.js';
import { normalizePlaybackConfig } from '../../rive/runtime-compatibility.js';
import {
    normalizeControlSnapshot,
    normalizeSnippetMode,
} from './control-snapshot.js';

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

function indentBlock(value, prefix = '  ') {
    return String(value || '').split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function buildViewModelInstanceBindingLines(descriptor) {
    if (!descriptor.viewModelInstanceName) {
        return [];
    }
    const instanceKey = String(descriptor.viewModelInstanceName);
    const isIndex = /^(0|[1-9]\d*)$/.test(instanceKey);
    return [
        '  const selectedViewModel = riveInst.defaultViewModel?.();',
        `  const selectedViewModelInstance = selectedViewModel?.${isIndex ? 'instanceByIndex' : 'instanceByName'}?.(${isIndex ? Number(instanceKey) : JSON.stringify(instanceKey)});`,
        '  if (selectedViewModelInstance) riveInst.bindViewModelInstance?.(selectedViewModelInstance);',
    ];
}

function buildConfigPropertyLines(
    descriptor,
    runtimeNamespace,
    useUserConfig = false,
    selectedPropertyLines = [],
) {
    const lines = [
        `src: "./${descriptor.fileName}",`,
        'canvas,',
        useUserConfig ? `autoplay: userConfig.autoplay ?? ${descriptor.autoplay},` : `autoplay: ${descriptor.autoplay},`,
        descriptor.viewModelInstanceName
            ? 'autoBind: false,'
            : (useUserConfig ? `autoBind: userConfig.autoBind ?? ${descriptor.autoBind},` : `autoBind: ${descriptor.autoBind},`),
    ];

    if (descriptor.artboard) {
        lines.push(`artboard: ${JSON.stringify(descriptor.artboard)},`);
    }
    const playback = normalizePlaybackConfig({
        stateMachines: descriptor.stateMachines,
        animations: descriptor.animations,
    }, descriptor.runtimeVersion);
    ['stateMachine', 'stateMachines', 'animations'].forEach((key) => {
        if (!Object.hasOwn(playback, key)) return;
        const value = Array.isArray(playback[key]) && playback[key].length === 1 ? playback[key][0] : playback[key];
        lines.push(`${key}: ${JSON.stringify(value, null, 2)},`);
    });

    lines.push('layout: new ' + runtimeNamespace + '.Layout({');
    if (useUserConfig) lines.push('  ...(userConfig.layout || {}),');
    lines.push(`  fit: ${buildRiveFitExpression(runtimeNamespace, descriptor.layoutFit)},`);
    lines.push(`  alignment: ${buildRiveAlignmentExpression(runtimeNamespace, descriptor.layoutAlignment)},`);
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
    lines.push(...buildViewModelInstanceBindingLines(descriptor));
    lines.push(...selectedPropertyLines);
    if (useUserConfig) lines.push('  if (typeof userConfig.onLoad === "function") userConfig.onLoad(...args);');
    lines.push('},');
    lines.push('onLoadError: (error, ...args) => {');
    lines.push('  console.error("Rive load error:", error, ...args);');
    if (useUserConfig) lines.push('  if (typeof userConfig.onLoadError === "function") userConfig.onLoadError(error, ...args);');
    lines.push('},');

    if (useUserConfig) {
        CALLBACK_NAMES.filter((name) => name !== 'onLoad' && name !== 'onLoadError').forEach((name) => {
            lines.push(`...(typeof userConfig.${name} === "function" ? { ${name}: (...args) => userConfig.${name}(...args) } : {}),`);
        });
    }

    return lines;
}

function buildCanvasSizingLines(descriptor) {
    const sizing = descriptor?.canvasSizing;
    if (!sizing || sizing.mode !== 'fixed') {
        return [];
    }

    return [
        `  canvas.width = ${sizing.width};`,
        `  canvas.height = ${sizing.height};`,
        `  canvas.style.width = "${sizing.width}px";`,
        `  canvas.style.height = "${sizing.height}px";`,
    ];
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

export { buildEffectiveInstantiationDescriptor, normalizeAnimationSelection, resolveLivePlaybackSelection };

export function generateWebInstantiationCode(descriptor, {
    packageSource = 'cdn',
    controlSnapshot = [],
    selectedControlKeys = null,
    snippetMode = 'compact',
} = {}) {
    const effectivePackageSource = packageSource === 'cdn' ? 'cdn' : 'local';
    const normalizedSnapshot = normalizeControlSnapshot(controlSnapshot);
    const selectedPropertyLines = buildSelectedPropertyObjectLines(normalizedSnapshot, {
        selectedControlKeys,
        snippetMode,
    });
    const hasControlBindings = selectedPropertyLines.length > 0;
    const runtimeBlock = buildRuntimeBlock(descriptor, { packageSource: effectivePackageSource });
    const lines = [
        '<!-- Embeddable RAV snippet. Wrap it in a full HTML document if you want a standalone page. -->',
        '<canvas id="rive-canvas"></canvas>',
        ...(effectivePackageSource === 'local' ? ['<script type="module">'] : []),
        ...runtimeBlock,
        ...buildCanvasSizingLines(descriptor),
    ];

    if (hasControlBindings) {
        lines.push('  // Selected controls are populated with direct runtime accessors in onLoad.');
        lines.push('  const riveProperties = {};');
        lines.push('');
    }

    if (descriptor.sourceMode === 'editor' && descriptor.editorCode) {
        lines.push('  const rawUserConfig = (');
        lines.push(indentBlock(descriptor.editorCode, '    '));
        lines.push('  );');
        lines.push('  // Playback and canvas sizing come from the current RAV selection.');
        lines.push('  const { canvasSize: _ignoredCanvasSize, stateMachine: _ignoredMachine,');
        lines.push('    stateMachines: _ignoredMachines, animations: _ignoredAnimations, ...userConfig } = rawUserConfig || {};');
    }

    lines.push('  let riveInst;');
    lines.push('');
    lines.push('  riveInst = new rive.Rive({');
    if (descriptor.sourceMode === 'editor' && descriptor.editorCode) {
        lines.push('    ...userConfig,');
    }
    buildConfigPropertyLines(
        descriptor,
        'rive',
        descriptor.sourceMode === 'editor' && Boolean(descriptor.editorCode),
        selectedPropertyLines,
    )
        .forEach((line) => lines.push(`    ${line}`));
    lines.push('  });');
    lines.push('');
    lines.push('  window.riveInst = riveInst;');
    if (hasControlBindings) lines.push('  window.riveProperties = riveProperties;');
    lines.push('  window.addEventListener("resize", () => {');
    lines.push('    riveInst?.resizeDrawingSurfaceToCanvas();');
    lines.push('  });');
    if (descriptor.canvasTransparent) {
        lines.push('  canvas.style.background = "transparent";');
    } else if (descriptor.canvasColor) {
        lines.push(`  canvas.style.background = ${JSON.stringify(descriptor.canvasColor)};`);
    }
    lines.push('</script>');
    return lines.join('\n');
}

export function buildWebInstantiationResult(descriptor, {
    packageSource = 'cdn',
    controlSnapshot = [],
    selectedControlKeys = null,
    snippetMode = 'compact',
} = {}) {
    const effectivePackageSource = packageSource === 'cdn' ? 'cdn' : 'local';
    const effectiveSnippetMode = normalizeSnippetMode(snippetMode);
    const normalizedSnapshot = normalizeControlSnapshot(controlSnapshot);
    const propertyPaths = listSelectedPropertyObjectPaths(normalizedSnapshot, {
        selectedControlKeys,
        snippetMode: effectiveSnippetMode,
    });
    const hasControlBindings = effectiveSnippetMode === 'scaffold'
        ? normalizedSnapshot.length > 0
        : propertyPaths.length > 0;
    return {
        code: generateWebInstantiationCode(descriptor, {
            packageSource: effectivePackageSource,
            controlSnapshot,
            selectedControlKeys,
            snippetMode: effectiveSnippetMode,
        }),
        examples: buildPropertyUsageExamples(controlSnapshot, {
            selectedControlKeys,
            snippetMode: effectiveSnippetMode,
        }),
        fileName: descriptor.fileName,
        helperApi: null,
        propertyObject: hasControlBindings
            ? {
                global: 'window.riveProperties',
                note: 'Each key is a selected property path and each value is its direct Rive runtime accessor.',
                paths: propertyPaths,
            }
            : null,
        packageSource: effectivePackageSource,
        snippetMode: effectiveSnippetMode,
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
            effectiveSnippetMode === 'scaffold'
                ? 'Scaffold mode lists every discovered accessor and comments out anything that is not explicitly selected.'
                : 'Compact mode includes only the selected property accessors.',
            descriptor.canvasSizing?.mode === 'fixed'
                ? `The exported canvas is pinned to ${descriptor.canvasSizing.width} × ${descriptor.canvasSizing.height}px.`
                : 'The exported canvas follows the size of its host element.',
            hasControlBindings
                ? 'Selected controls are exposed as direct typed accessors on window.riveProperties; the snippet does not embed the standalone viewer runtime or UI chrome.'
                : 'No controls were selected, so the snippet stays limited to animation initialization.',
            'Standalone HTML export is a separate self-contained viewer with the runtime, UI chrome, control panel, and selected-value restoration included.',
            descriptor.runtimeName === 'canvas'
                ? 'Canvas runtime is supported, but WebGL2 is recommended for feathering and other advanced visual effects.'
                : 'WebGL2 is the preferred runtime when you need full visual fidelity, including feathering and advanced effects.',
        ],
    };
}
