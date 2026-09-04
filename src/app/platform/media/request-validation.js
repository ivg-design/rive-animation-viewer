import { validateRecordingInteractions } from './interaction-validation.js';

// Browser-local constraints: distribution copies src/, not mcp-server/. Tests
// compare these (minus annotations) with canonical media-tools.json and its JS.
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, ...(maximum == null ? {} : { maximum }) });
const number = (minimum, maximum) => ({ type: 'number', minimum, ...(maximum == null ? {} : { maximum }) });
const string = () => ({ type: 'string' });
const choice = (values) => ({ type: 'string', enum: values });
const bool = () => ({ type: 'boolean' });
const animated = ['h264', 'h265', 'webm', 'apng', 'gif'];
const formats = [...animated, 'png', 'jpg', 'webp'];
const gif = object({ encoder: choice(['auto', 'gifski', 'ffmpeg']), quality: integer(1, 100),
    motion_quality: integer(1, 100), lossy_quality: integer(1, 100), repeat: integer(-1, 32767),
    max_bytes: integer(1), size_policy: choice(['quality_only', 'quality_fps_scale']) });
// gif has no required keyword in the canonical schema (equivalent to []).
delete gif.required;
const common = {
    format: choice(formats), output_path: string(), overwrite: bool(), width: integer(1), height: integer(1),
    scale: { type: 'number', exclusiveMinimum: 0, maximum: 8 },
    fps: { oneOf: [number(1, 60), object({ numerator: integer(1), denominator: integer(1) }, ['numerator', 'denominator'])] },
    alpha: bool(), background: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, quality: integer(1, 100), cursor: bool(),
    gif_preset: choice(['source', 'balanced', 'small', 'custom', 'target-size']), gif,
};
function descriptor(kind, requiredKind = true) {
    return { ...object({ source: choice(['view-model', 'global-view-model']),
        globalViewModelName: { type: 'string', minLength: 1 }, path: { type: 'string', minLength: 1 },
        kind: { const: kind }, name: string() }, requiredKind ? ['path', 'kind'] : ['path']),
    allOf: [{ if: { properties: { source: { const: 'global-view-model' } }, required: ['source'] },
        then: { required: ['globalViewModelName'] }, else: { not: { required: ['globalViewModelName'] } } }] };
}
const operation = (type, properties, required) => object({ at_seconds: number(0), type: { const: type }, ...properties }, ['at_seconds', 'type', ...required]);
const scalarOperations = [
    ['boolean', bool()], ['number', { type: 'number' }], ['string', string()],
    ['enum', string()], ['color', integer(-2147483648, 4294967295)],
].map(([kind, value]) => operation('vm-set', { descriptor: descriptor(kind), value }, ['descriptor', 'value']));
const interaction = { oneOf: [...scalarOperations,
    operation('vm-set', { descriptor: descriptor('image'), bytes: { type: 'array', minItems: 1, maxItems: 16777216, items: integer(0, 255) }, label: { type: 'string', maxLength: 255 } }, ['descriptor', 'bytes']),
    operation('vm-set', { descriptor: descriptor('image'), value: { type: 'null' }, label: { type: 'string', maxLength: 255 } }, ['descriptor', 'value']),
    operation('vm-trigger', { descriptor: descriptor('trigger', false) }, ['descriptor']),
    operation('pointer', { event: choice(['down', 'move', 'up', 'exit']), x: number(0, 1), y: number(0, 1), id: { type: 'integer', const: 0 }, buttons: integer(0, 65535) }, ['event', 'x', 'y']),
] };

