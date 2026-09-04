/* Shared by the host validator (side-effect ESM import) and the desktop template.
 * No timers, resets, or capture implementation: the caller supplies recording time.
 */
var RavMediaInteractions = (function () {
    var own = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
    function object(value, label) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object.');
    }
    function fields(value, allowed, label) {
        object(value, label);
        Object.keys(value).forEach(function (key) {
            if (allowed.indexOf(key) < 0) throw new Error(label + ': unknown field ' + key + '.');
        });
    }
    function duration(value) {
        if (value == null) return null;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('duration_seconds must be positive or null.');
        return value;
    }
    function descriptor(input, kind) {
        fields(input, ['source', 'globalViewModelName', 'path', 'kind', 'name'], 'VM descriptor');
        var source = own(input, 'source') ? input.source : 'view-model';
        if (source !== 'view-model' && source !== 'global-view-model') throw new Error('Invalid VM descriptor source.');
        if (typeof input.path !== 'string' || !input.path.trim()) throw new Error('VM descriptor path is required.');
        var path = input.path.trim();
        if (path.indexOf('/') < 0) path = path.replace(/\./g, '/');
        if (path.split('/').some(function (part) { return !part; })) throw new Error('Invalid VM descriptor path.');
        if (own(input, 'name') && typeof input.name !== 'string') throw new Error('VM descriptor name must be a string.');
        if (source === 'global-view-model' && (typeof input.globalViewModelName !== 'string' || !input.globalViewModelName.trim())) throw new Error('Global VM name is required.');
        if (source === 'view-model' && own(input, 'globalViewModelName')) throw new Error('Global VM name requires global-view-model source.');
        if (kind && own(input, 'kind') && input.kind !== kind) throw new Error('VM descriptor kind does not match interaction type.');
        return { source: source, path: path, kind: kind || input.kind, name: input.name || path.split('/').pop(),
            ...(source === 'global-view-model' ? { globalViewModelName: input.globalViewModelName.trim() } : {}) };
    }
    function validate(input, stopAt) {
        stopAt = duration(stopAt);
        if (input === undefined) return [];
        if (!Array.isArray(input)) throw new Error('interactions must be an array.');
        return input.map(function (operation, index) {
            object(operation, 'Interaction ' + index);
            var type = operation.type;
            var allowed = type === 'pointer' ? ['at_seconds', 'type', 'event', 'x', 'y', 'id', 'buttons']
                : type === 'vm-set' ? ['at_seconds', 'type', 'descriptor', 'value', 'bytes', 'label']
                    : ['at_seconds', 'type', 'descriptor'];
            fields(operation, allowed, 'Interaction ' + index);
            if (!['vm-set', 'vm-trigger', 'pointer'].includes(type)) throw new Error('Unsupported interaction type.');
            var at = operation.at_seconds;
            if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) throw new Error('at_seconds must be a finite non-negative number.');
            if (stopAt != null && at >= stopAt) throw new Error('Interaction must occur before duration_seconds (exclusive).');
            var result = { at_seconds: at, type: type };
            if (type === 'pointer') {
                if (!['down', 'move', 'up', 'exit'].includes(operation.event)) throw new Error('Invalid pointer event.');
                ['x', 'y'].forEach(function (axis) {
                    if (!Number.isFinite(operation[axis]) || operation[axis] < 0 || operation[axis] > 1) throw new Error('Pointer coordinates must be in 0–1.');
                });
                if (own(operation, 'id') && operation.id !== 0) throw new Error('Only mouse pointer id 0 is supported.');
                if (own(operation, 'buttons') && (!Number.isInteger(operation.buttons) || operation.buttons < 0 || operation.buttons > 65535)) throw new Error('Invalid mouse buttons bitmask.');
                return Object.assign(result, { event: operation.event, x: operation.x, y: operation.y, id: 0 },
                    operation.buttons == null ? {} : { buttons: operation.buttons });
            }
            result.descriptor = descriptor(operation.descriptor, type === 'vm-trigger' ? 'trigger' : null);
            if (type === 'vm-trigger') return result;
            var kind = result.descriptor.kind;
            if (!['boolean', 'number', 'string', 'enum', 'color', 'image'].includes(kind)) throw new Error('vm-set requires a supported descriptor kind.');
            var value = operation.value;
            if (kind === 'image') {
                if (own(operation, 'bytes') && own(operation, 'value')) throw new Error('Image uses bytes or value:null, not both.');
                if (own(operation, 'bytes')) {
                    if (!Array.isArray(operation.bytes) || !operation.bytes.length || operation.bytes.length > 16777216) throw new Error('Image bytes must contain 1–16777216 bytes.');
                    result.bytes = operation.bytes.map(function (byte) {
                        if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('Invalid image byte.');
                        return byte;
                    });
                } else if (own(operation, 'value') && value === null) result.value = null;
                else throw new Error('Image vm-set requires bytes or value:null to clear.');
                if (own(operation, 'label') && (typeof operation.label !== 'string' || operation.label.length > 255)) throw new Error('Image label must be at most 255 characters.');
                if (operation.label != null) result.label = operation.label;
                return result;
            }
            if (own(operation, 'bytes') || own(operation, 'label')) throw new Error('bytes/label require image kind.');
            if (!own(operation, 'value')) throw new Error('vm-set value is required.');
            if (kind === 'boolean' && typeof value !== 'boolean') throw new Error('Boolean value required.');
            if (kind === 'number' && !Number.isFinite(value)) throw new Error('Finite number value required.');
            if (['string', 'enum'].includes(kind) && typeof value !== 'string') throw new Error('String/enum value must be a string.');
            if (kind === 'color') {
                if (!Number.isInteger(value) || value < -2147483648 || value > 4294967295) throw new Error('Color must be a signed or unsigned 32-bit integer.');
                if (value < 0) value += 4294967296;
            }
            result.value = value;
            return result;
        });
    }
    function create(input, options) {
        options = options || {};
        var operations = validate(input, options.duration_seconds).map(function (op, index) { return { op: op, index: index }; });
        operations.sort(function (a, b) { return a.op.at_seconds - b.op.at_seconds || a.index - b.index; });
        var cursor = 0, lastTime = -1, cancelled = false, failure = null, receipts = [];
        function current() {
            if (options.isCurrent && !options.isCurrent()) throw new Error('Scheduled interaction source changed.');
        }
        function run(seconds, frameIndex) {
            if (cancelled) return [];
            if (failure) throw failure;
            try {
                if (!Number.isFinite(seconds) || seconds < 0 || seconds < lastTime) throw new Error('Recording clock must be finite and monotonic.');
                current(); lastTime = seconds;
                var applied = [];
                while (cursor < operations.length && operations[cursor].op.at_seconds <= seconds + 1e-9) {
                    var entry = operations[cursor];
                    // A timer may wake after stopAt: never apply an action at/after the stop boundary.
                    if (options.duration_seconds != null && seconds >= options.duration_seconds) break;
                    current();
                    var result = options.apply(entry.op, entry.index);
                    if (result && typeof result.then === 'function') throw new Error('Frame-start apply must be synchronous; prepare images before starting the clock.');
                    var receipt = { index: entry.index, type: entry.op.type, scheduled_seconds: entry.op.at_seconds,
                        applied_seconds: seconds, lateness_seconds: Math.max(0, seconds - entry.op.at_seconds), frame_index: frameIndex == null ? null : frameIndex };
                    cursor += 1; receipts.push(receipt); applied.push(Object.assign({}, receipt));
                }
                return applied;
            } catch (error) { failure = error; throw error; }
        }
        return { run: run, cancel: function () { cancelled = true; },
            status: function () { return { scheduled: operations.length, applied: cursor, pending: operations.length - cursor,
                cancelled: cancelled, error: failure ? String(failure.message || failure) : null,
                receipts: receipts.map(function (receipt) { return Object.assign({}, receipt); }) }; } };
    }
    return Object.freeze({ validate: validate, duration: duration, create: create });
})();
// Allows the host to import this exact validation code without eval or a duplicate validator.
globalThis.RavMediaInteractions = RavMediaInteractions;

