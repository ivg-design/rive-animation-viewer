        // Recording owns advancement. The loop schedules itself: it renders
        // simulation frames, hands each to the capture pipeline, and yields to
        // the compositor between batches so the visible canvas presents every
        // frame it can. External wake-ups (runtime RAF, native ticks) are only
        // kicks that end a wait early; they never run capture work themselves,
        // so a backlog of wake-ups can no longer starve rendering updates.
        //
        // Clock modes:
        //   live    - simulation frames are due by wall time; catch-up renders
        //             each missing frame and lag is reported.
        //   offline - every frame is due immediately; the timeline is exact and
        //             wall time never matters. Requires a duration or stop.
        // A batch may run past one display period; the yield after it still
        // presents every frame drawn since the last one. Live keeps the preview
        // close to real time, offline favours throughput.
        var MEDIA_RECORDING_BATCH_BUDGET_MS = { live: 14, offline: 24 };
        var MEDIA_RECORDING_PRESENTATION_TIMEOUT_MS = 50;

        function settleRenderSurfaceRecordingDrain(recording, error) {
            var drain = recording && recording.stopDrain;
            if (!drain || drain.settled) return;
            drain.settled = true;
            if (drain.timeout) clearTimeout(drain.timeout);
            if (error) drain.reject(error); else drain.resolve();
        }

        function createRenderSurfaceRecordingLoop(recording) {
            var waiting = null, running = false;
            function kick() {
                if (!waiting) return false;
                var resolve = waiting; waiting = null;
                resolve('kick');
                return true;
            }
            function wait(ms) {
                return new Promise(function (resolve) {
                    var timer = setTimeout(function () { if (waiting === done) waiting = null; resolve('timeout'); }, ms);
                    function done(reason) { clearTimeout(timer); resolve(reason); }
                    waiting = done;
                });
            }
            function macrotaskYield() {
                return new Promise(function (resolve) {
                    var channel = new MessageChannel();
                    channel.port1.onmessage = function () { channel.port1.close(); resolve('task'); };
                    channel.port2.postMessage(0);
                });
            }
            function yieldForPresentation() {
                if (typeof document === 'undefined' || document.hidden || typeof requestAnimationFrame !== 'function') return macrotaskYield();
                return new Promise(function (resolve) {
                    var settled = false;
                    var frameId = requestAnimationFrame(function () {
                        if (settled) return;
                        settled = true; clearTimeout(timer); resolve('raf');
                    });
                    var timer = setTimeout(function () {
                        if (settled) return;
                        settled = true;
                        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId);
                        resolve('timeout');
                    }, MEDIA_RECORDING_PRESENTATION_TIMEOUT_MS);
                });
            }
            function isCurrent() {
                return getRenderSurfaceMediaState().recording === recording && !recording.stopped && !recording.error;
            }
            function fpsOf() { return recording.options.fps.numerator / recording.options.fps.denominator; }
            function mode() { return recording.options.clock === 'offline' ? 'offline' : 'live'; }
            function finalCount() {
                var end = recording.stopAt == null ? recording.options.duration_seconds : recording.stopAt;
                return end == null ? Infinity : Math.max(1, Math.ceil(end * fpsOf()));
            }
            function dueIndex(now) {
                var final = finalCount();
                if (mode() === 'offline') return final - 1;
                var elapsed = Math.max(0, (now - recording.start) / 1000);
                return Math.min(Math.floor(elapsed * fpsOf() + 1e-7), final - 1);
            }
            function complete() {
                recording.stopped = true;
                settleRenderSurfaceRecordingDrain(recording);
                if (recording.stopAt == null) window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
            }
            function abort(error) {
                recording.error = error; recording.stopped = true;
                settleRenderSurfaceRecordingDrain(recording, error);
                window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
            }
            function renderFrame(index) {
                var fps = fpsOf();
                if (recording.schedule) recording.schedule.run(index / fps, index);
                renderSurfaceAdvanceFrame(riveInstance, index > 0 && riveInstance.isPlaying ? 1 / fps : 0);
                recordRenderSurfaceMediaFrame(index);
                if (mode() === 'live') {
                    recording.maxLagMs = Math.max(recording.maxLagMs || 0,
                        Math.max(0, (performance.now() - recording.start) - index * 1000 / fps));
                }
            }
            async function run() {
                if (running) return;
                running = true;
                try {
                    while (isCurrent()) {
                        if (recording.lastIndex + 1 >= finalCount()) { complete(); break; }
                        var due = dueIndex(performance.now());
                        if (recording.lastIndex >= due) {
                            // Live mode: sleep until the next frame boundary, or a kick.
                            var next = ((recording.lastIndex + 1) * 1000 / fpsOf()) - (performance.now() - recording.start);
                            await wait(Math.max(1, Math.min(250, Math.ceil(next))));
                            continue;
                        }
                        if (!recording.pipeline.canAccept()) {
                            await recording.pipeline.whenReady();
                            continue;
                        }
                        var started = performance.now(), previousIndex = recording.lastIndex, budget = MEDIA_RECORDING_BATCH_BUDGET_MS[mode()];
                        while (isCurrent() && recording.lastIndex < due && recording.pipeline.canAccept()) {
                            renderFrame(recording.lastIndex + 1);
                            if (performance.now() - started >= budget) break;
                        }
                        if (recording.stopAt != null && recording.lastIndex !== previousIndex) {
                            if (recording.stopDrain && recording.stopDrain.arm) recording.stopDrain.arm();
                            if (recording.stopProgress) recording.stopProgress();
                        }
                        if (recording.lastIndex + 1 >= finalCount()) { complete(); break; }
                        await yieldForPresentation();
                    }
                } catch (error) {
                    if (getRenderSurfaceMediaState().recording === recording) abort(error);
                } finally { running = false; }
            }
            return { kick: kick, run: run, isRunning: function () { return running; } };
        }

        // Wake-up entry used by the runtime RAF wrapper and native ticks. It
        // never renders; it only ends the loop's current wait early.
        function pumpRenderSurfaceRecording() {
            var recording = getRenderSurfaceMediaState().recording;
            if (!recording || !recording.ownsClock) return false;
            if (recording.loop) {
                recording.loop.kick();
                if (recording.ready && !recording.stopped && !recording.loop.isRunning()) recording.loop.run();
            }
            return true;
        }
