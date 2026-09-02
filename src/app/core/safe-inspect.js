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

function truncateString(value, maxStringLength) {
    const text = String(value);
    if (text.length <= maxStringLength) return text;
    return `${text.slice(0, maxStringLength)}... ${text.length - maxStringLength} more characters`;
}

function summarizeElement(value, maxStringLength) {
    const tag = String(value.tagName || 'element').toLowerCase();
    const id = value.id ? `#${value.id}` : '';
    const classes = typeof value.className === 'string' && value.className.trim()
        ? `.${value.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
    return truncateString(`<${tag}${id}${classes}>`, maxStringLength);
}

function summarizeRiveInstance(inst, maxStringLength) {
    const names = (value) => Array.isArray(value)
        ? value.slice(0, 8).map((name) => truncateString(name, maxStringLength))
        : [];
    return {
        $type: 'RiveInstance',
        artboard: inst?.artboard?.name || inst?.artboardName
            ? truncateString(inst?.artboard?.name || inst?.artboardName, maxStringLength)
            : null,
        stateMachines: names(inst?.stateMachineNames),
        animations: names(inst?.animationNames),
        isPlaying: typeof inst?.isPlaying === 'boolean' ? inst.isPlaying : null,
        isStopped: typeof inst?.isStopped === 'boolean' ? inst.isStopped : null,
        hasViewModel: !!inst?.viewModelInstance,
    };
}

function previewValue(value, options, depth, seen) {
    const { maxArrayItems, maxDepth, maxObjectKeys, maxStringLength, windowRef } = options;

    if (
        value === null
        || value === undefined
        || typeof value === 'number'
        || typeof value === 'boolean'
    ) {
        return value;
    }

    if (typeof value === 'string') {
        return truncateString(value, maxStringLength);
    }

    if (typeof value === 'bigint') {
        return truncateString(`${value}n`, maxStringLength);
    }

    if (typeof value === 'symbol') {
        return truncateString(value.toString(), maxStringLength);
    }

    if (typeof value === 'function') {
        return truncateString(`[Function ${value.name || 'anonymous'}]`, maxStringLength);
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
            message: truncateString(value.message, maxStringLength),
        };
    }

    if (isElementLike(value)) {
        return summarizeElement(value, maxStringLength);
    }

    if (value && typeof value === 'object') {
        if (seen.has(value)) {
            return '[Circular]';
        }
        seen.add(value);

        try {
            if (windowRef?.riveInst && value === windowRef.riveInst) {
                return summarizeRiveInstance(value, maxStringLength);
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
                const keys = tryOwnKeys(value)
                    .slice(0, maxObjectKeys)
                    .map((key) => truncateString(key, Math.min(maxStringLength, 256)));
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
            entries.slice(0, maxObjectKeys).forEach((key, index) => {
                let outputKey = truncateString(key, Math.min(maxStringLength, 256));
                if (Object.prototype.hasOwnProperty.call(output, outputKey)) outputKey = `${outputKey}#${index + 1}`;
                try {
                    output[outputKey] = previewValue(value[key], options, depth + 1, seen);
                } catch (error) {
                    output[outputKey] = truncateString(`[Inspection threw: ${error?.message || error}]`, maxStringLength);
                }
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
        return truncateString(String(value), maxStringLength);
    } catch {
        return '[Unserializable]';
    }
}

export function createSafeInspectPreview(
    value,
    {
        maxDepth = 2,
        maxArrayItems = 12,
        maxObjectKeys = 16,
        maxStringLength = 8192,
        windowRef = globalThis.window,
    } = {},
) {
    return previewValue(value, {
        maxArrayItems,
        maxDepth,
        maxObjectKeys,
        maxStringLength,
        windowRef,
    }, 0, new WeakSet());
}