async function prepareRenderSurfaceInteractionSchedule(interactions, options, preparationIsCurrent, onCancellation) {
    options = options || {};
    var normalized = RavMediaInteractions.validate(interactions, options.duration_seconds);
    var player = riveInstance, session = renderSurfaceSessionId, resources = new Map(), pendingImages = [];
    var disposed = false;
    function isCurrent() { return !disposed && (!preparationIsCurrent || preparationIsCurrent()) && player === riveInstance && session === renderSurfaceSessionId; }
    function release(image) { if (image && typeof image.unref === 'function') image.unref(); }
    function dispose() {
        if (disposed) return;
        disposed = true;
        resources.forEach(release); resources.clear(); pendingImages.length = 0;
    }
    if (onCancellation) onCancellation(dispose);
    try {
        // Validate the whole schedule before the first decode. Estimates are RGBA
        // pixels, not a process/GPU quota; encoded and decoded allocations are separate.
        var encodedBytes = 0, decodedBytes = 0;
        for (var checkIndex = 0; checkIndex < normalized.length; checkIndex += 1) {
            var candidate = normalized[checkIndex];
            if (!candidate.bytes) continue;
            encodedBytes += candidate.bytes.length;
            if (encodedBytes > 32 * 1024 * 1024) throw new Error('Scheduled images exceed the 32 MiB encoded-data budget.');
            var checkedBytes = validateRenderSurfaceImageBytes(candidate.bytes);
            var dimensions = inspectRenderSurfaceImage(checkedBytes);
            if (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)
                || dimensions.width <= 0 || dimensions.height <= 0) {
                throw new Error('Scheduled image dimensions must be known positive integers before decoding.');
            }
            var imageBytes = dimensions.width * dimensions.height * 4;
            if (!Number.isSafeInteger(imageBytes)) throw new Error('Scheduled image decoded size is invalid.');
            decodedBytes += imageBytes;
            if (decodedBytes > 256 * 1024 * 1024) throw new Error('Scheduled images exceed the 256 MiB decoded RGBA budget.');
        }
        // Decode and validate before recording starts; no presentation fence in the frame-start path.
        for (var index = 0; index < normalized.length; index += 1) {
            var operation = normalized[index];
            if (!operation.bytes) continue;
            if (!loadedRiveRuntime || typeof loadedRiveRuntime.decodeImage !== 'function') throw new Error('Image decoding is unavailable.');
            if (!isCurrent()) throw new Error('Scheduled image preparation was cancelled.');
            var bytes = validateRenderSurfaceImageBytes(operation.bytes);
            var image = await loadedRiveRuntime.decodeImage(bytes);
            if (!image) throw new Error('Could not decode scheduled image.');
            if (!isCurrent()) { release(image); throw new Error('Scheduled interaction source changed during image preparation.'); }
            resources.set(index, image);
        }
        var schedule = RavMediaInteractions.create(normalized, {
            duration_seconds: options.duration_seconds, isCurrent: isCurrent,
            apply: function (op, index) {
                if (op.type === 'pointer') return dispatchRenderSurfacePointer({ type: op.event, x: op.x, y: op.y, id: 0, buttons: op.buttons });
                var descriptor = op.descriptor;
                if (descriptor.kind === 'image') {
                    var accessor = resolveControlAccessor(descriptor);
                    if (!accessor || !('value' in accessor)) throw new Error('Scheduled image control is unavailable.');
                    accessor.value = resources.get(index) || null;
                    pendingImages.push({ index: index, descriptor: Object.assign({}, descriptor, {
                        action: op.bytes ? 'set-image' : 'clear-image', value: op.bytes || null,
                        imageSelection: op.bytes ? { kind: 'file', label: op.label || 'MCP scheduled image' } : null }) });
                    return;
                }
                if (descriptor.kind === 'enum') {
                    var enumAccessor = resolveControlAccessor(descriptor);
                    var values = readEnumValues(enumAccessor);
                    if (values.length && values.indexOf(op.value) < 0) throw new Error('Scheduled enum value is not an available choice.');
                }
                // Existing root/nested/global/list accessor route and trigger receipts.
                return handleRenderSurfaceCommand({ type: op.type === 'vm-trigger' ? 'vm-fire' : 'vm-set',
                    payload: { descriptor: descriptor, value: op.value } });
            },
        });
        return { run: schedule.run, status: schedule.status,
            afterFrame: function () {
                if (!isCurrent()) { schedule.cancel(); dispose(); throw new Error('Scheduled interaction source changed before presentation.'); }
                pendingImages.splice(0).forEach(function (entry) {
                    try { rememberRenderSurfaceImageCommand(entry.descriptor); }
                    finally { release(resources.get(entry.index)); resources.delete(entry.index); }
                });
            },
            dispose: function () { schedule.cancel(); dispose(); } };
    } catch (error) { dispose(); throw error; }
}
