// Host-local copy of the renderer's pure validation section: packaged builds copy src/ only.
// Source-parity tests prevent drift; no template/server import, eval, or build-script dependency.
const contract = (function () {
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
    return { validate, duration };
})();

export function validateRecordingInteractions(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Recording options must be an object.');
    const duration_seconds = contract.duration(input.duration_seconds);
    const interactions = contract.validate(input.interactions, duration_seconds);
    return { ...input, duration_seconds, interactions };
}
