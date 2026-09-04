import { changeDraft, createDraft, mediaOptions, sourceReason } from '../../../../src/app/ui/media/model.js';
import { resolveMediaOptions } from '../../../../src/app/platform/media/options.js';
import { capabilities as caps, timeline, stateMachine } from './fixtures.js';

const resolve = (draft, info = timeline, capabilities = caps) => resolveMediaOptions(mediaOptions(draft, info, capabilities), info, draft.mode === 'record', capabilities.limits);

describe('media UI option contract', () => {
    it.each(['png', 'jpg', 'webp'])('exports %s stills from either source without adding a timeline time', (format) => {
        for (const info of [timeline, stateMachine]) {
            const options = mediaOptions(createDraft('still', info, caps, format), info, caps);
            expect(options).toMatchObject({ mode: 'still', format });
            expect(options).not.toHaveProperty('at_seconds');
            expect(resolveMediaOptions(options, info, false, caps.limits).frame_count).toBe(1);
        }
    });
    it('passes full timeline duration to the shared resolver, and end-exclusive frame segments', () => {
        const draft = createDraft('timeline', timeline, caps);
        expect(resolve(draft).frame_count).toBe(240);
        const options = mediaOptions({ ...draft, range: 'segment', range_unit: 'frames', start: '30', end: '90' }, timeline, caps);
        expect(options).toMatchObject({ start_frame: 30, end_frame: 90 });
        expect(resolveMediaOptions(options, timeline, false, caps.limits)).toMatchObject({ start_seconds: .5, end_seconds: 1.5, frame_count: 60 });
    });
    it('converts still frame numbers to seconds without changing the live session', () => {
        const draft = { ...createDraft('still', timeline, caps), at_mode: 'frame', at_frame: 120 };
        expect(mediaOptions(draft, timeline, caps).at_seconds).toBe(2);
    });
    it('omits duration for manual recording and passes seconds for timed recording', () => {
        const draft = createDraft('record', stateMachine, caps);
        expect(mediaOptions(draft, stateMachine, caps)).not.toHaveProperty('duration_seconds');
        expect(mediaOptions({ ...draft, stop_mode: 'duration', duration_seconds: '12.5', cursor: true }, stateMachine, caps)).toMatchObject({ duration_seconds: 12.5, cursor: true });
    });
    it('uses the shared resolver for GIF presets without upscaling', () => {
        const draft = createDraft('timeline', timeline, caps, 'gif');
        expect(resolve(draft)).toMatchObject({ width: 960, height: 540, fps: { numerator: 20, denominator: 1 } });
        expect(resolve(changeDraft(draft, 'gif_preset', 'small', timeline, caps))).toMatchObject({ width: 480, height: 270, quality: 60 });
        const small = { ...timeline, width: 320, height: 180 };
        expect(resolve(createDraft('timeline', small, caps, 'gif'), small)).toMatchObject({ width: 320, height: 180 });
    });
    it('passes target bytes and only supported adjustment policies', () => {
        const draft = { ...createDraft('timeline', timeline, caps, 'gif'), gif_preset: 'target-size', target_mib: '2.5' };
        expect(mediaOptions(draft, timeline, caps).gif).toEqual({ encoder: 'auto', repeat: 0, max_bytes: 2621440, size_policy: 'quality_only' });
        expect(() => mediaOptions({ ...draft, size_policy: 'imaginary' }, timeline, caps)).toThrow('unavailable');
        expect(() => mediaOptions({ ...draft, target_mib: '' }, timeline, caps)).toThrow('positive target');
    });
    it('omits stale gifski-only settings for FFmpeg and passes them when supported', () => {
        const draft = { ...createDraft('timeline', timeline, caps, 'gif'), motion_quality: 90, lossy_quality: 70 };
        expect(mediaOptions(draft, timeline, caps).gif).not.toHaveProperty('motion_quality');
        const supported = { ...caps, gif: { ...caps.gif, resolved_auto_encoder: 'gifski', gifski_available: true, motion_quality: true, lossy_quality: true } };
        expect(mediaOptions(draft, timeline, supported).gif).toMatchObject({ motion_quality: 90, lossy_quality: 70 });
    });
    it('blocks missing encoders and unsupported alpha using capabilities', () => {
        const draft = createDraft('timeline', timeline, caps, 'webm');
        const missing = { ...caps, formats: [{ id: 'webm', available: false, reason: 'VP9 probe failed' }] };
        expect(() => mediaOptions(draft, timeline, missing)).toThrow('VP9 probe failed');
        const opaque = { ...caps, formats: [{ id: 'webm', available: true, alpha: false }] };
        expect(() => mediaOptions({ ...draft, alpha: true }, timeline, opaque)).toThrow('transparency');
        expect(changeDraft({ ...draft, alpha: true }, 'format', 'h265', timeline, caps).alpha).toBe(false);
    });
    it('preserves timing on unit changes and respects source aspect lock', () => {
        const draft = createDraft('timeline', timeline, caps);
        expect(changeDraft(draft, 'range_unit', 'frames', timeline, caps)).toMatchObject({ start: 0, end: 240 });
        expect(changeDraft(draft, 'width', '960', timeline, caps)).toMatchObject({ width: '960', height: 540 });
        expect(changeDraft(draft, 'scale', '.25', timeline, caps)).toMatchObject({ width: 480, height: 270 });
    });
    it('starts video exports with valid even dimensions and preserves source dimensions for GIF', () => {
        const odd = { ...timeline, width: 821, height: 92 };
        const video = createDraft('timeline', odd, caps, 'h264');
        expect(resolve(video, odd)).toMatchObject({ width: 822, height: 92 });
        const gif = createDraft('timeline', odd, caps, 'gif');
        expect(gif).toMatchObject({ width: 821, height: 92 });
        expect(changeDraft(gif, 'format', 'webm', odd, caps)).toMatchObject({ width: 822, height: 92 });
    });
    it('clears a chosen destination when the format changes', () => {
        const draft = { ...createDraft('timeline', timeline, caps, 'h264'), output_path: '/tmp/movie.mp4' };
        expect(changeDraft(draft, 'format', 'webm', timeline, caps).output_path).toBe('');
        expect(changeDraft(draft, 'quality', 90, timeline, caps).output_path).toBe('/tmp/movie.mp4');
    });
    it('surfaces mode errors and actual limits from the shared resolver', () => {
        expect(sourceReason('timeline', stateMachine)).toContain('Select a timeline');
        expect(sourceReason('record', timeline)).toContain('Select a state machine');
        const draft = createDraft('timeline', timeline, caps);
        expect(() => resolve({ ...draft, width: 4096, height: 4096 })).toThrow('encoder limit');
        expect(() => resolve({ ...draft, width: 1919 })).toThrow('even');
        expect(() => resolve({ ...draft, fps: 61 })).toThrow('Frame rate');
    });
});
