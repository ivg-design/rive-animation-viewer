import { buildControlHelperLines, buildControlUsageExamples } from './export/control-blocks.js';
import {
    buildEffectiveInstantiationDescriptor,
    normalizeAnimationSelection,
    resolveLivePlaybackSelection,
} from './export/descriptor.js';
import {
    normalizeControlSnapshot,
    normalizeSnippetMode,
} from './export/control-snapshot.js';

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
    if (useUserConfig) lines.push('  ...(userConfig.layout || {}),');
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
    lines.push('  ravRive.applySnapshot();');
    if (useUserConfig) lines.push('  userConfig.onLoad?.(...args);');
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

export { buildEffectiveInstantiationDescriptor, normalizeAnimationSelection, resolveLivePlaybackSelection };

export function generateWebInstantiationCode(descriptor, {
    packageSource = 'cdn',
    controlSnapshot = [],
    selectedControlKeys = [],
    snippetMode = 'compact',
} = {}) {
    const effectivePackageSource = packageSource === 'cdn' ? 'cdn' : 'local';
    const runtimeBlock = buildRuntimeBlock(descriptor, { packageSource: effectivePackageSource });
    const lines = [
        '<canvas id="rive-canvas"></canvas>',
        ...(effectivePackageSource === 'local' ? ['<script type="module">'] : []),
        ...runtimeBlock,
        ...buildControlHelperLines(controlSnapshot, { selectedControlKeys, snippetMode }),
        '  window.ravRive = ravRive;',
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
        .forEach((line) => lines.push(`    ${line}`));
    lines.push('  });');
    lines.push('');
    lines.push('  window.riveInst = riveInst;');
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
    selectedControlKeys = [],
    snippetMode = 'compact',
} = {}) {
    const effectivePackageSource = packageSource === 'cdn' ? 'cdn' : 'local';
    const effectiveSnippetMode = normalizeSnippetMode(snippetMode);
    return {
        code: generateWebInstantiationCode(descriptor, {
            packageSource: effectivePackageSource,
            controlSnapshot,
            selectedControlKeys,
            snippetMode: effectiveSnippetMode,
        }),
        examples: buildControlUsageExamples(controlSnapshot),
        fileName: descriptor.fileName,
        helperApi: {
            global: 'window.ravRive',
            methods: [
                'window.ravRive.instance',
                'window.ravRive.applySnapshot()',
                'window.ravRive.applyVmOverrides()',
                'window.ravRive.applyStateMachineOverrides()',
                'window.ravRive.fireConfiguredTriggers()',
                'window.ravRive.getVmRoot()',
                'window.ravRive.resolveVmAccessor(path, expectedKind?)',
                'window.ravRive.setVmValue(path, value, expectedKind?)',
                'window.ravRive.fireVmTrigger(path)',
                'window.ravRive.getStateMachineInput(stateMachineName, inputName)',
                'window.ravRive.setStateMachineInput(stateMachineName, inputName, value)',
                'window.ravRive.fireStateMachineInput(stateMachineName, inputName)',
            ],
        },
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
                ? 'Scaffold mode includes every discovered bound control and comments out anything that is not explicitly selected.'
                : 'Compact mode includes only the selected live controls.',
            normalizeControlSnapshot(controlSnapshot).length > 0
                ? 'The snippet organizes the selected controls into readable VM/state-machine override blocks, including enum option comments and explicit trigger helper sections.'
                : 'The snippet exposes helper methods on window.ravRive for ViewModel and state-machine control.',
        ],
    };
}
