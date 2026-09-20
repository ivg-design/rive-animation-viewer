import {
    RENDER_SURFACE_CANONICAL_STATE_EVENT,
    TIMELINE_PROGRESS_EVENT,
    buildTimelineScale,
    captureTimelineProgressForInstance,
    createTimelineProgressController,
    createTimelineSeekHandler,
    formatTimelineFrames,
    formatTimelineSeconds,
    normalizeTimelineProgress,
    seekRiveTimeline,
} from '../../../src/app/rive/timeline-progress.js';

const controllers = [];

afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.dispose());
    document.body.innerHTML = '';
});

function createFixture() {
    document.body.innerHTML = `
        <div class="runtime-strip" id="runtime-strip">
            <div id="timeline-progress" data-unit="frames" aria-hidden="true" hidden>
                <button id="timeline-progress-unit" type="button">FRAMES</button>
                <div class="timeline-progress-track">
                    <div class="timeline-progress-visual" aria-hidden="true">
                        <span class="timeline-progress-fill"></span>
                        <span class="timeline-progress-cti"></span>
                    </div>
                    <div id="timeline-progress-scale"></div>
                    <input id="timeline-progress-bar" type="range" min="0" max="1" step="1" value="0">
                </div>
                <div id="timeline-progress-readout"></div>
            </div>
            <div class="runtime-strip-primary"></div>
        </div>`;
    return document.getElementById('timeline-progress');
}

function createController(options = {}) {
    const controller = createTimelineProgressController({ root: createFixture(), ...options });
    controllers.push(controller);
    return controller;
}

