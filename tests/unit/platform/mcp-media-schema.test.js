import { readFileSync } from 'node:fs';
import { MEDIA_TOOLS } from '../../../mcp-server/tools/media-tools.js';
import { ANIMATED_FORMATS, STILL_FORMATS } from '../../../src/app/ui/media/model.js';
import { resolveMediaOptions } from '../../../src/app/platform/media/options.js';

const tool = (name) => MEDIA_TOOLS.find((entry) => entry.name === name);
const info = { width: 320, height: 180, playback: { type: 'stateMachine', fps: 30 } };

describe('MCP media schema matches supported operations', () => {
    it('keeps Node generated data and native include source identical', () => {
        expect(MEDIA_TOOLS).toEqual(JSON.parse(readFileSync('mcp-server/tools/media-tools.json', 'utf8')));
        const registry = readFileSync('src-tauri/src/bin/rav-mcp/tool_registry.rs', 'utf8');
        expect(registry).toContain('include_str!("../../../../mcp-server/tools/media-tools.json")');
        expect(new Set(MEDIA_TOOLS.map((entry) => entry.name)).size).toBe(8);
    });
    it('advertises only recordable formats and leaves still export available', () => {
        const advertised = tool('rav_record_start').inputSchema.properties.format.enum;
        expect(advertised).toEqual(ANIMATED_FORMATS);
        for (const format of advertised) expect(resolveMediaOptions({ format }, info, true).mode).toBe('record');
        for (const format of STILL_FORMATS) {
            expect(tool('rav_export_media').inputSchema.properties.format.enum).toContain(format);
            expect(() => resolveMediaOptions({ format }, info, true)).toThrow('animated format');
        }
    });
    it('publishes the normalized pointer coordinate bounds for all event types', () => {
        const props = tool('rav_pointer').inputSchema.properties;
        expect(props.type.enum).toEqual(['down', 'move', 'up', 'exit']);
        for (const axis of ['x', 'y']) expect(props[axis]).toMatchObject({ minimum: 0, maximum: 1 });
        expect(props.id.const).toBe(0);
    });
    it('documents matching GIF quality aliases and the signed repeat range', () => {
        for (const name of ['rav_export_media', 'rav_record_start']) {
            const props = tool(name).inputSchema.properties;
            expect(props.gif.properties.repeat).toMatchObject({ minimum: -1, maximum: 32767 });
            expect(props.gif.properties.quality.description).toContain('top-level quality');
            expect(props.gif.properties.quality.description).toContain('must match');
            expect(resolveMediaOptions({ format: 'gif', gif: { quality: 5 } }, info, true).gif.quality).toBe(5);
            expect(() => resolveMediaOptions({ format: 'gif', quality: 75, gif: { quality: 5 } }, info, true)).toThrow('conflict');
        }
    });
});
