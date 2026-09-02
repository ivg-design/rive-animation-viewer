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

    it('builds duration-backed frame and time scales with exact endpoints', () => {
        const metrics = { playbackType: 'animation', totalFrames: 120, fps: 60 };
        expect(buildTimelineScale(metrics, 'frames').map(({ label, percent }) => [label, percent])).toEqual([
            ['0', 0],
            ['12', 10],
            ['24', 20],
            ['36', 30],
            ['48', 40],
            ['60', 50],
            ['72', 60],
            ['84', 70],
            ['96', 80],
            ['108', 90],
            ['120', 100],
        ]);
        expect(buildTimelineScale(metrics, 'seconds').map(({ label }) => label)).toEqual([
            '0.00s', '0.20s', '0.40s', '0.60s', '0.80s', '1.00s',
            '1.20s', '1.40s', '1.60s', '1.80s', '2.00s',
        ]);
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

    it('routes desktop seeks to the active child and returns its acknowledged metrics', async () => {
        const requestAuthoritativeCommand = vi.fn(async () => ({
            applied: true,
            canonicalState: {
                playback: {
                    currentFrame: 45,
                    currentSeconds: 0.75,
                    fps: 60,
                    name: 'Intro',
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
        expect([...document.querySelectorAll('.timeline-progress-tick')].map((tick) => tick.textContent))
            .toEqual(['0', '12', '24', '36', '48', '60', '72', '84', '96', '108', '120']);
        document.getElementById('timeline-progress-unit').click();
        expect(controller.getUnit()).toBe('seconds');
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('0.50 / 2.00 S');
        expect(document.getElementById('timeline-progress-bar').max).toBe('2');
        expect(controller.getState().progress).toBe(before);
        expect([...document.querySelectorAll('.timeline-progress-tick')].map((tick) => tick.textContent))
            .toEqual([
                '0.00s', '0.20s', '0.40s', '0.60s', '0.80s', '1.00s',
                '1.20s', '1.40s', '1.60s', '1.80s', '2.00s',
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
