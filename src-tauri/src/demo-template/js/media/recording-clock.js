        // Recording owns advancement. Browser RAF visibility/throttling must not
        // decide which animation frames exist in the saved file.
        function pumpRenderSurfaceRecording() {
            var recording = getRenderSurfaceMediaState().recording;
            if (!recording || !recording.ownsClock) return false;
            if (!recording.ready || recording.stopped || recording.pumping) return true;
            recording.pumping = true;
            var started = performance.now();
            try {
                var fps = recording.options.fps.numerator / recording.options.fps.denominator;
                var elapsed = Math.max(0, (started - recording.start) / 1000);
                var end = recording.stopAt == null ? recording.options.duration_seconds : recording.stopAt;
                var finalCount = end == null ? Infinity : Math.max(1, Math.ceil(end * fps));
                var due = Math.min(Math.floor(elapsed * fps + 1e-7), finalCount - 1);
                // Bounded work per wake-up keeps pointer/UI events responsive.
                // Catch up by rendering each missing simulation frame, never by
                // duplicating an old picture or advancing the SM twice.
                for (var batch = 0; recording.lastIndex < due && batch < 4; batch++) {
                    if (recording.video ? !recording.video.canAccept() : !recording.slots.some(function (slot) { return slot.index === null; })) break;
                    var index = recording.lastIndex + 1;
                    if (recording.schedule) recording.schedule.run(index / fps, index);
                    renderSurfaceAdvanceFrame(riveInstance, index > 0 && riveInstance.isPlaying ? 1 / fps : 0);
                    recordRenderSurfaceMediaFrame(index);
                    recording.maxLagMs = Math.max(recording.maxLagMs || 0, Math.max(0, (performance.now() - recording.start) - index * 1000 / fps));
                    if (recording.error || performance.now() - started >= 8) break;
                }
                if (recording.lastIndex + 1 >= finalCount) {
                    recording.stopped = true;
                    if (recording.stopAt == null) window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
                } else if (recording.lastIndex < due && !recording.pendingWake) {
                    recording.pendingWake = setTimeout(function () {
                        recording.pendingWake = null;
                        if (getRenderSurfaceMediaState().recording === recording) pumpRenderSurfaceRecording();
                    }, 1);
                }
            } catch (error) {
                recording.error = error; recording.stopped = true;
                window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
            } finally { recording.pumping = false; }
            return true;
        }
