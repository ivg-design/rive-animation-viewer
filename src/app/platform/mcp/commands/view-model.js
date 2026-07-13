import {
    getVmAccessor,
    getVmListItemAt,
    getVmListLength,
    safeVmMethodCall,
} from '../../../rive/view-model/accessors.js';

const VALUE_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color']);
const LIST_INDEX_PATTERN = /^(0|[1-9]\d*)$/;

function normalizeVmPath(path) {
    if (typeof path !== 'string' || !path.trim()) {
        throw new Error('path is required');
    }

    const trimmedPath = path.trim();
    const normalizedPath = trimmedPath.includes('/') ? trimmedPath : trimmedPath.replaceAll('.', '/');
    if (normalizedPath.split('/').some((segment) => !segment)) {
        throw new Error(`Invalid ViewModel path "${path}"`);
    }
    return normalizedPath;
}

function parseListIndex(segment, listName, path) {
    if (!LIST_INDEX_PATTERN.test(segment)) {
        throw new Error(`Invalid list index "${segment}" for "${listName}" in path "${path}"`);
    }

    const index = Number(segment);
    if (!Number.isSafeInteger(index)) {
        throw new Error(`Invalid list index "${segment}" for "${listName}" in path "${path}"`);
    }
    return index;
}

export function createViewModelCommands({
    buildViewModelSnapshot,
    windowRef = globalThis.window,
} = {}) {
    function getLiveRootVm() {
        const rootVm = windowRef?.riveInst?.viewModelInstance;
        if (!rootVm) {
            throw new Error('No ViewModel available');
        }
        return rootVm;
    }

    function resolveVmPath(path, allowedKinds) {
        const normalizedPath = normalizeVmPath(path);
        const parts = normalizedPath.split('/');
        const propertyName = parts.pop();
        let current = getLiveRootVm();
        let cursor = 0;

        while (cursor < parts.length) {
            const segment = parts[cursor];
            const nestedVm = safeVmMethodCall(current, 'viewModelInstance', segment)
                || safeVmMethodCall(current, 'viewModel', segment);
            if (nestedVm) {
                current = nestedVm;
                cursor += 1;
                continue;
            }

            const listAccessor = safeVmMethodCall(current, 'list', segment);
            if (!listAccessor) {
                throw new Error(`Cannot navigate to "${segment}" in path "${normalizedPath}"`);
            }

            const indexSegment = parts[cursor + 1];
            if (indexSegment === undefined) {
                throw new Error(`List "${segment}" in path "${normalizedPath}" must be followed by an index and property name`);
            }

            const listIndex = parseListIndex(indexSegment, segment, normalizedPath);
            const listLength = getVmListLength(listAccessor);
            if (listIndex >= listLength) {
                throw new Error(`List index ${listIndex} is out of bounds for "${segment}" (length ${listLength})`);
            }

            const itemInstance = getVmListItemAt(listAccessor, listIndex);
            if (!itemInstance) {
                throw new Error(`No ViewModel instance at "${segment}/${listIndex}" in path "${normalizedPath}"`);
            }

            current = itemInstance;
            cursor += 2;
        }

        const accessorInfo = getVmAccessor(current, propertyName);
        if (!accessorInfo || !allowedKinds.has(accessorInfo.kind)) {
            return null;
        }

        return {
            ...accessorInfo,
            path: normalizedPath,
            propertyName,
        };
    }

    return {
        async rav_get_vm_tree() {
            if (!windowRef?.riveInst) {
                throw new Error('No animation loaded');
            }
            const snapshot = buildViewModelSnapshot(windowRef);
            return {
                tree: snapshot.tree,
                paths: snapshot.paths,
                inputs: snapshot.inputs,
                ...(snapshot.message ? { message: snapshot.message } : {}),
            };
        },

        async rav_vm_get({ path } = {}) {
            const resolved = resolveVmPath(path, VALUE_KINDS);
            if (!resolved) {
                const normalizedPath = normalizeVmPath(path);
                throw new Error(`Property "${normalizedPath.split('/').pop()}" not found or not readable`);
            }
            return {
                path: resolved.path,
                kind: resolved.kind,
                value: resolved.accessor.value,
            };
        },

        async rav_vm_set({ path, value } = {}) {
            const normalizedPath = normalizeVmPath(path);
            if (value === undefined) {
                throw new Error('value is required');
            }
            const resolved = resolveVmPath(normalizedPath, VALUE_KINDS);
            if (!resolved) {
                throw new Error(`Property "${normalizedPath.split('/').pop()}" not found or not writable`);
            }

            resolved.accessor.value = value;
            let appliedValue = value;
            try {
                appliedValue = resolved.accessor.value;
            } catch {
                // Some runtime accessors are write-only; preserve the requested value in the response.
            }
            return {
                ok: true,
                path: resolved.path,
                kind: resolved.kind,
                value: appliedValue,
            };
        },

        async rav_vm_fire({ path } = {}) {
            const resolved = resolveVmPath(path, new Set(['trigger']));
            if (!resolved) {
                const normalizedPath = normalizeVmPath(path);
                throw new Error(`Trigger "${normalizedPath.split('/').pop()}" not found`);
            }

            if (typeof resolved.accessor.trigger === 'function') {
                resolved.accessor.trigger();
            } else if (typeof resolved.accessor.fire === 'function') {
                resolved.accessor.fire();
            } else {
                throw new Error(`Trigger "${resolved.path}" cannot be fired`);
            }
            return { ok: true, path: resolved.path, kind: resolved.kind };
        },
    };
}
