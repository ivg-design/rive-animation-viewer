import {
    isSelectedEntry,
    normalizeControlSnapshot,
    normalizeSelectedControlKeySet,
    normalizeSnippetMode,
    roundSnippetNumber,
} from './control-snapshot.js';

const VIEW_MODEL_ACCESSOR_METHODS = new Set([
    'boolean',
    'color',
    'enum',
    'image',
    'number',
    'string',
    'trigger',
]);

function maybeCommentLine(line, enabled) {
    return enabled ? line : `// ${line}`;
}

function propertyKind(entry) {
    return String(entry?.kind || entry?.descriptor?.kind || '').trim();
}

export function buildRivePropertyObjectPath(entry) {
    const descriptor = entry?.descriptor;
    if (!descriptor) return null;

    if (descriptor.source === 'state-machine') {
        const stateMachineName = String(descriptor.stateMachineName || 'default').trim();
        const inputName = String(descriptor.name || '').trim();
        return inputName ? `stateMachine/${stateMachineName}/${inputName}` : null;
    }

    if (descriptor.source === 'global-view-model') {
        const globalName = String(descriptor.globalViewModelName || '').trim();
        const path = String(descriptor.path || '').trim();
        return globalName && path ? `globalViewModel/${globalName}/${path}` : null;
    }

    const path = String(descriptor.path || '').trim();
    return path ? `viewModel/${path}` : null;
}

function buildRivePropertyAccessorExpression(entry) {
    const descriptor = entry?.descriptor;
    const kind = propertyKind(entry);
    if (!descriptor || !VIEW_MODEL_ACCESSOR_METHODS.has(kind)) return 'null';

    if (descriptor.source === 'state-machine') {
        const stateMachineName = descriptor.stateMachineName || 'default';
        return `riveInst.stateMachineInputs?.(${JSON.stringify(stateMachineName)})?.find((input) => input.name === ${JSON.stringify(descriptor.name)}) ?? null`;
    }

    if (descriptor.source === 'global-view-model') {
        return `riveInst.globalViewModelInstance?.(${JSON.stringify(descriptor.globalViewModelName)})?.${kind}?.(${JSON.stringify(descriptor.path)}) ?? null`;
    }

    return `riveInst.viewModelInstance?.${kind}?.(${JSON.stringify(descriptor.path)}) ?? null`;
}

function selectedEntries(controlSnapshot, { selectedControlKeys = null, snippetMode = 'compact' } = {}) {
    const effectiveSnippetMode = normalizeSnippetMode(snippetMode);
    const activeKeys = normalizeSelectedControlKeySet(selectedControlKeys);
    const hasExplicitSelection = activeKeys instanceof Set;
    return normalizeControlSnapshot(controlSnapshot).map((entry) => ({
        enabled: effectiveSnippetMode === 'scaffold'
            ? isSelectedEntry(entry, activeKeys)
            : !hasExplicitSelection || isSelectedEntry(entry, activeKeys),
        entry,
        path: buildRivePropertyObjectPath(entry),
    })).filter(({ enabled, path }) => Boolean(path) && (effectiveSnippetMode === 'scaffold' || enabled));
}

export function buildSelectedPropertyObjectLines(controlSnapshot = [], options = {}) {
    const entries = selectedEntries(controlSnapshot, options);
    if (!entries.length) return [];

    return [
        '  Object.assign(riveProperties, {',
        ...entries.map(({ enabled, entry, path }) => maybeCommentLine(
            `    ${JSON.stringify(path)}: ${buildRivePropertyAccessorExpression(entry)},`,
            enabled,
        )),
        '  });',
    ];
}

export function listSelectedPropertyObjectPaths(controlSnapshot = [], options = {}) {
    return selectedEntries(controlSnapshot, options)
        .filter(({ enabled }) => enabled)
        .map(({ path }) => path);
}

function formatUsageValue(entry) {
    const kind = propertyKind(entry);
    if (kind === 'number') return String(roundSnippetNumber(entry.value));
    if (kind === 'color') {
        const color = Number.isFinite(Number(entry.value)) ? Number(entry.value) >>> 0 : 0xff000000;
        return `0x${color.toString(16).padStart(8, '0').toUpperCase()}`;
    }
    return JSON.stringify(entry.value);
}

export function buildPropertyUsageExamples(controlSnapshot = [], options = {}) {
    const examples = [];
    const seen = new Set();

    selectedEntries(controlSnapshot, options).forEach(({ enabled, entry, path }) => {
        if (!enabled || examples.length >= 6 || seen.has(path)) return;
        seen.add(path);

        const kind = propertyKind(entry);
        if (kind === 'trigger') {
            const method = entry.descriptor.source === 'state-machine' ? 'fire' : 'trigger';
            examples.push(`window.riveProperties[${JSON.stringify(path)}]?.${method}();`);
            return;
        }
        if (kind === 'image') {
            examples.push(`const imageProperty = window.riveProperties[${JSON.stringify(path)}];`);
            return;
        }
        examples.push(`window.riveProperties[${JSON.stringify(path)}].value = ${formatUsageValue(entry)};`);
    });

    return examples;
}
