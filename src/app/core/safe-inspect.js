function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isElementLike(value) {
    return !!value && typeof value === 'object' && value.nodeType === 1 && typeof value.tagName === 'string';
}

function tryOwnKeys(value) {
    try {
        return Object.keys(value);
    } catch {
        return [];
    }
}

function summarizeElement(value) {
    const tag = String(value.tagName || 'element').toLowerCase();
    const id = value.id ? `#${value.id}` : '';
    const classes = typeof value.className === 'string' && value.className.trim()
        ? `.${value.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
    return `<${tag}${id}${classes}>`;
}

function summarizeRiveInstance(inst) {
    return {
        $type: 'RiveInstance',
        artboard: inst?.artboard?.name || inst?.artboardName || null,
        stateMachines: Array.isArray(inst?.stateMachineNames) ? inst.stateMachineNames.slice(0, 8) : [],
        animations: Array.isArray(inst?.animationNames) ? inst.animationNames.slice(0, 8) : [],
        isPlaying: typeof inst?.isPlaying === 'boolean' ? inst.isPlaying : null,
        isStopped: typeof inst?.isStopped === 'boolean' ? inst.isStopped : null,
        hasViewModel: !!inst?.viewModelInstance,
    };
}

function previewValue(value, options, depth, seen) {
    const { maxArrayItems, maxDepth, maxObjectKeys, windowRef } = options;

    if (
        value === null
        || value === undefined
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
    ) {
        return value;
    }

    if (typeof value === 'bigint') {
        return `${value}n`;
    }

    if (typeof value === 'symbol') {
        return value.toString();
    }

    if (typeof value === 'function') {
        return `[Function ${value.name || 'anonymous'}]`;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    }

    if (value instanceof RegExp) {
        return String(value);
    }

    if (value instanceof Error) {
        return {
            $type: value.name || 'Error',
            message: value.message,
        };
    }

    if (isElementLike(value)) {
        return summarizeElement(value);
    }

    if (value && typeof value === 'object') {
        if (seen.has(value)) {
            return '[Circular]';
        }
        seen.add(value);

        try {
            if (windowRef?.riveInst && value === windowRef.riveInst) {
                return summarizeRiveInstance(value);
            }

            if (Array.isArray(value)) {
                if (depth >= maxDepth) {
                    return `[Array(${value.length})]`;
                }
                const items = value
                    .slice(0, maxArrayItems)
                    .map((entry) => previewValue(entry, options, depth + 1, seen));
                if (value.length > maxArrayItems) {
                    items.push(`... ${value.length - maxArrayItems} more`);
                }
                return items;
            }

            if (value instanceof Map) {
                return `[Map(${value.size})]`;
            }

            if (value instanceof Set) {
                return `[Set(${value.size})]`;
            }

            if (!isPlainObject(value)) {
                const constructorName = value.constructor?.name || 'Object';
                const keys = tryOwnKeys(value).slice(0, maxObjectKeys);
                return {
                    $type: constructorName,
                    keys,
                };
            }

            if (depth >= maxDepth) {
                return `[Object keys=${tryOwnKeys(value).length}]`;
            }

            const entries = tryOwnKeys(value);
            const output = {};
            entries.slice(0, maxObjectKeys).forEach((key) => {
                output[key] = previewValue(value[key], options, depth + 1, seen);
            });
            if (entries.length > maxObjectKeys) {
                output.$moreKeys = entries.length - maxObjectKeys;
            }
            return output;
        } finally {
            seen.delete(value);
        }
    }

    try {
        return String(value);
    } catch {
        return '[Unserializable]';
    }
}

export function createSafeInspectPreview(
    value,
    { maxDepth = 2, maxArrayItems = 12, maxObjectKeys = 16, windowRef = globalThis.window } = {},
) {
    return previewValue(value, { maxArrayItems, maxDepth, maxObjectKeys, windowRef }, 0, new WeakSet());
}
