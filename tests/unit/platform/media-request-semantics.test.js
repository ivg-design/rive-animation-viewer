import { createMediaCommands } from '../../../src/app/platform/mcp/commands/media.js';
import { normalizeMediaRequest } from '../../../src/app/platform/media/request-validation.js';
import { resolveMediaOptions } from '../../../src/app/platform/media/options.js';
import { createDraft, mediaOptions } from '../../../src/app/ui/media/model.js';
import { capabilities, timeline, stateMachine } from '../ui/media/fixtures.js';

const stills = ['png', 'jpg', 'webp'];
const animated = ['h264', 'h265', 'webm', 'apng', 'gif'];
const limits = { ...capabilities.limits, max_frames: null, max_duration_seconds: null };
const caps = { ...capabilities, limits };
const rejected = [];
for (const format of [...stills, ...animated.filter(f => f !== 'gif')]) {
    for (const field of ['gif', 'gif_preset']) {
        for (const tool of ['rav_export_media', ...(animated.includes(format) ? ['rav_record_start'] : [])]) {
            rejected.push({ tool, args: { format, [field]: field === 'gif' ? {} : 'small' }, field });
        }
    }
}
for (const format of animated) rejected.push({ tool: 'rav_export_media', args: { format, at_seconds: 0 }, field: 'at_seconds' });
for (const format of stills) {
    for (const field of ['start_seconds', 'end_seconds', 'start_frame', 'end_frame']) {
        rejected.push({ tool: 'rav_export_media', args: { format, [field]: field === 'end_frame' ? 1 : 0 }, field });
    }
}
for (const tool of ['rav_export_media', 'rav_record_start']) {
    rejected.push({ tool, args: { format: 'gif', quality: 80, gif: { quality: 5 } }, field: 'gif.quality' });
}

describe('raw MCP mode semantics', () => {
    it.each(rejected)('$tool rejects $args before controller lookup', ({ tool, args, field }) => {
        const getController = vi.fn(() => { throw new Error('No service lookup allowed'); });
        const commands = createMediaCommands({ windowRef: { _mcpGetMediaExportController: getController } });
        expect(() => commands[tool](args)).toThrow(`${tool}.${field}:`);
        expect(getController).not.toHaveBeenCalled();
    });
    it('retains valid still time, timeline bounds, raw identity and zero-valued fields', () => {
        const still = { format: 'png', at_seconds: 0, quality: 5 };
        expect(normalizeMediaRequest('rav_export_media', still)).toBe(still);
        const segment = { format: 'apng', start_seconds: 0, end_seconds: 1, start_frame: 0, end_frame: 60 };
        expect(normalizeMediaRequest('rav_export_media', segment)).toBe(segment);
    });
    it('retains schema-first rejection of malformed quality rather than coercing it', () => {
        expect(() => normalizeMediaRequest('rav_export_media', { format: 'gif', quality: 5, gif: { quality: '5' } })).toThrow('integer');
        expect(() => normalizeMediaRequest('rav_export_media', { format: 'png', gif: null })).toThrow('object');
    });
});

describe('GIF quality alias resolution', () => {
    for (const recording of [false, true]) {
        const info = recording ? stateMachine : timeline;
        const tool = recording ? 'rav_record_start' : 'rav_export_media';
        for (const preset of ['source', 'balanced', 'small', 'custom', 'target-size']) {
            it(`${recording ? 'record' : 'timeline'} ${preset} honors nested-only quality without changing preset dimensions/FPS`, () => {
                const base = { format: 'gif', gif_preset: preset, fps: 30, width: 1000, height: 600,
                    ...(preset === 'target-size' ? { gif: { max_bytes: 50000, size_policy: 'quality_only' } } : {}) };
                const before = resolveMediaOptions(base, info, recording, limits);
                for (const extra of [{ quality: 5 }, { gif: { quality: 5 } }, { quality: 5, gif: { quality: 5 } }]) {
                    const args = { ...base, ...extra, gif: { ...base.gif, ...extra.gif } };
                    const copy = structuredClone(args);
                    const resolved = resolveMediaOptions(normalizeMediaRequest(tool, args), info, recording, limits);
                    expect(resolved).toMatchObject({ quality: 5, gif: { quality: 5 }, width: before.width, height: before.height, fps: before.fps });
                    expect(args).toEqual(copy);
                    if (recording) expect(resolved.duration_seconds).toBeNull();
                }
                expect(before.quality).toBe(preset === 'small' ? 60 : 80);
            });
        }
        it(`${recording ? 'record' : 'timeline'} direct resolver rejects conflicts as well`, () => {
            expect(() => resolveMediaOptions({ format: 'gif', quality: 80, gif: { quality: 5 } }, info, recording, limits)).toThrow('conflict');
        });
    }
});

describe('UI compatibility and lossless formats', () => {
    const modes = [
        ...stills.map(format => ({ mode: 'still', format, info: timeline })),
        ...animated.map(format => ({ mode: 'timeline', format, info: timeline })),
        ...animated.map(format => ({ mode: 'record', format, info: stateMachine })),
    ];
    it.each(modes)('$mode/$format UI requests keep their controller route and remain valid', ({ mode, format, info }) => {
        const options = mediaOptions(createDraft(mode, info, caps, format), info, caps);
        // The normal UI includes its internal mode. It must not be passed through
        // raw MCP validation; validate only the caller's actual public argument set.
        expect(options).toHaveProperty('mode');
        const { mode: internalMode, ...raw } = options;
        expect(() => normalizeMediaRequest(mode === 'record' ? 'rav_record_start' : 'rav_export_media', raw)).not.toThrow();
        expect(resolveMediaOptions(options, info, mode === 'record', limits).format).toBe(format);
    });
    it.each(['png', 'apng'])('%s omits hidden quality from UI, documenting compatibility-only MCP quality', (format) => {
        const mode = format === 'png' ? 'still' : 'timeline';
        const draft = { ...createDraft(mode, timeline, caps, format), quality: 'stale-hidden-invalid-value' };
        const options = mediaOptions(draft, timeline, caps);
        expect(options).not.toHaveProperty('quality');
        expect(() => resolveMediaOptions(options, timeline, false, limits)).not.toThrow();
        expect(normalizeMediaRequest('rav_export_media', { format, quality: 5 }).quality).toBe(5);
    });
    it('keeps requested still time, source-frame segments and untimed UI recording intact', () => {
        const still = { ...createDraft('still', timeline, caps, 'png'), at_mode: 'frame', at_frame: 30 };
        expect(mediaOptions(still, timeline, caps).at_seconds).toBe(.5);
        const segment = { ...createDraft('timeline', timeline, caps, 'apng'), range: 'segment', range_unit: 'frames', start: 15, end: 60 };
        expect(mediaOptions(segment, timeline, caps)).toMatchObject({ start_frame: 15, end_frame: 60 });
        const options = mediaOptions(createDraft('record', stateMachine, caps, 'apng'), stateMachine, caps);
        expect(options.duration_seconds).toBeUndefined();
        expect(resolveMediaOptions(options, stateMachine, true, limits).duration_seconds).toBeNull();
    });
});
