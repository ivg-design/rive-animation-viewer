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
    lines.push('  ravRive.applySnapshot();');
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

function normalizeControlSnapshot(controlSnapshot = []) {
    if (!Array.isArray(controlSnapshot)) {
        return [];
    }
    return controlSnapshot
        .filter((entry) => entry && entry.descriptor && entry.kind !== 'trigger')
        .map((entry) => ({
            descriptor: {
                kind: entry.descriptor.kind,
                name: entry.descriptor.name,
                path: entry.descriptor.path,
                source: entry.descriptor.source,
                stateMachineName: entry.descriptor.stateMachineName,
            },
            kind: entry.kind,
            value: entry.value,
        }));
}

function buildControlHelperLines(controlSnapshot = []) {
    const normalizedSnapshot = normalizeControlSnapshot(controlSnapshot);
    const snapshotLiteral = JSON.stringify(normalizedSnapshot, null, 2)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');

    return [
        `  const initialControlSnapshot = ${snapshotLiteral};`,
        '',
        '  function safeRavVmCall(target, methodName, ...args) {',
        '    if (!target || typeof target[methodName] !== "function") return null;',
        '    try {',
        '      return target[methodName](...args) || null;',
        '    } catch {',
        '      return null;',
        '    }',
        '  }',
        '',
        '  function getRavVmRoot(instance = riveInst) {',
        '    if (!instance) return null;',
        '    if (instance.viewModelInstance) return instance.viewModelInstance;',
        '    try {',
        '      const defaultViewModel = typeof instance.defaultViewModel === "function"',
        '        ? instance.defaultViewModel()',
        '        : null;',
        '      if (!defaultViewModel) return null;',
        '      if (typeof defaultViewModel.defaultInstance === "function") {',
        '        return defaultViewModel.defaultInstance();',
        '      }',
        '      if (typeof defaultViewModel.instance === "function") {',
        '        return defaultViewModel.instance();',
        '      }',
        '    } catch {',
        '      return null;',
        '    }',
        '    return null;',
        '  }',
        '',
        '  function getRavVmAccessor(path, expectedKind, instance = riveInst) {',
        '    const rootVm = getRavVmRoot(instance);',
        '    if (!rootVm || typeof path !== "string" || !path) return null;',
        '    const segments = path.includes("/") ? path.split("/") : [path];',
        '    const propertyName = segments.pop();',
        '    let current = rootVm;',
        '    let index = 0;',
        '',
        '    while (index < segments.length && current) {',
        '      const segment = segments[index];',
        '      const directChild = safeRavVmCall(current, "viewModel", segment)',
        '        || safeRavVmCall(current, "viewModelInstance", segment);',
        '      if (directChild) {',
        '        current = directChild;',
        '        index += 1;',
        '        continue;',
        '      }',
        '',
        '      if (index + 1 < segments.length) {',
        '        const listAccessor = safeRavVmCall(current, "list", segment);',
        '        const listIndex = Number.parseInt(segments[index + 1], 10);',
        '        if (listAccessor && Number.isFinite(listIndex) && typeof listAccessor.instanceAt === "function") {',
        '          try {',
        '            const nextItem = listAccessor.instanceAt(listIndex);',
        '            if (nextItem) {',
        '              current = nextItem;',
        '              index += 2;',
        '              continue;',
        '            }',
        '          } catch {',
        '            return null;',
        '          }',
        '        }',
        '      }',
        '',
        '      return null;',
        '    }',
        '',
        '    if (!current || !propertyName) return null;',
        '    const probes = [',
        '      ["number", "number"],',
        '      ["boolean", "boolean"],',
        '      ["string", "string"],',
        '      ["enum", "enum"],',
        '      ["color", "color"],',
        '      ["trigger", "trigger"],',
        '    ];',
        '    for (const [kind, methodName] of probes) {',
        '      const accessor = safeRavVmCall(current, methodName, propertyName);',
        '      if (accessor && (!expectedKind || expectedKind === kind)) {',
        '        return accessor;',
        '      }',
        '    }',
        '    return null;',
        '  }',
        '',
        '  function getRavStateMachineInput(stateMachineName, inputName, instance = riveInst) {',
        '    if (!instance || typeof instance.stateMachineInputs !== "function" || !stateMachineName || !inputName) {',
        '      return null;',
        '    }',
        '    try {',
        '      const inputs = instance.stateMachineInputs(stateMachineName);',
        '      if (!Array.isArray(inputs)) return null;',
        '      return inputs.find((candidate) => candidate && candidate.name === inputName) || null;',
        '    } catch {',
        '      return null;',
        '    }',
        '  }',
        '',
        '  function setRavVmValue(path, value, expectedKind, instance = riveInst) {',
        '    const accessor = getRavVmAccessor(path, expectedKind, instance);',
        '    if (!accessor || !("value" in accessor)) return false;',
        '    accessor.value = value;',
        '    return true;',
        '  }',
        '',
        '  function fireRavVmTrigger(path, instance = riveInst) {',
        '    const accessor = getRavVmAccessor(path, "trigger", instance);',
        '    if (accessor && typeof accessor.trigger === "function") {',
        '      accessor.trigger();',
        '      return true;',
        '    }',
        '    if (accessor && typeof accessor.fire === "function") {',
        '      accessor.fire();',
        '      return true;',
        '    }',
        '    return false;',
        '  }',
        '',
        '  function setRavStateMachineInput(stateMachineName, inputName, value, instance = riveInst) {',
        '    const input = getRavStateMachineInput(stateMachineName, inputName, instance);',
        '    if (!input || typeof input.fire === "function" || !("value" in input)) return false;',
        '    input.value = value;',
        '    return true;',
        '  }',
        '',
        '  function fireRavStateMachineInput(stateMachineName, inputName, instance = riveInst) {',
        '    const input = getRavStateMachineInput(stateMachineName, inputName, instance);',
        '    if (!input || typeof input.fire !== "function") return false;',
        '    input.fire();',
        '    return true;',
        '  }',
        '',
        '  function applyRavControlSnapshot(instance = riveInst, snapshot = initialControlSnapshot) {',
        '    if (!instance || !Array.isArray(snapshot) || snapshot.length === 0) return 0;',
        '    let applied = 0;',
        '    snapshot.forEach((entry) => {',
        '      const descriptor = entry?.descriptor || {};',
        '      const kind = entry?.kind || descriptor.kind;',
        '      if (descriptor.source === "state-machine") {',
        '        const didApply = kind === "trigger"',
        '          ? fireRavStateMachineInput(descriptor.stateMachineName, descriptor.name, instance)',
        '          : setRavStateMachineInput(descriptor.stateMachineName, descriptor.name, entry.value, instance);',
        '        if (didApply) applied += 1;',
        '        return;',
        '      }',
        '',
        '      const didApply = kind === "trigger"',
        '        ? fireRavVmTrigger(descriptor.path, instance)',
        '        : setRavVmValue(descriptor.path, entry.value, kind, instance);',
        '      if (didApply) applied += 1;',
        '    });',
        '    return applied;',
        '  }',
        '',
        '  function createRavWebController(getInstance) {',
        '    return {',
        '      get instance() {',
        '        return getInstance();',
        '      },',
        '      applySnapshot() {',
        '        return applyRavControlSnapshot(getInstance());',
        '      },',
        '      fireStateMachineInput(stateMachineName, inputName) {',
        '        return fireRavStateMachineInput(stateMachineName, inputName, getInstance());',
        '      },',
        '      fireVmTrigger(path) {',
        '        return fireRavVmTrigger(path, getInstance());',
        '      },',
        '      getStateMachineInput(stateMachineName, inputName) {',
        '        return getRavStateMachineInput(stateMachineName, inputName, getInstance());',
        '      },',
        '      getVmRoot() {',
        '        return getRavVmRoot(getInstance());',
        '      },',
        '      resolveVmAccessor(path, expectedKind) {',
        '        return getRavVmAccessor(path, expectedKind, getInstance());',
        '      },',
        '      setStateMachineInput(stateMachineName, inputName, value) {',
        '        return setRavStateMachineInput(stateMachineName, inputName, value, getInstance());',
        '      },',
        '      setVmValue(path, value, expectedKind) {',
        '        return setRavVmValue(path, value, expectedKind, getInstance());',
        '      },',
        '    };',
        '  }',
        '',
        '  const ravRive = createRavWebController(() => riveInst);',
    ];
}

