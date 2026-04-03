import { controlSnapshotKeyForDescriptor } from '../../rive/vm-controls.js';

export function normalizeControlSnapshot(controlSnapshot = []) {
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
                ? entry.enumValues.map((value) => String(value ?? '').trim()).filter(Boolean)
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

export function formatArgbHex(value) {
    const rawValue = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
    return `#${rawValue.toString(16).padStart(8, '0').toUpperCase()}`;
}

export function roundSnippetNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (Number.isInteger(numeric)) return numeric;
    return Number(numeric.toFixed(2));
}

export function formatSectionLabel(path = '') {
    return String(path || '')
        .split('/')
        .filter((segment) => segment && segment.trim().length > 0)
        .map((segment) => segment.trim().toUpperCase())
        .join(' / ');
}

export function normalizeSnippetMode(value) {
    return value === 'scaffold' ? 'scaffold' : 'compact';
}

export function normalizeSelectedControlKeySet(selectedControlKeys = []) {
    if (!Array.isArray(selectedControlKeys)) {
        return null;
    }
    return new Set(
        selectedControlKeys
            .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            .map((entry) => entry.trim()),
    );
}

export function isSelectedEntry(entry, activeKeys) {
    if (!(activeKeys instanceof Set)) {
        return true;
    }
    const key = controlSnapshotKeyForDescriptor(entry?.descriptor);
    return Boolean(key) && activeKeys.has(key);
}
