import {
    RENDER_SURFACE_CANONICAL_STATE_EVENT,
    TIMELINE_PROGRESS_EVENT,
    createTimelineProgressController,
    formatTimelineFrames,
    formatTimelineSeconds,
    normalizeTimelineProgress,
} from '../../../src/app/rive/timeline-progress.js';

function createFixture() {
    document.body.innerHTML = `
        <div id="timeline-progress" data-unit="frames" aria-hidden="true">
            <div id="timeline-progress-readout"></div>
            <progress id="timeline-progress-bar" max="1" value="0"></progress>
            <button id="timeline-progress-unit" type="button">FRAMES</button>
        </div>`;
    return document.getElementById('timeline-progress');
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
});

describe('timeline progress controller', () => {
    it('stays hidden for state machines and visible for animations', () => {
        const controller = createTimelineProgressController({ root: createFixture() });
        controller.update({ playbackType: 'stateMachine', currentFrame: 2, totalFrames: 10 });
        expect(controller.getState().playbackType).toBe('stateMachine');
        expect(document.getElementById('timeline-progress').classList.contains('is-visible')).toBe(false);
        controller.update({ playbackType: 'animation', currentFrame: 2, totalFrames: 10 });
        expect(document.getElementById('timeline-progress').classList.contains('is-visible')).toBe(true);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('2 / 10 FR');
    });

    it('toggles frames and seconds without changing progress', () => {
        const controller = createTimelineProgressController({ root: createFixture() });
        controller.update({ playbackType: 'animation', currentFrame: 30, totalFrames: 120, fps: 60 });
        const before = document.getElementById('timeline-progress-bar').value;
        document.getElementById('timeline-progress-unit').click();
        expect(controller.getUnit()).toBe('seconds');
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('0.50 / 2.00 S');
        expect(document.getElementById('timeline-progress-bar').value).toBe(before);
    });

    it('accepts the public document event contract', () => {
        const controller = createTimelineProgressController({ root: createFixture() });
        document.dispatchEvent(new CustomEvent(TIMELINE_PROGRESS_EVENT, {
            detail: { playbackType: 'animation', currentSeconds: 1, totalSeconds: 4, fps: 30 },
        }));
        expect(controller.getState()).toMatchObject({ currentSeconds: 1, totalSeconds: 4, progress: 0.25 });
    });

    it('clears and hides stale timecode only when an acknowledged canonical state switches to a state machine', () => {
        const controller = createTimelineProgressController({ root: createFixture() });
        document.dispatchEvent(new CustomEvent(TIMELINE_PROGRESS_EVENT, {
            detail: { playbackType: 'animation', currentFrame: 22, totalFrames: 60, fps: 60 },
        }));
        const chip = document.getElementById('timeline-progress');
        expect(chip.classList.contains('is-visible')).toBe(true);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('22 / 60 FR');

        // A raw selection request must not hide the clock. The child has not
        // confirmed its replacement state yet.
        document.dispatchEvent(new CustomEvent('rav:playback-selection-requested', {
            detail: { playbackType: 'stateMachine' },
        }));
        expect(chip.classList.contains('is-visible')).toBe(true);

        document.dispatchEvent(new CustomEvent(RENDER_SURFACE_CANONICAL_STATE_EVENT, {
            detail: { playback: { name: 'MainSM', type: 'stateMachine' } },
        }));
        expect(chip.classList.contains('is-visible')).toBe(false);
        expect(controller.getState()).toMatchObject({
            currentFrame: null,
            currentSeconds: null,
            playbackType: 'stateMachine',
            totalFrames: null,
            totalSeconds: null,
        });
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('-- / -- FR');
    });

    it('restores current metrics when the next acknowledged canonical state is an animation', () => {
        const controller = createTimelineProgressController({ root: createFixture() });
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
        expect(document.getElementById('timeline-progress').classList.contains('is-visible')).toBe(true);
        expect(controller.getState()).toMatchObject({
            currentFrame: 9,
            currentSeconds: 0.15,
            playbackType: 'animation',
            totalFrames: 120,
            totalSeconds: 2,
        });
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('9 / 120 FR');
    });

    it('retains a completed timeline chip until an acknowledged state-machine reset, then restores it on the next timeline', () => {
        const controller = createTimelineProgressController({ root: createFixture() });
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
        expect(document.getElementById('timeline-progress').classList.contains('is-visible')).toBe(true);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('60 / 60 FR');
        expect(controller.getState().progress).toBe(1);

        // A real canonical reset target, not a wrapper disappearing, hides
        // the completed timecode.
        emitCanonical({ name: 'TrackMapSM', type: 'stateMachine' });
        expect(document.getElementById('timeline-progress').classList.contains('is-visible')).toBe(false);

        emitCanonical({
            currentFrame: 12,
            currentSeconds: 0.2,
            fps: 60,
            name: 'Focus Fullscreen Mode',
            totalFrames: 60,
            totalSeconds: 1,
            type: 'animation',
        });
        expect(document.getElementById('timeline-progress').classList.contains('is-visible')).toBe(true);
        expect(document.getElementById('timeline-progress-readout').textContent).toBe('12 / 60 FR');
    });
});