function buildControlUsageExamples(controlSnapshot = []) {
    const normalizedSnapshot = normalizeControlSnapshot(controlSnapshot);
    const examples = [];
    const seen = new Set();

    normalizedSnapshot.forEach((entry) => {
        if (!entry?.descriptor || examples.length >= 4) {
            return;
        }

        const descriptor = entry.descriptor;
        const valueLiteral = JSON.stringify(entry.value);

        if (descriptor.source === 'state-machine' && descriptor.stateMachineName && descriptor.name) {
            const example = `window.ravRive.setStateMachineInput(${JSON.stringify(descriptor.stateMachineName)}, ${JSON.stringify(descriptor.name)}, ${valueLiteral});`;
            if (!seen.has(example)) {
                seen.add(example);
                examples.push(example);
            }
            return;
        }

        if (descriptor.path) {
            const example = `window.ravRive.setVmValue(${JSON.stringify(descriptor.path)}, ${valueLiteral}, ${JSON.stringify(entry.kind)});`;
            if (!seen.has(example)) {
                seen.add(example);
                examples.push(example);
            }
        }
    });

    return examples;
}

export function generateWebInstantiationCode(descriptor, { packageSource = 'cdn', controlSnapshot = [] } = {}) {
    const effectivePackageSource = packageSource === 'cdn' ? 'cdn' : 'local';
    const runtimeBlock = buildRuntimeBlock(descriptor, { packageSource: effectivePackageSource });
    const lines = [
        '<canvas id="rive-canvas"></canvas>',
        ...(effectivePackageSource === 'local' ? ['<script type="module">'] : []),
        ...runtimeBlock,
    ];

    buildControlHelperLines(controlSnapshot).forEach((line) => {
        lines.push(line);
    });

    lines.push('  window.ravRive = ravRive;');

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
    lines.push('  window.riveInst = riveInst;');
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

export function buildWebInstantiationResult(descriptor, { packageSource = 'cdn', controlSnapshot = [] } = {}) {
    const effectivePackageSource = packageSource === 'cdn' ? 'cdn' : 'local';
    const examples = buildControlUsageExamples(controlSnapshot);
    return {
        code: generateWebInstantiationCode(descriptor, {
            packageSource: effectivePackageSource,
            controlSnapshot,
        }),
        examples,
        fileName: descriptor.fileName,
        helperApi: {
            global: 'window.ravRive',
            methods: [
                'window.ravRive.instance',
                'window.ravRive.applySnapshot()',
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
            normalizeControlSnapshot(controlSnapshot).length > 0
                ? 'The snippet restores the current ViewModel/state-machine values on load and exposes helper methods on window.ravRive.'
                : 'The snippet exposes helper methods on window.ravRive for ViewModel and state-machine control.',
        ],
    };
}