describe('timeline progress helpers', () => {
    it('preserves unavailable metrics instead of coercing nulls into zeroes', () => {
        expect(normalizeTimelineProgress({ playbackType: 'animation' })).toMatchObject({
            currentFrame: null,
            currentSeconds: null,
            totalFrames: null,
            totalSeconds: null,
        });
        expect(formatTimelineFrames(null)).toBe('--');
        expect(formatTimelineSeconds(undefined)).toBe('--');
    });

    it('derives missing frames and seconds from fps', () => {
        expect(normalizeTimelineProgress({
            playbackType: 'animation',
            currentFrame: 30,
            totalFrames: 120,
            fps: 60,
        })).toMatchObject({ currentSeconds: 0.5, totalSeconds: 2, progress: 0.25 });
    });

    it('clamps progress and formats invalid values safely', () => {
        expect(normalizeTimelineProgress({ playbackType: 'animation', currentSeconds: 4, totalSeconds: 2 }).progress).toBe(1);
        expect(formatTimelineFrames('nope')).toBe('--');
        expect(formatTimelineSeconds('nope')).toBe('--');
    });

    it('labels nice steps, keeps exact endpoints, and places a minor tick on every frame', () => {
        const metrics = { playbackType: 'animation', totalFrames: 120, fps: 60 };
        const frames = buildTimelineScale(metrics, 'frames');
        expect(frames.filter((tick) => tick.kind === 'major').map(({ label, percent }) => [label, percent])).toEqual([
            ['0', 0], ['15', 12.5], ['30', 25], ['45', 37.5], ['60', 50],
            ['75', 62.5], ['90', 75], ['105', 87.5], ['120', 100],
        ]);
        expect(frames.filter((tick) => tick.kind === 'minor')).toHaveLength(120 - 8);
        expect(frames.every((tick, index) => index === 0 || tick.value > frames[index - 1].value)).toBe(true);
        expect(frames.find((tick) => tick.value === 37).percent).toBeCloseTo(37 / 120 * 100, 9);

        const sixty = buildTimelineScale({ playbackType: 'animation', totalFrames: 60, fps: 60 }, 'frames');
        expect(sixty.filter((tick) => tick.kind === 'major').map(({ label }) => label)).toEqual(['0', '10', '20', '30', '40', '50', '60']);
        expect(sixty).toHaveLength(61);

        const seconds = buildTimelineScale(metrics, 'seconds');
        expect(seconds.filter((tick) => tick.kind === 'major').map(({ label }) => label)).toEqual([
            '0.00s', '0.25s', '0.50s', '0.75s', '1.00s', '1.25s', '1.50s', '1.75s', '2.00s',
        ]);
        expect(seconds.filter((tick) => tick.kind === 'minor').length).toBeGreaterThan(0);
        expect(seconds.at(-1)).toMatchObject({ edge: 'end', percent: 100 });

        // Uneven length: the last step label too close to the end is dropped.
        const uneven = buildTimelineScale({ playbackType: 'animation', totalFrames: 1000, fps: 60 }, 'frames');
        const labels = uneven.filter((tick) => tick.kind === 'major').map(({ label }) => label);
        expect(labels.at(-1)).toBe('1000');
        expect(labels).not.toContain('960');
    });

    it('reads live wrapper duration, fps, and time for browser-host playback', () => {
        const metrics = captureTimelineProgressForInstance({
            animator: {
                animations: [{
                    animation: { duration: 90, fps: 30 },
                    name: 'Intro',
                    playing: true,
                    time: 1.25,
                }],
            },
        }, { currentPlaybackName: 'Intro', currentPlaybackType: 'animation' });
        expect(metrics).toMatchObject({
            currentFrame: 38,
            currentSeconds: 1.25,
            fps: 30,
            playbackName: 'Intro',
            totalFrames: 90,
            totalSeconds: 3,
        });
    });

    it('re-instances a completed one-shot paused before scrubbing it backward', () => {
        const riveInstance = {
            animator: { animations: [] },
            pause: vi.fn(),
            scrub: vi.fn(),
        };
        expect(seekRiveTimeline(riveInstance, 'Intro', 0.75)).toBe(true);
        expect(riveInstance.pause).toHaveBeenCalledWith('Intro');
        expect(riveInstance.scrub).toHaveBeenCalledWith('Intro', 0.75);
    });

    it('pauses playback once when a drag starts, before the first seek', async () => {
        const events = [];
        const controller = createController({
            onScrubStart: () => { events.push('pause'); },
            onSeek: async (request) => { events.push(`seek:${request.frame}`); return { applied: true, status: 'applied' }; },
        });
        controller.update({ playbackType: 'animation', playbackName: 'Intro', currentFrame: 0, totalFrames: 120, fps: 60, isPlaying: true });
        const slider = document.getElementById('timeline-progress-bar');
        slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        slider.value = '10';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.value = '20';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
        await flush();
        expect(events[0]).toBe('pause');
        expect(events.filter((event) => event === 'pause')).toHaveLength(1);
        // A new grab pauses again.
        slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();
        expect(events.filter((event) => event === 'pause')).toHaveLength(2);
    });

    it('routes desktop seeks to the active child and returns its acknowledged metrics', async () => {
        const requestAuthoritativeCommand = vi.fn(async () => ({
            applied: true,
            canonicalState: {
                playback: {
                    currentFrame: 45,
                    currentSeconds: 0.75,
                    fps: 60,
                    name: 'Intro',
                    speed: 0.5,
                    totalFrames: 120,
                    totalSeconds: 2,
                    type: 'animation',
                },
            },
            status: 'applied',
        }));
        const seek = createTimelineSeekHandler({
            getPlaybackState: () => ({ currentPlaybackName: 'Intro', currentPlaybackType: 'animation' }),
            isAuthoritativeChildMode: () => true,
            requestAuthoritativeCommand,
        });

        await expect(seek({ frame: 45, seconds: 0.75 })).resolves.toEqual(expect.objectContaining({
            applied: true,
            metrics: expect.objectContaining({
                currentFrame: 45,
                currentSeconds: 0.75,
                playbackName: 'Intro',
                // The authored speed survives the seek reply so the readout keeps its ×N suffix.
                speed: 0.5,
                totalFrames: 120,
            }),
        }));
        expect(requestAuthoritativeCommand).toHaveBeenCalledWith('scrub', {
            frame: 45,
            name: 'Intro',
            seconds: 0.75,
        });
    });

    it('never routes a scrub command for state-machine playback', async () => {
        const requestAuthoritativeCommand = vi.fn();
        const seek = createTimelineSeekHandler({
            getPlaybackState: () => ({ currentPlaybackName: 'MainSM', currentPlaybackType: 'stateMachine' }),
            isAuthoritativeChildMode: () => true,
            requestAuthoritativeCommand,
        });
        await expect(seek({ seconds: 1 })).resolves.toEqual({ applied: false, status: 'unavailable' });
        expect(requestAuthoritativeCommand).not.toHaveBeenCalled();
    });
});

