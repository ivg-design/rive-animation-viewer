import {
    getVmAccessor,
    getVmListItemAt,
    getVmListLength,
    safeVmMethodCall,
} from '../../../rive/view-model/accessors.js';
import { dispatchVmControlMutation } from '../../../rive/control-events.js';
import {
    assertAuthoritativeRenderSurface,
    canonicalVmSnapshot,
    findCanonicalInput,
    requestAuthoritativeCommand,
    requestAuthoritativeImageCommand,
} from '../authoritative.js';

const VALUE_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color']);
const LIST_INDEX_PATTERN = /^(0|[1-9]\d*)$/;
const SIGNED_INT32_MIN = -(2 ** 31);
const UINT32_MAX = 2 ** 32 - 1;
const MAX_MCP_IMAGE_BYTES = 16 * 1024 * 1024;

function normalizeVmValue(value, kind) {
    if (kind !== 'color') return value;
    if (!Number.isInteger(value) || value < SIGNED_INT32_MIN || value > UINT32_MAX) {
        throw new Error('Color value must be an integer from -2147483648 through 4294967295');
    }
    return value < 0 ? value + 2 ** 32 : value;
}

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
    documentRef = globalThis.document,
    getRenderSurfaceController,
    renderSurfaceController,
    windowRef = globalThis.window,
} = {}) {
    function getAuthoritative() {
        return assertAuthoritativeRenderSurface({ getRenderSurfaceController, renderSurfaceController, windowRef });
    }

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
            const authoritative = getAuthoritative();
            if (authoritative) {
                return canonicalVmSnapshot(authoritative.canonicalState);
            }
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
            const authoritative = getAuthoritative();
            const normalizedPath = normalizeVmPath(path);
            if (authoritative) {
                const input = findCanonicalInput(authoritative.canonicalState, normalizedPath, (candidate) => VALUE_KINDS.has(candidate.kind));
                if (!input) {
                    throw new Error(`Property "${normalizedPath.split('/').pop()}" not found or not readable`);
                }
                return { path: normalizedPath, kind: input.kind, value: input.value };
            }
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
            const authoritative = getAuthoritative();
            if (authoritative) {
                const input = findCanonicalInput(authoritative.canonicalState, normalizedPath, (candidate) => VALUE_KINDS.has(candidate.kind));
                if (!input) {
                    throw new Error(`Property "${normalizedPath.split('/').pop()}" not found or not writable`);
                }
                const normalizedValue = normalizeVmValue(value, input.kind);
                const result = await requestAuthoritativeCommand(authoritative, 'vm-set', {
                    descriptor: {
                        kind: input.kind,
                        name: input.name,
                        path: input.path,
                        source: input.source || 'view-model',
                        stateMachineName: input.stateMachineName || null,
                    },
                    value: normalizedValue,
                });
                const canonicalInput = findCanonicalInput(result.canonicalState, normalizedPath) || input;
                return {
                    applied: result.applied,
                    kind: input.kind,
                    path: normalizedPath,
                    status: result.status,
                    value: canonicalInput.value,
                    ...(result.message ? { message: result.message } : {}),
                };
            }
            const resolved = resolveVmPath(normalizedPath, VALUE_KINDS);
            if (!resolved) {
                throw new Error(`Property "${normalizedPath.split('/').pop()}" not found or not writable`);
            }

            const normalizedValue = normalizeVmValue(value, resolved.kind);
            resolved.accessor.value = normalizedValue;
            let appliedValue = normalizedValue;
            try {
                appliedValue = resolved.accessor.value;
            } catch {
                // Some runtime accessors are write-only; preserve the requested value in the response.
            }
            dispatchVmControlMutation(documentRef, {
                descriptor: {
                    kind: resolved.kind,
                    name: resolved.propertyName,
                    path: resolved.path,
                    source: 'view-model',
                },
                kind: resolved.kind,
                value: appliedValue,
            });
            return {
                ok: true,
                path: resolved.path,
                kind: resolved.kind,
                value: appliedValue,
            };
        },

        async rav_vm_set_image({ path, bytes, label = 'MCP image' } = {}) {
            const normalizedPath = normalizeVmPath(path);
            const normalizedBytes = normalizeImageBytes(bytes);
            const authoritative = getAuthoritative();
            if (!authoritative) {
                throw new Error('Image mutation requires the authoritative playback surface');
            }
            const input = findCanonicalInput(authoritative.canonicalState, normalizedPath, (candidate) => candidate.kind === 'image');
            if (!input) throw new Error(`Image property "${normalizedPath.split('/').pop()}" not found or not writable`);
            const safeLabel = typeof label === 'string' && label.trim() ? label.trim().slice(0, 255) : 'MCP image';
            const descriptor = {
                kind: 'image', name: input.name, path: input.path,
                source: input.source || 'view-model', stateMachineName: input.stateMachineName || null,
            };
            const payload = {
                ...descriptor,
                action: 'set-image',
                descriptor,
                imageSelection: { kind: 'file', label: safeLabel },
                value: normalizedBytes,
            };
            const result = await requestAuthoritativeImageCommand(authoritative, payload);
            const canonicalInput = findCanonicalInput(result.canonicalState, normalizedPath) || input;
            return { applied: result.applied, metadata: canonicalInput.metadata || null, path: normalizedPath, present: canonicalInput.present === true, status: result.status };
        },

        async rav_vm_clear_image({ path } = {}) {
            const normalizedPath = normalizeVmPath(path);
            const authoritative = getAuthoritative();
            if (!authoritative) throw new Error('Image mutation requires the authoritative playback surface');
            const input = findCanonicalInput(authoritative.canonicalState, normalizedPath, (candidate) => candidate.kind === 'image');
            if (!input) throw new Error(`Image property "${normalizedPath.split('/').pop()}" not found or not writable`);
            const descriptor = {
                kind: 'image', name: input.name, path: input.path,
                source: input.source || 'view-model', stateMachineName: input.stateMachineName || null,
            };
            const payload = {
                ...descriptor,
                action: 'clear-image',
                descriptor,
                imageSelection: null, kind: 'image', value: null,
            };
            const result = await requestAuthoritativeImageCommand(authoritative, payload);
            const canonicalInput = findCanonicalInput(result.canonicalState, normalizedPath) || input;
            return { applied: result.applied, metadata: canonicalInput.metadata || null, path: normalizedPath, present: canonicalInput.present === true, status: result.status };
        },

        async rav_vm_fire({ path } = {}) {
            const normalizedPath = normalizeVmPath(path);
            const authoritative = getAuthoritative();
            if (authoritative) {
                const input = findCanonicalInput(authoritative.canonicalState, normalizedPath, (candidate) => candidate.kind === 'trigger');
                if (!input) {
                    throw new Error(`Trigger "${normalizedPath.split('/').pop()}" not found`);
                }
                const result = await requestAuthoritativeCommand(authoritative, 'vm-fire', {
                    descriptor: {
                        kind: 'trigger',
                        name: input.name,
                        path: input.path,
                        source: input.source || 'view-model',
                        stateMachineName: input.stateMachineName || null,
                    },
                });
                return {
                    applied: result.applied,
                    kind: 'trigger',
                    path: normalizedPath,
                    status: result.status,
                    ...(result.message ? { message: result.message } : {}),
                };
            }
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
            dispatchVmControlMutation(documentRef, {
                action: 'fire',
                descriptor: {
                    kind: 'trigger',
                    name: resolved.propertyName,
                    path: resolved.path,
                    source: 'view-model',
                },
                kind: 'trigger',
            });
            return { ok: true, path: resolved.path, kind: resolved.kind };
        },
    };
}
