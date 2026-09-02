        function truncateRenderSurfaceEvalString(value, maxLength) {
            var text = String(value);
            if (text.length <= maxLength) return text;
            return text.slice(0, maxLength) + '... ' + (text.length - maxLength) + ' more characters';
        }

        function renderSurfaceEvalOwnKeys(value) {
            try { return Object.keys(value); } catch (_error) { return []; }
        }

        function isRenderSurfaceEvalPlainObject(value) {
            if (!value || typeof value !== 'object') return false;
            try {
                var prototype = Object.getPrototypeOf(value);
                return prototype === Object.prototype || prototype === null;
            } catch (_error) {
                return false;
            }
        }

        function renderSurfaceEvalRivePreview(value, maxStringLength) {
            var names = function (entries) {
                return Array.isArray(entries) ? entries.slice(0, 8).map(function (entry) {
                    return truncateRenderSurfaceEvalString(entry, maxStringLength);
                }) : [];
            };
            var artboardName = null;
            try { artboardName = value && value.artboard && value.artboard.name || value.artboardName || null; } catch (_error) { /* unavailable */ }
            return {
                $type: 'RiveInstance',
                animations: names(value && value.animationNames),
                artboard: artboardName == null ? null : truncateRenderSurfaceEvalString(artboardName, maxStringLength),
                hasViewModel: Boolean(value && value.viewModelInstance),
                isPlaying: typeof (value && value.isPlaying) === 'boolean' ? value.isPlaying : null,
                isStopped: typeof (value && value.isStopped) === 'boolean' ? value.isStopped : null,
                stateMachines: names(value && value.stateMachineNames),
            };
        }

        function previewRenderSurfaceEvalValue(value, options, depth, seen) {
            var maxArrayItems = options.maxArrayItems;
            var maxDepth = options.maxDepth;
            var maxObjectKeys = options.maxObjectKeys;
            var maxStringLength = options.maxStringLength;
            if (value === null || typeof value === 'undefined' || typeof value === 'number' || typeof value === 'boolean') return value;
            if (typeof value === 'string') return truncateRenderSurfaceEvalString(value, maxStringLength);
            if (typeof value === 'bigint') return truncateRenderSurfaceEvalString(String(value) + 'n', maxStringLength);
            if (typeof value === 'symbol') return truncateRenderSurfaceEvalString(value.toString(), maxStringLength);
            if (typeof value === 'function') return truncateRenderSurfaceEvalString('[Function ' + (value.name || 'anonymous') + ']', maxStringLength);
            if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
            if (value instanceof RegExp) return truncateRenderSurfaceEvalString(String(value), maxStringLength);
            if (value instanceof Error) return {
                $type: value.name || 'Error',
                message: truncateRenderSurfaceEvalString(value.message, maxStringLength),
            };
            if (value && typeof value === 'object' && value.nodeType === 1 && typeof value.tagName === 'string') {
                var id = value.id ? '#' + value.id : '';
                var classes = typeof value.className === 'string' && value.className.trim()
                    ? '.' + value.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
                return truncateRenderSurfaceEvalString('<' + String(value.tagName).toLowerCase() + id + classes + '>', maxStringLength);
            }
            if (value && typeof value === 'object') {
                if (seen.has(value)) return '[Circular]';
                seen.add(value);
                try {
                    if (value === riveInstance) return renderSurfaceEvalRivePreview(value, maxStringLength);
                    if (Array.isArray(value)) {
                        if (depth >= maxDepth) return '[Array(' + value.length + ')]';
                        var items = value.slice(0, maxArrayItems).map(function (entry) {
                            return previewRenderSurfaceEvalValue(entry, options, depth + 1, seen);
                        });
                        if (value.length > maxArrayItems) items.push('... ' + (value.length - maxArrayItems) + ' more');
                        return items;
                    }
                    if (value instanceof Map) return '[Map(' + value.size + ')]';
                    if (value instanceof Set) return '[Set(' + value.size + ')]';
                    if (!isRenderSurfaceEvalPlainObject(value)) {
                        var constructorName = value.constructor && value.constructor.name || 'Object';
                        return {
                            $type: constructorName,
                            keys: renderSurfaceEvalOwnKeys(value).slice(0, maxObjectKeys).map(function (key) {
                                return truncateRenderSurfaceEvalString(key, Math.min(maxStringLength, 256));
                            }),
                        };
                    }
                    if (depth >= maxDepth) return '[Object keys=' + renderSurfaceEvalOwnKeys(value).length + ']';
                    var entries = renderSurfaceEvalOwnKeys(value);
                    var output = {};
                    entries.slice(0, maxObjectKeys).forEach(function (key, index) {
                        var outputKey = truncateRenderSurfaceEvalString(key, Math.min(maxStringLength, 256));
                        if (Object.prototype.hasOwnProperty.call(output, outputKey)) outputKey += '#' + (index + 1);
                        try {
                            output[outputKey] = previewRenderSurfaceEvalValue(value[key], options, depth + 1, seen);
                        } catch (error) {
                            output[outputKey] = truncateRenderSurfaceEvalString('[Inspection threw: ' + ((error && error.message) || error) + ']', maxStringLength);
                        }
                    });
                    if (entries.length > maxObjectKeys) output.$moreKeys = entries.length - maxObjectKeys;
                    return output;
                } finally {
                    seen.delete(value);
                }
            }
            try { return truncateRenderSurfaceEvalString(String(value), maxStringLength); } catch (_error) { return '[Unserializable]'; }
        }

        function createRenderSurfaceEvalPreview(value) {
            try {
                return previewRenderSurfaceEvalValue(value, {
                    maxArrayItems: 12,
                    maxDepth: 2,
                    maxObjectKeys: 16,
                    maxStringLength: 8192,
                }, 0, new WeakSet());
            } catch (error) {
                return truncateRenderSurfaceEvalString('[Inspection failed: ' + ((error && error.message) || error) + ']', 8192);
            }
        }

        async function evaluateRenderSurfaceExpression(payload) {
            var expression = payload && payload.expression;
            if (typeof expression !== 'string' || !expression.trim()) throw new Error('expression is required');
            try {
                // Direct eval intentionally exposes this authoritative child scope,
                // including riveInstance, only after the host Script Access gate.
                // eslint-disable-next-line no-eval
                var value = await eval(expression);
                if (typeof value === 'undefined') return { result: 'undefined' };
                if (value === null) return { result: 'null' };
                return { result: createRenderSurfaceEvalPreview(value) };
            } catch (error) {
                throw new Error('Eval error: ' + ((error && error.message) || error));
            }
        }