describe('timeline progress controller', () => {
    it('adds the second status row only for linear-animation playback', () => {
        const controller = createController();
        const row = document.getElementById('timeline-progress');
        controller.update({ playbackType: 'stateMachine', currentFrame: 2, totalFrames: 10 });
        expect(controller.getState().playbackType).toBe('stateMachine');
        expect(row.hidden).toBe(true);
        controller.update({ playbackType: 'animation', currentFrame: 2, totalFrames: 10, fps: 10 });
        expect(row.hidden).toBe(false);
        expect(row.classList.contains('is-visible')).toBe(true);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('2 / 10 FR');
        expect(document.getElementById('runtime-strip').children).toHaveLength(2);
        expect(document.getElementById('runtime-strip').firstElementChild).toBe(row);
        expect(row.firstElementChild.id).toBe('timeline-progress-unit');
        expect(row.lastElementChild.id).toBe('timeline-progress-readout');
    });

    it('toggles the populated scale between frames and seconds without changing progress', () => {
        const controller = createController();
        controller.update({ playbackType: 'animation', currentFrame: 30, totalFrames: 120, fps: 60 });
        const before = controller.getState().progress;
        expect(document.getElementById('timeline-progress-bar').max).toBe('120');
        const labelsOf = () => [...document.querySelectorAll('.timeline-progress-tick:not(.is-minor)')].map((tick) => tick.textContent);
        expect(labelsOf()).toEqual(['0', '15', '30', '45', '60', '75', '90', '105', '120']);
        expect(document.querySelectorAll('.timeline-progress-tick.is-minor')).toHaveLength(120 - 8);
        document.getElementById('timeline-progress-unit').click();
        expect(controller.getUnit()).toBe('seconds');
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('0.50 / 2.00 S');
        expect(document.getElementById('timeline-progress-bar').max).toBe('2');
        expect(controller.getState().progress).toBe(before);
        expect(labelsOf()).toEqual([
            '0.00s', '0.25s', '0.50s', '0.75s', '1.00s', '1.25s', '1.50s', '1.75s', '2.00s',
        ]);
    });

    it('previews drag input, ignores stale clock ticks, and commits the final child-confirmed seek', async () => {
        const onSeek = vi.fn(async (request) => ({ applied: true, metrics: request.metrics, status: 'applied' }));
        const controller = createController({ onSeek });
        controller.update({
            currentFrame: 30,
            fps: 60,
            playbackName: 'Intro',
            playbackType: 'animation',
            totalFrames: 120,
        });
        const slider = document.getElementById('timeline-progress-bar');
        slider.value = '60';
        slider.dispatchEvent(new Event('input'));
        expect(controller.isScrubbing()).toBe(true);
        expect(controller.getState()).toMatchObject({ currentFrame: 60, currentSeconds: 1 });

        document.dispatchEvent(new CustomEvent(TIMELINE_PROGRESS_EVENT, {
            detail: {
                currentFrame: 31,
                fps: 60,
                playbackName: 'Intro',
                playbackType: 'animation',
                totalFrames: 120,
            },
        }));
        expect(controller.getState().currentFrame).toBe(60);

        slider.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(controller.isScrubbing()).toBe(false));
        expect(onSeek).toHaveBeenLastCalledWith(expect.objectContaining({
            frame: 60,
            name: 'Intro',
            progress: 0.5,
            release: true,
            seconds: 1,
        }));
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('60 / 120 FR');
    });

    it('accepts the public document event contract', () => {
        const controller = createController();
        document.dispatchEvent(new CustomEvent(TIMELINE_PROGRESS_EVENT, {
            detail: { playbackType: 'animation', currentSeconds: 1, totalSeconds: 4, fps: 30 },
        }));
        expect(controller.getState()).toMatchObject({ currentSeconds: 1, totalSeconds: 4, progress: 0.25 });
        expect(document.getElementById('timeline-progress').style.getPropertyValue('--timeline-fill')).toBe('25%');
    });

    it('never rewinds the CTI for late child samples or stale canonical snapshots while playing', () => {
        let clock = 0;
        let nextFrameId = 0;
        const scheduled = new Map();
        const controller = createController({
            cancelFrame: (frameId) => scheduled.delete(frameId),
            now: () => clock,
            requestFrame: (callback) => {
                const frameId = ++nextFrameId;
                scheduled.set(frameId, callback);
                return frameId;
            },
        });
        const runNextFrame = (milliseconds) => {
            clock = milliseconds;
            const [frameId, callback] = scheduled.entries().next().value;
            scheduled.delete(frameId);
            callback(milliseconds);
        };
        const sample = (frame, extra = {}) => ({
            currentFrame: frame,
            currentSeconds: frame / 60,
            fps: 60,
            isPaused: false,
            isPlaying: true,
            playbackName: 'thunder_bolt',
            playbackType: 'animation',
            totalFrames: 120,
            totalSeconds: 2,
            ...extra,
        });
        const seen = [];
        const record = () => seen.push(controller.getState().currentFrame);

        controller.update(sample(30)); record();
        runNextFrame(1000 / 60); record();      // presented 31
        runNextFrame(2000 / 60); record();      // presented 32
        // Child sample that crossed the bridge late: two frames behind the presented time.
        controller.update(sample(30)); record();
        runNextFrame(3000 / 60); record();
        // Throttled canonical-state broadcast carrying an even older snapshot.
        document.dispatchEvent(new CustomEvent(RENDER_SURFACE_CANONICAL_STATE_EVENT, {
            detail: { playback: { type: 'animation', name: 'thunder_bolt', isPlaying: true, isPaused: false,
                currentFrame: 29, currentSeconds: 29 / 60, fps: 60, totalFrames: 120, totalSeconds: 2 } },
        }));
        record();
        runNextFrame(4000 / 60); record();
        controller.update(sample(33)); record();
        runNextFrame(5000 / 60); record();

        for (let index = 1; index < seen.length; index += 1) {
            expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1]);
        }
        expect(seen.at(-1)).toBeGreaterThanOrEqual(33);

        // A real rewind (loop restart) is still followed immediately.
        controller.update(sample(2));
        expect(controller.getState().currentFrame).toBe(2);
        // A paused canonical snapshot is authoritative even when it is behind.
        document.dispatchEvent(new CustomEvent(RENDER_SURFACE_CANONICAL_STATE_EVENT, {
            detail: { playback: { type: 'animation', name: 'thunder_bolt', isPlaying: false, isPaused: true,
                currentFrame: 1, currentSeconds: 1 / 60, fps: 60, totalFrames: 120, totalSeconds: 2 } },
        }));
        expect(controller.getState().currentFrame).toBe(1);
    });

    it('follows the return leg of a ping-pong loop instead of holding the presented time', () => {
        const controller = createController();
        const sample = (currentSeconds, direction) => controller.update({
            currentSeconds, direction, fps: 60, isPlaying: true, playbackName: 'Cloudy', playbackType: 'animation', speed: 1, totalSeconds: 2,
        });
        sample(1.90, 1);
        sample(1.98, 1);
        // The clock turns around: every backward sample is followed, one frame at a time.
        sample(1.97, -1);
        expect(controller.getState().currentSeconds).toBeCloseTo(1.97, 6);
        sample(1.95, -1);
        expect(controller.getState().currentSeconds).toBeCloseTo(1.95, 6);
        sample(1.50, -1);
        expect(controller.getState().currentSeconds).toBeCloseTo(1.5, 6);
        // A late forward-leg sample within the latency window is held, not replayed.
        sample(1.55, -1);
        expect(controller.getState().currentSeconds).toBeCloseTo(1.5, 6);
        sample(0.02, -1);
        sample(0, -1);
        expect(controller.getState().currentSeconds).toBe(0);
        // The next forward leg starts from zero.
        sample(0.03, 1);
        expect(controller.getState().currentSeconds).toBeCloseTo(0.03, 6);
    });

    it('advances the presented clock at the authored speed and counts down for reversed timelines', () => {
        let clock = 0; let nextFrameId = 0; const scheduled = new Map();
        const controller = createController({
            cancelFrame: (frameId) => scheduled.delete(frameId),
            now: () => clock,
            requestFrame: (callback) => { const id = ++nextFrameId; scheduled.set(id, callback); return id; },
        });
        const runNextFrame = (ms) => { clock = ms; const [id, cb] = scheduled.entries().next().value; scheduled.delete(id); cb(ms); };
        controller.update({ currentFrame: 0, currentSeconds: 0, fps: 60, isPaused: false, isPlaying: true, playbackName: 'Slow', playbackType: 'animation', totalFrames: 240, totalSeconds: 4, speed: 0.2 });
        runNextFrame(1000);
        expect(controller.getState().currentSeconds).toBeCloseTo(0.2, 6);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('12 / 240 FR \u00b7 \u00d70.2');

        controller.update({ currentFrame: 60, currentSeconds: 1, fps: 60, isPaused: false, isPlaying: true, playbackName: 'Back', playbackType: 'animation', totalFrames: 60, totalSeconds: 1, speed: -1 });
        expect(controller.getState().progress).toBe(0);
        runNextFrame(1500);
        expect(controller.getState().currentSeconds).toBeCloseTo(0.5, 6);
        expect(controller.getState().progress).toBeCloseTo(0.5, 6);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('30 / 60 FR \u00b7 \u00d7\u22121');
        const ticks = buildTimelineScale(controller.getState(), 'frames').filter((tick) => tick.kind === 'major');
        expect(ticks[0]).toMatchObject({ label: '60', percent: 0 });
        expect(ticks.at(-1)).toMatchObject({ label: '0', percent: 100 });
    });

    it('keeps the readout width constant while the frame count changes', () => {
        const controller = createController();
        const readout = document.getElementById('timeline-progress-readout');
        controller.update({ playbackType: 'animation', currentFrame: 1, totalFrames: 240, fps: 60 });
        const width = readout.dataset.widest;
        expect(width).toBe('240 / 240 FR');
        controller.update({ playbackType: 'animation', currentFrame: 100, totalFrames: 240, fps: 60 });
        expect(readout.dataset.widest).toBe(width);
        controller.update({ playbackType: 'animation', currentFrame: 3, totalFrames: 240, fps: 60, speed: 0.2 });
        expect(readout.dataset.widest).toBe('240 / 240 FR \u00b7 \u00d70.2');
    });

    it('presents every elapsed animation frame between child clock receipts', () => {
        let clock = 0;
        let nextFrameId = 0;
        const scheduled = new Map();
        const controller = createController({
            cancelFrame: (frameId) => scheduled.delete(frameId),
            now: () => clock,
            requestFrame: (callback) => {
                const frameId = ++nextFrameId;
                scheduled.set(frameId, callback);
                return frameId;
            },
        });
        const runNextFrame = (milliseconds) => {
            clock = milliseconds;
            const [frameId, callback] = scheduled.entries().next().value;
            scheduled.delete(frameId);
            callback(milliseconds);
        };

        controller.update({
            currentFrame: 30,
            currentSeconds: 0.5,
            fps: 60,
            isPaused: false,
            isPlaying: true,
            playbackName: 'Intro',
            playbackType: 'animation',
            totalFrames: 60,
            totalSeconds: 1,
        });
        runNextFrame(1000 / 60);
        expect(controller.getState().currentFrame).toBe(31);
        expect(document.getElementById('timeline-progress-bar').value).toBe('31');
        runNextFrame(2000 / 60);
        expect(controller.getState().currentFrame).toBe(32);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('32 / 60 FR');

        controller.update({
            currentFrame: 32,
            currentSeconds: 32 / 60,
            fps: 60,
            isPaused: true,
            isPlaying: false,
            playbackName: 'Intro',
            playbackType: 'animation',
            totalFrames: 60,
            totalSeconds: 1,
        });
        expect(scheduled.size).toBe(0);
    });

    it('clears and hides stale timecode only when an acknowledged canonical state switches to a state machine', () => {
        const controller = createController();
        document.dispatchEvent(new CustomEvent(TIMELINE_PROGRESS_EVENT, {
            detail: { playbackType: 'animation', currentFrame: 22, totalFrames: 60, fps: 60 },
        }));
        const row = document.getElementById('timeline-progress');
        expect(row.hidden).toBe(false);

        document.dispatchEvent(new CustomEvent('rav:playback-selection-requested', {
            detail: { playbackType: 'stateMachine' },
        }));
        expect(row.hidden).toBe(false);

        document.dispatchEvent(new CustomEvent(RENDER_SURFACE_CANONICAL_STATE_EVENT, {
            detail: { playback: { name: 'MainSM', type: 'stateMachine' } },
        }));
        expect(row.hidden).toBe(true);
        expect(controller.getState()).toMatchObject({
            currentFrame: null,
            currentSeconds: null,
            playbackType: 'stateMachine',
            totalFrames: null,
            totalSeconds: null,
        });
    });

    it('restores current metrics when the next acknowledged canonical state is an animation', () => {
        const controller = createController();
        document.dispatchEvent(new CustomEvent(RENDER_SURFACE_CANONICAL_STATE_EVENT, {
            detail: { playback: { name: 'MainSM', type: 'stateMachine' } },
        }));
        document.dispatchEvent(new CustomEvent(RENDER_SURFACE_CANONICAL_STATE_EVENT, {
            detail: {
                playback: {
                    currentFrame: 9,
                    currentSeconds: 0.15,
                    fps: 60,
                    name: 'Intro',
                    totalFrames: 120,
                    totalSeconds: 2,
                    type: 'animation',
                },
            },
        }));
        expect(document.getElementById('timeline-progress').hidden).toBe(false);
        expect(controller.getState()).toMatchObject({
            currentFrame: 9,
            currentSeconds: 0.15,
            playbackName: 'Intro',
            playbackType: 'animation',
            totalFrames: 120,
            totalSeconds: 2,
        });
    });

    it('retains a completed timeline row until an acknowledged state-machine reset', () => {
        createController();
        const emitCanonical = (playback) => document.dispatchEvent(new CustomEvent(RENDER_SURFACE_CANONICAL_STATE_EVENT, {
            detail: { playback },
        }));
        emitCanonical({
            currentFrame: 60,
            currentSeconds: 1,
            fps: 60,
            name: 'Focus Fullscreen Mode',
            totalFrames: 60,
            totalSeconds: 1,
            type: 'animation',
        });
        expect(document.getElementById('timeline-progress').hidden).toBe(false);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('60 / 60 FR');

        emitCanonical({ name: 'TrackMapSM', type: 'stateMachine' });
        expect(document.getElementById('timeline-progress').hidden).toBe(true);
    });
});
