import { CONTROL_HELPER_RUNTIME_LINES } from '../../snippets/web-instantiation/control-helper-runtime.js';
import {
    formatArgbHex,
    formatSectionLabel,
    isSelectedEntry,
    normalizeControlSnapshot,
    normalizeSelectedControlKeySet,
    normalizeSnippetMode,
    roundSnippetNumber,
} from './control-snapshot.js';

function maybeCommentLine(line, enabled) {
    return enabled ? line : `// ${line}`;
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
        return entry.enumValues.length ? `enum: ${entry.enumValues.join(' | ')}` : 'enum';
    }
    if (entry.kind === 'color') return 'color (ARGB hex)';
    if (entry.kind === 'trigger') return 'trigger';
    return entry.kind;
}

function buildVmOverrideObjectLines(controlSnapshot = [], { activeKeys = null, snippetMode = 'compact' } = {}) {
    const vmEntries = normalizeControlSnapshot(controlSnapshot).filter(
        (entry) => entry.descriptor.source !== 'state-machine' && entry.kind !== 'trigger' && entry.descriptor.path,
    );
    if (!vmEntries.length) {
        return ['  // Add any ViewModel overrides here.', '  // Example: "card-vm/title": "Revenue",'];
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
            if (index > 0) lines.push('');
            lines.push(`  // ${formatSectionLabel(root)}`);
            lastRoot = root;
            lastPrefix = root;
        }
        if (prefix && prefix !== root && prefix !== lastPrefix) {
            lines.push(`  // ${formatSectionLabel(prefix)}`);
            lastPrefix = prefix;
        }
        const line = `  ${JSON.stringify(path)}: ${formatControlValueLiteral(entry)}, // ${formatControlComment(entry)}`;
        lines.push(maybeCommentLine(line, snippetMode !== 'scaffold' || isSelectedEntry(entry, activeKeys)));
    });
    return lines;
}

function buildStateMachineOverrideObjectLines(controlSnapshot = [], { activeKeys = null, snippetMode = 'compact' } = {}) {
    const stateMachineEntries = normalizeControlSnapshot(controlSnapshot).filter(
        (entry) => entry.descriptor.source === 'state-machine' && entry.kind !== 'trigger',
    );
    if (!stateMachineEntries.length) {
        return ['  // Add state machine input overrides here.', '  // Example: "main-sm": { "progress": 0.5 },'];
    }

    const groups = new Map();
    stateMachineEntries.forEach((entry) => {
        const name = entry.descriptor.stateMachineName || 'default';
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(entry);
    });

    const lines = [];
    Array.from(groups.keys()).sort().forEach((stateMachineName, index) => {
        if (index > 0) lines.push('');
        const entries = groups.get(stateMachineName);
        const hasSelectedEntries = snippetMode !== 'scaffold' || entries.some((entry) => isSelectedEntry(entry, activeKeys));
        lines.push(maybeCommentLine(`  ${JSON.stringify(stateMachineName)}: {`, hasSelectedEntries));
        entries.forEach((entry) => {
            const line = `    ${JSON.stringify(entry.descriptor.name)}: ${formatControlValueLiteral(entry)}, // ${formatControlComment(entry)}`;
            const enabled = snippetMode !== 'scaffold' ? true : (hasSelectedEntries && isSelectedEntry(entry, activeKeys));
            lines.push(maybeCommentLine(line, enabled));
        });
        lines.push(maybeCommentLine('  },', hasSelectedEntries));
    });
    return lines;
}

function buildVmTriggerLines(controlSnapshot = [], { activeKeys = null, snippetMode = 'compact' } = {}) {
    const triggerEntries = normalizeControlSnapshot(controlSnapshot).filter(
        (entry) => entry.descriptor.source !== 'state-machine' && entry.kind === 'trigger' && entry.descriptor.path,
    );
    if (!triggerEntries.length) {
        return ['  // Add any VM triggers you want to fire on load.', '  // "card-vm/refresh",'];
    }

    const lines = [];
    let lastRoot = null;
    triggerEntries.forEach((entry, index) => {
        const root = entry.descriptor.path.split('/')[0] || entry.descriptor.path;
        if (root !== lastRoot) {
            if (index > 0) lines.push('');
            lines.push(`  // ${formatSectionLabel(root)}`);
            lastRoot = root;
        }
        lines.push(maybeCommentLine(`  ${JSON.stringify(entry.descriptor.path)}, // trigger`, snippetMode !== 'scaffold' || isSelectedEntry(entry, activeKeys)));
    });
    return lines;
}

function buildStateMachineTriggerLines(controlSnapshot = [], { activeKeys = null, snippetMode = 'compact' } = {}) {
    const triggerEntries = normalizeControlSnapshot(controlSnapshot).filter(
        (entry) => entry.descriptor.source === 'state-machine' && entry.kind === 'trigger',
    );
    if (!triggerEntries.length) {
        return ['  // Add any state machine triggers you want to fire on load.', '  // { stateMachine: "main-sm", input: "pulse" },'];
    }
    return triggerEntries.map((entry) =>
        maybeCommentLine(
            `  { stateMachine: ${JSON.stringify(entry.descriptor.stateMachineName || 'default')}, input: ${JSON.stringify(entry.descriptor.name)} }, // trigger`,
            snippetMode !== 'scaffold' || isSelectedEntry(entry, activeKeys),
        ));
}

export function buildControlHelperLines(controlSnapshot = [], { selectedControlKeys = [], snippetMode = 'compact' } = {}) {
    const effectiveSnippetMode = normalizeSnippetMode(snippetMode);
    const activeKeys = normalizeSelectedControlKeySet(selectedControlKeys);
    return [
        '  // =============================================================================',
        '  // CONTROL OVERRIDES',
        '  // - VM_OVERRIDES applies ViewModel values on load.',
        '  // - STATE_MACHINE_OVERRIDES applies state machine input values on load.',
        '  // - VM_TRIGGER_PATHS / STATE_MACHINE_TRIGGER_INPUTS keep trigger targets handy.',
        '  // - Triggers are NOT auto-fired on load. Call ravRive.fireConfiguredTriggers()',
        '  //   or the specific fire helpers when you want them.',
        effectiveSnippetMode === 'scaffold'
            ? '  // - Scaffold mode lists every discovered control; unselected lines stay commented out.'
            : '  // - Compact mode includes only the currently selected live controls.',
        '  // =============================================================================',
        '  const VM_OVERRIDES = {',
        ...buildVmOverrideObjectLines(controlSnapshot, { activeKeys, snippetMode: effectiveSnippetMode }),
        '  };',
        '',
        '  const STATE_MACHINE_OVERRIDES = {',
        ...buildStateMachineOverrideObjectLines(controlSnapshot, { activeKeys, snippetMode: effectiveSnippetMode }),
        '  };',
        '',
        '  const VM_TRIGGER_PATHS = [',
        ...buildVmTriggerLines(controlSnapshot, { activeKeys, snippetMode: effectiveSnippetMode }),
        '  ];',
        '',
        '  const STATE_MACHINE_TRIGGER_INPUTS = [',
        ...buildStateMachineTriggerLines(controlSnapshot, { activeKeys, snippetMode: effectiveSnippetMode }),
        '  ];',
        '',
        ...CONTROL_HELPER_RUNTIME_LINES,
    ];
}

export function buildControlUsageExamples(controlSnapshot = []) {
    const normalizedSnapshot = normalizeControlSnapshot(controlSnapshot);
    const examples = [];
    const seen = new Set();

    normalizedSnapshot.forEach((entry) => {
        if (!entry?.descriptor || examples.length >= 6) return;

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
