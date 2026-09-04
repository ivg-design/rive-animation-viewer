import { frameRate, frameTime, resolveMediaOptions } from '../../../src/app/platform/media/options.js';
import { MEDIA_TOOLS } from '../../../mcp-server/tools/media-tools.js';
import { readFileSync } from 'node:fs';
const info = { width: 1920, height: 1080, playback: { type: 'animation', fps: 60, durationSeconds: 2 } };
describe('media export sampling and controls', () => {
    it('samples an exclusive segment using the rational rate without endpoint duplication', () => {
        const options = resolveMediaOptions({ format: 'webm', start_frame: 30, end_frame: 60, fps: 60 }, info);
        expect(options.frame_count).toBe(30);
        expect(frameTime(options, 0)).toBe(.5);
        expect(frameTime(options, 29)).toBeCloseTo(59 / 60);
        expect(frameRate({ numerator: 30000, denominator: 1001 })).toEqual({ numerator: 30000, denominator: 1001 });
    });
    it('reduces GIF dimensions/FPS, preserves aspect, and never upscales presets', () => {
        const small = resolveMediaOptions({ format: 'gif', gif_preset: 'small' }, info);
        expect([small.width, small.height, small.fps.numerator / small.fps.denominator, small.quality]).toEqual([480, 270, 12, 60]);
        const tiny = resolveMediaOptions({ format: 'gif', width: 160, gif_preset: 'balanced' }, info);
        expect([tiny.width, tiny.height]).toEqual([160, 90]);
    });
    it('rejects impossible alpha, odd video dimensions, invalid target size and over-limit work', () => {
        expect(() => resolveMediaOptions({ format: 'h264', alpha: true }, info)).toThrow('alpha');
        expect(() => resolveMediaOptions({ format: 'h265', width: 301 }, info)).toThrow('even');
        expect(() => resolveMediaOptions({ format: 'gif', gif_preset: 'target-size' }, info)).toThrow('max_bytes');
        expect(() => resolveMediaOptions({ format: 'webm', end_seconds: 3 }, info)).toThrow('segment');
        expect(() => resolveMediaOptions({ format: 'webm', width: 4000, height: 4000 }, info)).toThrow('limit');
    });
    it('keeps manual recording untimed and permits recordings beyond five minutes', () => {
        expect(resolveMediaOptions({ format: 'png' }, { width: 100, height: 100 }).frame_count).toBe(1);
        expect(resolveMediaOptions({ format: 'webm' }, { ...info, playback: { type: 'stateMachine' } }, true).duration_seconds).toBeNull();
        expect(resolveMediaOptions({ format: 'webm', duration_seconds: 3601 }, { ...info, playback: { type: 'stateMachine' } }, true, { max_duration_seconds: null, max_frames: null }).duration_seconds).toBe(3601);
        expect(() => resolveMediaOptions({ format: 'webm', duration_seconds: -1 }, info, true)).toThrow('positive');
    });
    it('advertises the identical media contract in both MCP servers', () => {
        expect(MEDIA_TOOLS).toEqual(JSON.parse(readFileSync('mcp-server/tools/media-tools.json', 'utf8')));
        expect(MEDIA_TOOLS).toHaveLength(8);
    });
});