export const MEDIA_REQUEST_SCHEMAS = {
    rav_media_capabilities: object(),
    rav_export_media: object({ ...common, start_seconds: number(0), end_seconds: number(0),
        start_frame: integer(0), end_frame: integer(1), at_seconds: number(0) }, ['format']),
    rav_record_start: object({ ...common, format: choice(animated),
        duration_seconds: { type: ['number', 'null'], exclusiveMinimum: 0 },
        interactions: { type: 'array', items: interaction } }, ['format']),
    rav_record_stop: object(), rav_media_status: object({ job_id: string() }), rav_media_cancel: object({ job_id: string() }),
    rav_step_frames: object({ frames: integer(1, 600), fps: number(1, 240) }),
    rav_pointer: object({ type: choice(['down', 'move', 'up', 'exit']), x: number(0, 1), y: number(0, 1),
        id: { type: 'integer', const: 0 }, buttons: integer(0) }, ['type', 'x', 'y']),
};

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function isType(value, type) {
    if (type === 'object') return plain(value);
    if (type === 'array') return Array.isArray(value);
    if (type === 'null') return value === null;
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'integer') return Number.isInteger(value);
    return typeof value === type;
}
function invalid(schema, value, path) {
    if (schema.type && ![schema.type].flat().some((type) => isType(value, type))) return `${path}: expected ${[schema.type].flat().join(' or ')}`;
    if (own(schema, 'const') && value !== schema.const) return `${path}: expected ${JSON.stringify(schema.const)}`;
    if (schema.enum && !schema.enum.includes(value)) return `${path}: value must be one of ${schema.enum.join(', ')}`;
    if (schema.oneOf) {
        const errors = schema.oneOf.map((branch) => invalid(branch, value, path));
        if (errors.filter((error) => !error).length !== 1) {
            // Show bounded path-specific explanations; never echo caller values/image bytes.
            return `${path}: expected exactly one allowed shape (${[...new Set(errors.filter(Boolean))].slice(0, 3).join('; ')})`;
        }
    }
    if (schema.allOf) {
        for (const branch of schema.allOf) { const error = invalid(branch, value, path); if (error) return error; }
    }
    if (schema.not && !invalid(schema.not, value, path)) return `${path}: forbidden property combination`;
    if (schema.if) {
        const branch = invalid(schema.if, value, path) ? schema.else : schema.then;
        if (branch) { const error = invalid(branch, value, path); if (error) return error; }
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return `${path}: expected finite number`;
        if (schema.minimum != null && value < schema.minimum) return `${path}: must be >= ${schema.minimum}`;
        if (schema.maximum != null && value > schema.maximum) return `${path}: must be <= ${schema.maximum}`;
        if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) return `${path}: must be > ${schema.exclusiveMinimum}`;
    }
    if (typeof value === 'string') {
        const length = [...value].length; // JSON Schema counts Unicode code points, not UTF-16 units.
        if (schema.minLength != null && length < schema.minLength) return `${path}: too short`;
        if (schema.maxLength != null && length > schema.maxLength) return `${path}: too long`;
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}: invalid string format`;
    }
    if (Array.isArray(value)) {
        if (schema.minItems != null && value.length < schema.minItems) return `${path}: too few items`;
        if (schema.maxItems != null && value.length > schema.maxItems) return `${path}: too many items`;
        if (schema.items) for (let index = 0; index < value.length; index += 1) {
            if (!own(value, index)) return `${path}[${index}]: missing array item`;
            const error = invalid(schema.items, value[index], `${path}[${index}]`); if (error) return error;
        }
    }
    if (plain(value)) {
        for (const key of schema.required || []) if (!own(value, key)) return `${path}.${key}: required`;
        for (const key of Object.keys(value)) {
            const child = schema.properties && own(schema.properties, key) ? schema.properties[key] : null;
            if (!child && schema.additionalProperties === false) return `${path}.${key}: unknown property`;
            if (child) { const error = invalid(child, value[key], `${path}.${key}`); if (error) return error; }
        }
    }
    return null;
}
// Keep metadata immutable so callers cannot relax a later request's validation.
function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
}
freeze(MEDIA_REQUEST_SCHEMAS);

// Raw MCP intent only. The UI calls the controller with its own mode/resolved
// fields, so these checks must not run on normalized controller options.
function validateMediaRequestSemantics(tool, args) {
    if (tool !== 'rav_export_media' && tool !== 'rav_record_start') return;
    if (args.format !== 'gif') {
        for (const key of ['gif', 'gif_preset']) {
            if (own(args, key)) throw new Error(`${tool}.${key}: requires GIF format`);
        }
    } else if (own(args, 'quality') && args.gif && own(args.gif, 'quality') && args.quality !== args.gif.quality) {
        throw new Error(`${tool}.gif.quality: conflicts with quality; supply one value or matching values`);
    }
    if (tool !== 'rav_export_media') return;
    const still = ['png', 'jpg', 'webp'].includes(args.format);
    if (!still && own(args, 'at_seconds')) throw new Error(`${tool}.at_seconds: requires a still format`);
    if (still) {
        for (const key of ['start_seconds', 'end_seconds', 'start_frame', 'end_frame']) {
            if (own(args, key)) throw new Error(`${tool}.${key}: requires an animated timeline format`);
        }
    }
}

export function normalizeMediaRequest(tool, args = {}) {
    if (!own(MEDIA_REQUEST_SCHEMAS, tool)) throw new Error(`Unknown media tool: ${tool}`);
    const error = invalid(MEDIA_REQUEST_SCHEMAS[tool], args, tool);
    if (error) throw new Error(error);
    validateMediaRequestSemantics(tool, args);
    // Only the agreed recording normalization supplies defaults. Never coerce,
    // strip unknown properties, infer formats, or rewrite encoding options here.
    return tool === 'rav_record_start' ? validateRecordingInteractions(args) : args;
}
