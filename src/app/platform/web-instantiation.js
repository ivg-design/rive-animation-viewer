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
        .filter((entry) => entry && entry.descriptor)
        .map((entry) => ({
            descriptor: {
                kind: entry.descriptor.kind,
                name: entry.descriptor.name,
                path: entry.descriptor.path,
                source: entry.descriptor.source,
                stateMachineName: entry.descriptor.stateMachineName,
            },
            enumValues: Array.isArray(entry.enumValues)
                ? entry.enumValues
                    .map((value) => String(value ?? '').trim())
                    .filter((value) => value.length > 0)
                : [],
            kind: entry.kind || entry.descriptor.kind,
            value: (entry.kind || entry.descriptor.kind) === 'trigger' ? null : entry.value,
        }))
        .sort((left, right) => {
            const leftSortKey = left.descriptor.source === 'state-machine'
                ? `sm:${left.descriptor.stateMachineName || ''}/${left.descriptor.name || ''}`
                : `vm:${left.descriptor.path || ''}`;
            const rightSortKey = right.descriptor.source === 'state-machine'
                ? `sm:${right.descriptor.stateMachineName || ''}/${right.descriptor.name || ''}`
                : `vm:${right.descriptor.path || ''}`;
            return leftSortKey.localeCompare(rightSortKey);
        });
}

function formatArgbHex(value) {
    const rawValue = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
    return `#${rawValue.toString(16).padStart(8, '0').toUpperCase()}`;
}

function roundSnippetNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    if (Number.isInteger(numeric)) {
        return numeric;
    }
    return Number(numeric.toFixed(2));
}

function formatSectionLabel(path = '') {
    return String(path || '')
        .split('/')
        .filter((segment) => segment && segment.trim().length > 0)
        .map((segment) => segment.trim().toUpperCase())
        .join(' / ');
}

function formatControlValueLiteral(entry) {
    if (entry.kind === 'color') {
        return JSON.stringify(formatArgbHex(entry.value));
    }
    if (entry.kind === 'number') {
        return String(roundSnippetNumber(entry.value));
    }
    return JSON.stringify(entry.value);
}

function formatControlComment(entry) {
    if (entry.kind === 'enum') {
        return entry.enumValues.length
            ? `enum: ${entry.enumValues.join(' | ')}`
            : 'enum';
    }
    if (entry.kind === 'color') {
        return 'color (ARGB hex)';
    }
    if (entry.kind === 'trigger') {
        return 'trigger';
    }
    return entry.kind;
}

function buildVmOverrideObjectLines(controlSnapshot = []) {
    const vmEntries = normalizeControlSnapshot(controlSnapshot).filter(
        (entry) => entry.descriptor.source !== 'state-machine' && entry.kind !== 'trigger' && entry.descriptor.path,
    );

    if (!vmEntries.length) {
        return [
            '  // Add any ViewModel overrides here.',
            '  // Example: "card-vm/title": "Revenue",',
        ];
    }

    const lines = [];
    let lastRoot = null;
    let lastPrefix = null;

    vmEntries.forEach((entry, index) => {
        const path = entry.descriptor.path;
        const segments = path.split('/');
        const root = segments[0] || path;
        const prefix = segments.slice(0, -1).join('/');

        if (root !== lastRoot) {
            if (index > 0) {
                lines.push('');
            }
            lines.push(`  // ${formatSectionLabel(root)}`);
            lastRoot = root;
            lastPrefix = root;
        }

        if (prefix && prefix !== root && prefix !== lastPrefix) {
            lines.push(`  // ${formatSectionLabel(prefix)}`);
            lastPrefix = prefix;
        }

        lines.push(`  ${JSON.stringify(path)}: ${formatControlValueLiteral(entry)}, // ${formatControlComment(entry)}`);
    });

    return lines;
}

