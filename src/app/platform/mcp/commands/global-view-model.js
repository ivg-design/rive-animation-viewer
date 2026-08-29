import { getVmAccessor, getVmListItemAt, getVmListLength, safeVmMethodCall } from '../../../rive/view-model/accessors.js';
import { dispatchVmControlMutation } from '../../../rive/control-events.js';
import {
    assertAuthoritativeRenderSurface,
    canonicalGlobalVmSnapshot,
    findCanonicalGlobalInput,
    requestAuthoritativeCommand,
    requestAuthoritativeImageCommand,
} from '../authoritative.js';
import { buildGlobalViewModelSnapshot } from '../view-model-snapshot.js';

const VALUE_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color']);
const LIST_INDEX_PATTERN = /^(0|[1-9]\d*)$/;
const SIGNED_INT32_MIN = -(2 ** 31);
const UINT32_MAX = 2 ** 32 - 1;
const MAX_MCP_IMAGE_BYTES = 16 * 1024 * 1024;

function normalizeName(name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('name is required');
    return name.trim();
}

function normalizePath(path) {
    if (typeof path !== 'string' || !path.trim()) throw new Error('path is required');
    const trimmed = path.trim();
    const normalized = trimmed.includes('/') ? trimmed : trimmed.replaceAll('.', '/');
    if (normalized.split('/').some((segment) => !segment)) throw new Error(`Invalid ViewModel path "${path}"`);
    return normalized;
}

function normalizeValue(value, kind) {
    if (kind !== 'color') return value;
    if (!Number.isInteger(value) || value < SIGNED_INT32_MIN || value > UINT32_MAX) {
        throw new Error('Color value must be an integer from -2147483648 through 4294967295');
    }
    return value < 0 ? value + 2 ** 32 : value;
}

function normalizeImageBytes(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MCP_IMAGE_BYTES) {
        throw new Error(`bytes must be a non-empty byte array no larger than ${MAX_MCP_IMAGE_BYTES} bytes`);
    }
    return value.map((byte) => {
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
            throw new Error('bytes must contain only integers from 0 through 255');
        }
        return byte;
    });
}

function resolvePath(rootVm, path, allowedKinds) {
    const normalizedPath = normalizePath(path);
    const parts = normalizedPath.split('/');
    const propertyName = parts.pop();
    let current = rootVm;
    let cursor = 0;
    while (cursor < parts.length) {
        const segment = parts[cursor];
        const nested = safeVmMethodCall(current, 'viewModelInstance', segment)
            || safeVmMethodCall(current, 'viewModel', segment);
        if (nested) { current = nested; cursor += 1; continue; }
        const list = safeVmMethodCall(current, 'list', segment);
        if (!list) throw new Error(`Cannot navigate to "${segment}" in path "${normalizedPath}"`);
        const rawIndex = parts[cursor + 1];
        if (!LIST_INDEX_PATTERN.test(rawIndex || '')) {
            throw new Error(`Invalid list index "${rawIndex}" for "${segment}" in path "${normalizedPath}"`);
        }
        const index = Number(rawIndex);
        const length = getVmListLength(list);
        if (index >= length) throw new Error(`List index ${index} is out of bounds for "${segment}" (length ${length})`);
        current = getVmListItemAt(list, index);
        if (!current) throw new Error(`No ViewModel instance at "${segment}/${index}" in path "${normalizedPath}"`);
        cursor += 2;
    }
    const accessorInfo = getVmAccessor(current, propertyName);
    return accessorInfo && allowedKinds.has(accessorInfo.kind)
        ? { ...accessorInfo, path: normalizedPath, propertyName }
        : null;
}