function buildStateMachineOverrideObjectLines(controlSnapshot = []) {
    const stateMachineEntries = normalizeControlSnapshot(controlSnapshot).filter(
        (entry) => entry.descriptor.source === 'state-machine' && entry.kind !== 'trigger',
    );

    if (!stateMachineEntries.length) {
        return [
            '  // Add state machine input overrides here.',
            '  // Example: "main-sm": { "progress": 0.5 },',
        ];
    }

    const groups = new Map();
    stateMachineEntries.forEach((entry) => {
        const name = entry.descriptor.stateMachineName || 'default';
        if (!groups.has(name)) {
            groups.set(name, []);
        }
        groups.get(name).push(entry);
    });

    const lines = [];
    Array.from(groups.keys()).sort().forEach((stateMachineName, index) => {
        if (index > 0) {
            lines.push('');
        }
        lines.push(`  ${JSON.stringify(stateMachineName)}: {`);
        groups.get(stateMachineName).forEach((entry) => {
            lines.push(`    ${JSON.stringify(entry.descriptor.name)}: ${formatControlValueLiteral(entry)}, // ${formatControlComment(entry)}`);
        });
        lines.push('  },');
    });
    return lines;
}

function buildVmTriggerLines(controlSnapshot = []) {
    const triggerEntries = normalizeControlSnapshot(controlSnapshot).filter(
        (entry) => entry.descriptor.source !== 'state-machine' && entry.kind === 'trigger' && entry.descriptor.path,
    );

    if (!triggerEntries.length) {
        return [
            '  // Add any VM triggers you want to fire on load.',
            '  // "card-vm/refresh",',
        ];
    }

    const lines = [];
    let lastRoot = null;
    triggerEntries.forEach((entry, index) => {
        const root = entry.descriptor.path.split('/')[0] || entry.descriptor.path;
        if (root !== lastRoot) {
            if (index > 0) {
                lines.push('');
            }
            lines.push(`  // ${formatSectionLabel(root)}`);
            lastRoot = root;
        }
        lines.push(`  ${JSON.stringify(entry.descriptor.path)}, // trigger`);
    });
    return lines;
}

function buildStateMachineTriggerLines(controlSnapshot = []) {
    const triggerEntries = normalizeControlSnapshot(controlSnapshot).filter(
        (entry) => entry.descriptor.source === 'state-machine' && entry.kind === 'trigger',
    );

    if (!triggerEntries.length) {
        return [
            '  // Add any state machine triggers you want to fire on load.',
            '  // { stateMachine: "main-sm", input: "pulse" },',
        ];
    }

    return triggerEntries.map((entry) => (
        `  { stateMachine: ${JSON.stringify(entry.descriptor.stateMachineName || 'default')}, input: ${JSON.stringify(entry.descriptor.name)} }, // trigger`
    ));
}