export function createGlobalViewModelCommands({
    documentRef = globalThis.document,
    getRenderSurfaceController,
    renderSurfaceController,
    windowRef = globalThis.window,
} = {}) {
    const authoritative = () => assertAuthoritativeRenderSurface({
        getRenderSurfaceController, renderSurfaceController, windowRef,
    });
    const liveRoot = (name) => {
        const normalizedName = normalizeName(name);
        const inst = windowRef?.riveInst;
        if (!inst) throw new Error('No animation loaded');
        let names = [];
        try { names = inst.globalViewModelNames?.() || []; } catch { /* unavailable */ }
        if (!Array.isArray(names) || !names.includes(normalizedName)) throw new Error(`Global ViewModel "${normalizedName}" not found`);
        let root = null;
        try { root = inst.globalViewModelInstance?.(normalizedName) || null; } catch { /* unavailable */ }
        if (!root) throw new Error(`Global ViewModel "${normalizedName}" is unavailable`);
        return root;
    };
    const descriptor = (input, name, kind = input.kind) => ({
        kind,
        name: input.name || input.descriptor?.name,
        path: input.path || input.descriptor?.path,
        source: 'global-view-model',
        globalViewModelName: name,
    });

    return {
        async rav_get_global_vm_tree() {
            const adapter = authoritative();
            return adapter ? canonicalGlobalVmSnapshot(adapter.canonicalState) : buildGlobalViewModelSnapshot(windowRef);
        },
        async rav_global_vm_get({ name, path } = {}) {
            const globalViewModelName = normalizeName(name);
            const normalizedPath = normalizePath(path);
            const adapter = authoritative();
            const input = adapter
                ? findCanonicalGlobalInput(adapter.canonicalState, globalViewModelName, normalizedPath, (item) => VALUE_KINDS.has(item.kind))
                : resolvePath(liveRoot(globalViewModelName), normalizedPath, VALUE_KINDS);
            if (!input) throw new Error(`Property "${normalizedPath}" not found or not readable in global ViewModel "${globalViewModelName}"`);
            return {
                name: globalViewModelName,
                path: normalizedPath,
                kind: input.kind,
                value: adapter ? input.value : input.accessor.value,
            };
        },
        async rav_global_vm_set({ name, path, value } = {}) {
            const globalViewModelName = normalizeName(name);
            const normalizedPath = normalizePath(path);
            if (value === undefined) throw new Error('value is required');
            const adapter = authoritative();
            if (adapter) {
                const input = findCanonicalGlobalInput(adapter.canonicalState, globalViewModelName, normalizedPath, (item) => VALUE_KINDS.has(item.kind));
                if (!input) throw new Error(`Property "${normalizedPath}" not found or not writable in global ViewModel "${globalViewModelName}"`);
                const result = await requestAuthoritativeCommand(adapter, 'vm-set', {
                    descriptor: descriptor(input, globalViewModelName), value: normalizeValue(value, input.kind),
                });
                const canonical = findCanonicalGlobalInput(result.canonicalState, globalViewModelName, normalizedPath) || input;
                return { applied: result.applied, name: globalViewModelName, path: normalizedPath, kind: input.kind, status: result.status, value: canonical.value };
            }
            const resolved = resolvePath(liveRoot(globalViewModelName), normalizedPath, VALUE_KINDS);
            if (!resolved) throw new Error(`Property "${normalizedPath}" not found or not writable in global ViewModel "${globalViewModelName}"`);
            resolved.accessor.value = normalizeValue(value, resolved.kind);
            let appliedValue = value;
            try { appliedValue = resolved.accessor.value; } catch { /* write-only */ }
            const controlDescriptor = descriptor(resolved, globalViewModelName);
            dispatchVmControlMutation(documentRef, { descriptor: controlDescriptor, kind: resolved.kind, value: appliedValue });
            return { ok: true, name: globalViewModelName, path: normalizedPath, kind: resolved.kind, value: appliedValue };
        },
        async rav_global_vm_set_image({ name, path, bytes, label = 'MCP image' } = {}) {
            const globalViewModelName = normalizeName(name);
            const normalizedPath = normalizePath(path);
            const normalizedBytes = normalizeImageBytes(bytes);
            const adapter = authoritative();
            if (!adapter) throw new Error('Image mutation requires the authoritative playback surface');
            const input = findCanonicalGlobalInput(
                adapter.canonicalState, globalViewModelName, normalizedPath, (item) => item.kind === 'image',
            );
            if (!input) throw new Error(`Image property "${normalizedPath}" not found or not writable in global ViewModel "${globalViewModelName}"`);
            const safeLabel = typeof label === 'string' && label.trim() ? label.trim().slice(0, 255) : 'MCP image';
            const imageDescriptor = descriptor(input, globalViewModelName, 'image');
            const result = await requestAuthoritativeImageCommand(adapter, {
                ...imageDescriptor,
                action: 'set-image',
                descriptor: imageDescriptor,
                imageSelection: { kind: 'file', label: safeLabel },
                value: normalizedBytes,
            });
            const canonical = findCanonicalGlobalInput(result.canonicalState, globalViewModelName, normalizedPath) || input;
            return {
                applied: result.applied, name: globalViewModelName, path: normalizedPath,
                metadata: canonical.metadata || null, present: canonical.present === true, status: result.status,
            };
        },
        async rav_global_vm_clear_image({ name, path } = {}) {
            const globalViewModelName = normalizeName(name);
            const normalizedPath = normalizePath(path);
            const adapter = authoritative();
            if (!adapter) throw new Error('Image mutation requires the authoritative playback surface');
            const input = findCanonicalGlobalInput(
                adapter.canonicalState, globalViewModelName, normalizedPath, (item) => item.kind === 'image',
            );
            if (!input) throw new Error(`Image property "${normalizedPath}" not found or not writable in global ViewModel "${globalViewModelName}"`);
            const imageDescriptor = descriptor(input, globalViewModelName, 'image');
            const result = await requestAuthoritativeImageCommand(adapter, {
                ...imageDescriptor,
                action: 'clear-image',
                descriptor: imageDescriptor,
                imageSelection: null,
                value: null,
            });
            const canonical = findCanonicalGlobalInput(result.canonicalState, globalViewModelName, normalizedPath) || input;
            return {
                applied: result.applied, name: globalViewModelName, path: normalizedPath,
                metadata: canonical.metadata || null, present: canonical.present === true, status: result.status,
            };
        },
        async rav_global_vm_fire({ name, path } = {}) {
            const globalViewModelName = normalizeName(name);
            const normalizedPath = normalizePath(path);
            const adapter = authoritative();
            if (adapter) {
                const input = findCanonicalGlobalInput(adapter.canonicalState, globalViewModelName, normalizedPath, (item) => item.kind === 'trigger');
                if (!input) throw new Error(`Trigger "${normalizedPath}" not found in global ViewModel "${globalViewModelName}"`);
                const result = await requestAuthoritativeCommand(adapter, 'vm-fire', { descriptor: descriptor(input, globalViewModelName, 'trigger') });
                return { applied: result.applied, name: globalViewModelName, path: normalizedPath, kind: 'trigger', status: result.status };
            }
            const resolved = resolvePath(liveRoot(globalViewModelName), normalizedPath, new Set(['trigger']));
            if (!resolved) throw new Error(`Trigger "${normalizedPath}" not found in global ViewModel "${globalViewModelName}"`);
            if (typeof resolved.accessor.trigger === 'function') resolved.accessor.trigger();
            else if (typeof resolved.accessor.fire === 'function') resolved.accessor.fire();
            else throw new Error(`Trigger "${normalizedPath}" cannot be fired`);
            const controlDescriptor = descriptor(resolved, globalViewModelName, 'trigger');
            dispatchVmControlMutation(documentRef, { action: 'fire', descriptor: controlDescriptor, kind: 'trigger' });
            return { ok: true, name: globalViewModelName, path: normalizedPath, kind: 'trigger' };
        },
    };
}