function buildControlHelperLines(controlSnapshot = []) {
    return [
        '  // =============================================================================',
        '  // CONTROL OVERRIDES',
        '  // - VM_OVERRIDES applies ViewModel values on load.',
        '  // - STATE_MACHINE_OVERRIDES applies state machine input values on load.',
        '  // - *_STARTUP_TRIGGERS fire event-style triggers after the instance loads.',
        '  // =============================================================================',
        '  const VM_OVERRIDES = {',
        ...buildVmOverrideObjectLines(controlSnapshot),
        '  };',
        '',
        '  const STATE_MACHINE_OVERRIDES = {',
        ...buildStateMachineOverrideObjectLines(controlSnapshot),
        '  };',
        '',
        '  const VM_STARTUP_TRIGGERS = [',
        ...buildVmTriggerLines(controlSnapshot),
        '  ];',
        '',
        '  const STATE_MACHINE_STARTUP_TRIGGERS = [',
        ...buildStateMachineTriggerLines(controlSnapshot),
        '  ];',
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
        '  function parseRavArgbHex(value) {',
        '    const cleanValue = typeof value === "string" ? value.trim() : "";',
        '    const normalized = cleanValue.startsWith("#") ? cleanValue.slice(1) : cleanValue;',
        '    if (!/^[0-9a-fA-F]{8}$/.test(normalized)) return null;',
        '    return Number.parseInt(normalized, 16) >>> 0;',
        '  }',
        '',
        '  function setRavVmValue(path, value, expectedKind, instance = riveInst) {',
        '    const colorValue = typeof value === "number" && Number.isFinite(value)',
        '      ? value >>> 0',
        '      : parseRavArgbHex(value);',
        '    const probeKinds = expectedKind',
        '      ? [expectedKind]',
        '      : typeof value === "boolean"',
        '        ? ["boolean"]',
        '        : typeof value === "number"',
        '          ? ["number"]',
        '          : colorValue !== null',
        '            ? ["color"]',
        '            : ["enum", "string"];',
        '',
        '    for (const kind of probeKinds) {',
        '      const accessor = getRavVmAccessor(path, kind, instance);',
        '      if (!accessor || !("value" in accessor)) continue;',
        '      accessor.value = kind === "color" ? colorValue : value;',
        '      return true;',
        '    }',
        '    return false;',
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
        '  function applyRavVmOverrides(instance = riveInst, overrides = VM_OVERRIDES) {',
        '    if (!instance || !overrides || typeof overrides !== "object") return 0;',
        '    let applied = 0;',
        '    Object.entries(overrides).forEach(([path, value]) => {',
        '      if (setRavVmValue(path, value, undefined, instance)) applied += 1;',
        '    });',
        '    return applied;',
        '  }',
        '',
        '  function applyRavStateMachineOverrides(instance = riveInst, overrides = STATE_MACHINE_OVERRIDES) {',
        '    if (!instance || !overrides || typeof overrides !== "object") return 0;',
        '    let applied = 0;',
        '    Object.entries(overrides).forEach(([stateMachineName, inputs]) => {',
        '      if (!inputs || typeof inputs !== "object") return;',
        '      Object.entries(inputs).forEach(([inputName, value]) => {',
        '        if (setRavStateMachineInput(stateMachineName, inputName, value, instance)) applied += 1;',
        '      });',
        '    });',
        '    return applied;',
        '  }',
        '',
        '  function fireRavStartupTriggers(instance = riveInst, vmTriggers = VM_STARTUP_TRIGGERS, stateMachineTriggers = STATE_MACHINE_STARTUP_TRIGGERS) {',
        '    let fired = 0;',
        '    if (Array.isArray(vmTriggers)) {',
        '      vmTriggers.forEach((path) => {',
        '        if (fireRavVmTrigger(path, instance)) fired += 1;',
        '      });',
        '    }',
        '    if (Array.isArray(stateMachineTriggers)) {',
        '      stateMachineTriggers.forEach((entry) => {',
        '        if (fireRavStateMachineInput(entry?.stateMachine, entry?.input, instance)) fired += 1;',
        '      });',
        '    }',
        '    return fired;',
        '  }',
        '',
        '  function applyRavControlSnapshot(instance = riveInst) {',
        '    if (!instance) return 0;',
        '    let applied = 0;',
        '    applied += applyRavVmOverrides(instance);',
        '    applied += applyRavStateMachineOverrides(instance);',
        '    applied += fireRavStartupTriggers(instance);',
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
        '      applyStateMachineOverrides() {',
        '        return applyRavStateMachineOverrides(getInstance());',
        '      },',
        '      applyVmOverrides() {',
        '        return applyRavVmOverrides(getInstance());',
        '      },',
        '      fireStartupTriggers() {',
        '        return fireRavStartupTriggers(getInstance());',
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
        if (!entry?.descriptor || examples.length >= 6) {
            return;
        }

        const descriptor = entry.descriptor;
        const valueLiteral = entry.kind === 'color'
            ? JSON.stringify(formatArgbHex(entry.value))
            : JSON.stringify(entry.value);

        if (entry.kind === 'trigger') {
            if (descriptor.source === 'state-machine' && descriptor.stateMachineName && descriptor.name) {
                const example = `window.ravRive.fireStateMachineInput(${JSON.stringify(descriptor.stateMachineName)}, ${JSON.stringify(descriptor.name)});`;
                if (!seen.has(example)) {
                    seen.add(example);
                    examples.push(example);
                }
                return;
            }

            if (descriptor.path) {
                const example = `window.ravRive.fireVmTrigger(${JSON.stringify(descriptor.path)});`;
                if (!seen.has(example)) {
                    seen.add(example);
                    examples.push(example);
                }
            }
            return;
        }

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
                'window.ravRive.applyVmOverrides()',
                'window.ravRive.applyStateMachineOverrides()',
                'window.ravRive.fireStartupTriggers()',
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
                ? 'The snippet organizes the selected controls into readable VM/state-machine override blocks, including enum option comments and startup trigger sections.'
                : 'The snippet exposes helper methods on window.ravRive for ViewModel and state-machine control.',
        ],
    };
}
