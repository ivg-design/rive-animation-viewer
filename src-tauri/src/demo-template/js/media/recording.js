        function setupRenderSurfaceMediaPointer() {
            var canvas = els.canvas;
            if (!canvas || canvas.__ravMediaPointer) return;
            canvas.__ravMediaPointer = true;
            ['pointermove', 'pointerdown', 'pointerup', 'pointerleave'].forEach(function (type) {
                canvas.addEventListener(type, function (event) {
                    var rect = canvas.getBoundingClientRect();
                    getRenderSurfaceMediaState().cursor = { x: (event.clientX - rect.left) / rect.width,
                        y: (event.clientY - rect.top) / rect.height, inside: type !== 'pointerleave' };
                });
            });
        }

        if (isRenderSurfaceMode) document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey
                || !(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'r') return;
            var path = event.composedPath ? event.composedPath() : [event.target];
            if (path.some(function (node) { return node && (node.isContentEditable || (node.closest && node.closest(
                'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .cm-editor'
            ))); })) return;
            event.preventDefault();
            window.__ravRenderSurfaceEmit('render-surface:media-shortcut', {});
        });

        function dispatchRenderSurfacePointer(payload) {
            // Rive Web attaches mouse/touch listeners, not DOM pointer listeners.
            // Synthetic PointerEvents do not synthesize compatibility MouseEvents.
            var types = { down: 'mousedown', move: 'mousemove', up: 'mouseup', exit: 'mouseout' };
            var type = types[payload.type];
            if (payload.id != null && payload.id !== 0) throw new Error('Mouse interaction uses pointer id 0; multi-touch injection is not supported.');
            if (!type || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)
                || payload.x < 0 || payload.x > 1 || payload.y < 0 || payload.y > 1) throw new Error('Pointer requires type and normalized x/y in 0–1.');
            var rect = els.canvas.getBoundingClientRect();
            getRenderSurfaceMediaState().cursor = { x: payload.x, y: payload.y, inside: payload.type !== 'exit' };
            els.canvas.dispatchEvent(new MouseEvent(type, { bubbles: true,
                clientX: rect.left + payload.x * rect.width, clientY: rect.top + payload.y * rect.height,
                button: 0, buttons: payload.buttons == null ? (payload.type === 'down' ? 1 : 0) : payload.buttons }));
            return { dispatched: true, type: payload.type, x: payload.x, y: payload.y, id: 0 };
        }

        async function startRenderSurfaceRecording(options) {
            var state = getRenderSurfaceMediaState();
            if (state.export || state.recording || state.preparing) throw new Error('A capture is already active.');
            var preparation = { id: options.capture_id, cancelled: false }, schedule = null;
            var cancelled = new Promise(function (_resolve, reject) { preparation.cancel = function () {
                preparation.cancelled = true; if (preparation.dispose) preparation.dispose(); reject(new Error('Recording preparation was cancelled.'));
            }; });
            cancelled.catch(function () {});
            state.preparing = preparation;
            try {
                schedule = options.interactions && options.interactions.length ? await Promise.race([
                    prepareRenderSurfaceInteractionSchedule(options.interactions, options, function () { return !preparation.cancelled; }, function (dispose) { preparation.dispose = dispose; }), cancelled,
                ]) : null;
                if (preparation.cancelled) throw new Error('Recording preparation was cancelled.');
                return await initializeRenderSurfaceRecording(options, schedule);
            } catch (error) {
                try { abortRenderSurfaceRecording(options.capture_id); } catch (_) {}
                if (schedule) schedule.dispose();
                throw error;
            } finally { if (state.preparing === preparation) state.preparing = null; }
        }

        function advanceMediaRecordingInteractions() {
            var recording = getRenderSurfaceMediaState().recording;
            if (!recording || !recording.ready || recording.stopped || !recording.schedule) return false;
            var elapsed = Math.max(0, (performance.now() - recording.start) / 1000);
            if (recording.options.duration_seconds && elapsed >= recording.options.duration_seconds) return false;
            try {
                return recording.schedule.run(elapsed, Math.floor(elapsed * recording.options.fps.numerator / recording.options.fps.denominator + 0.5)).length > 0;
            } catch (error) {
                recording.error = error; recording.stopped = true;
                window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
                return false;
            }
        }

        async function initializeRenderSurfaceRecording(options, schedule) {
            var state = getRenderSurfaceMediaState();
            if (state.export || state.recording) throw new Error('A capture is already active.');
            if ((window.__ravRenderSurfaceTarget || {}).type !== 'stateMachine') throw new Error('Recording requires a state machine.');
            setupRenderSurfaceMediaPointer();
            state.recording = { id: options.capture_id, options: options, start: performance.now(),
                lastIndex: -1, dropped: 0, stopped: false, ready: false, ownsClock: Boolean(options.native_job_id), delivery: Promise.resolve(), schedule: schedule,
                slots: options.capture_codec ? [] : createMediaRecordingSlots(Boolean(options.native_job_id)),
                transport: options.native_job_id && !options.capture_codec ? createMediaBinaryTransport(options.native_job_id) : null };
            if (options.capture_codec) state.recording.video = createMediaVideoWriter(options, function (error) {
                if (!state.recording || state.recording.id !== options.capture_id) return;
                state.recording.error = error; state.recording.stopped = true;
                window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: options.capture_id });
            });
            handleResize();
            var preparing = state.recording;
            renderSurfaceAdvanceFrame(riveInstance, 0);
            if (preparing.video) await preparing.video.warmUp(els.canvas);
            if (state.recording !== preparing || preparing.stopped) throw new Error('Recording preparation was cancelled.');
            preparing.start = performance.now();
            preparing.ready = true;
            if (preparing.ownsClock) pumpRenderSurfaceRecording();
            else {
                advanceMediaRecordingInteractions();
                renderSurfaceAdvanceFrame(riveInstance, 0);
                recordRenderSurfaceMediaFrame();
                if (riveInstance.isPlaying) riveInstance.startRendering();
            }
            return { recording: true, capture_id: options.capture_id };
        }

        function recordRenderSurfaceMediaFrame(explicitIndex) {
            var recording = getRenderSurfaceMediaState().recording;
            if (!recording || !recording.ready || recording.stopped) return;
            if (recording.ownsClock && explicitIndex == null) return;
            if (recording.schedule) recording.schedule.afterFrame();
            var elapsed = Math.max(0, (performance.now() - recording.start) / 1000);
            var options = recording.options;
            if (explicitIndex == null && options.duration_seconds && elapsed >= options.duration_seconds) {
                recording.stopped = true;
                window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
                return;
            }
            var index = explicitIndex == null ? (recording.lastIndex < 0 ? 0 : Math.floor(elapsed * options.fps.numerator / options.fps.denominator + 0.5)) : explicitIndex;
            if (options.duration_seconds) index = Math.min(index, Math.ceil(options.duration_seconds * options.fps.numerator / options.fps.denominator) - 1);
            if (index <= recording.lastIndex) return;
            if (recording.video) {
                try {
                    if (!recording.canvas) recording.canvas = document.createElement('canvas');
                    composeMediaCanvas(els.canvas, options, getRenderSurfaceMediaState().cursor, recording.canvas);
                    recording.video.frame(recording.canvas, index);
                    recording.lastIndex = index;
                } catch (error) {
                    recording.error = error; recording.stopped = true;
                    window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
                }
                return;
            }
            var slot = recording.slots.find(function (entry) { return entry.index === null; });
            if (!slot) return; // Three bounded slots overlap browser compression and native IO.
            if (recording.lastIndex >= 0) recording.dropped += Math.max(0, index - recording.lastIndex - 1);
            recording.lastIndex = index;
            slot.index = index;
            var encoded;
            try { encoded = mediaCanvasPngAsync(els.canvas, options, getRenderSurfaceMediaState().cursor, slot.canvas, slot.encode, Boolean(recording.transport)); }
            catch (error) { encoded = Promise.reject(error); }
            // Attach a rejection handler immediately, including when an older
            // frame is still encoding. Deliver in capture order, not finish order.
            var ready = encoded.then(function (png) { return { png: png }; }, function (error) { return { error: error }; });
            recording.delivery = recording.delivery.then(async function () {
                var frame = await ready;
                if (recording.error) return;
                if (frame.error) throw frame.error;
                if (recording.transport) {
                    await recording.transport.send(index, frame.png);
                    slot.index = null;
                } else await window.__ravRenderSurfaceEmit('render-surface:media-frame', {
                    capture_id: recording.id, frame_index: index, png_base64: frame.png,
                });
            }).catch(function (error) {
                if (getRenderSurfaceMediaState().recording !== recording) return;
                recording.error = error; recording.stopped = true;
                window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
            });
        }

        function abortRenderSurfaceRecording(captureId) {
            var state = getRenderSurfaceMediaState(), recording = state.recording;
            var preparation = state.preparing;
            if (preparation && (!captureId || preparation.id === captureId)) {
                state.preparing = null; preparation.cancel();
            }
            if (!recording) return { recording: false, aborted: true };
            if (captureId && recording.id !== captureId) return { recording: true, aborted: false };
            // Invalidate callbacks before releasing workers/transport. Abort never
            // waits for frame debt or a codec that has stopped responding.
            state.recording = null; recording.stopped = true;
            if (recording.pendingWake) clearTimeout(recording.pendingWake);
            if (recording.video) recording.video.dispose();
            if (recording.transport) recording.transport.cancel();
            recording.slots.forEach(function (slot) { slot.dispose(); });
            if (recording.schedule) recording.schedule.dispose();
            handleResize();
            renderSurfaceAdvanceFrame(riveInstance, 0);
            if (riveInstance.isPlaying) riveInstance.startRendering();
            return { recording: false, aborted: true, capture_id: recording.id };
        }

        async function stopRenderSurfaceRecording() {
            var state = getRenderSurfaceMediaState();
            var recording = state.recording;
            if (!recording) throw new Error('No recording is active.');
            if (!recording.ready) { abortRenderSurfaceRecording(); throw new Error('Recording did not finish preparing.'); }
            var elapsed = (performance.now() - recording.start) / 1000;
            if (recording.options.duration_seconds) elapsed = Math.min(elapsed, recording.options.duration_seconds);
            // Seal the wall-time boundary once; drain pending simulation frames
            // before flushing, including manual stop between native wake-ups.
            if (recording.ownsClock && !recording.error) {
                recording.stopAt = elapsed;
                recording.stopped = false;
                var progressedAt = performance.now(), progressIndex = recording.lastIndex;
                while (!recording.stopped && !recording.error && state.recording === recording) {
                    pumpRenderSurfaceRecording();
                    if (recording.lastIndex !== progressIndex) { progressIndex = recording.lastIndex; progressedAt = performance.now(); }
                    if (performance.now() - progressedAt > 15000) recording.error = new Error('Recording stopped making capture progress. Accepted frames are retained for recovery.');
                    if (!recording.stopped && !recording.error) await new Promise(function (resolve) { setTimeout(resolve, 4); });
                }
                if (state.recording !== recording) throw new Error('Recording was aborted.');
            }
            recording.stopped = true;
            if (recording.pendingWake) clearTimeout(recording.pendingWake);
            var count = Math.max(recording.lastIndex + 1, Math.ceil(elapsed * recording.options.fps.numerator / recording.options.fps.denominator));
            var videoReceipt = null;
            try { if (recording.video && !recording.error) videoReceipt = await recording.video.finish(count); }
            catch (error) { recording.error = error; }
            finally { if (recording.video) recording.video.dispose(); }
            // Finish queued compression/delivery before the host drains native
            // writes. Do not wait for ACK commands queued behind this stop.
            await recording.delivery;
            recording.slots.forEach(function (slot) { slot.dispose(); });
            var interactionReceipt = recording.schedule ? recording.schedule.status() : null;
            if (recording.schedule) recording.schedule.dispose();
            var diskStop = recording.error && recording.error.code === 'disk_space' ? recording.error.receipt : null;
            if (diskStop) { count = diskStop.frame_count; recording.error = null; }
            state.recording = null;
            handleResize();
            renderSurfaceAdvanceFrame(riveInstance, 0);
            if (riveInstance.isPlaying) riveInstance.startRendering();
            if (recording.error) throw recording.error;
            return { recording: false, capture_id: recording.id, elapsed_seconds: elapsed,
                dropped_frames: recording.dropped, video: videoReceipt, interactions: interactionReceipt,
                clock: { mode: recording.ownsClock ? 'fixed-step' : 'presentation', max_lag_ms: recording.maxLagMs || 0 },
                stop_reason: diskStop ? 'disk_space' : null,
                frame_count: Math.max(1, count) };
        }

        // Progress acknowledgements renew only this stop command's inactivity
        // deadline. Rendering debt can drain for any duration while advancing.
        function withRenderSurfaceStopProgress(command, emit, run) {
            var previous = null, revision = 0;
            var timer = setInterval(function () {
                var r = getRenderSurfaceMediaState().recording;
                if (!r) return;
                var value = r.lastIndex + ':' + (r.video && r.video.progress ? r.video.progress() : r.transport && r.transport.progress ? r.transport.progress() : 0);
                if (value === previous) return;
                previous = value;
                emit('render-surface:ack', { commandId: command.commandId, status: 'progress', progress: ++revision });
            }, 1000);
            return Promise.resolve().then(run).finally(function () { clearInterval(timer); });
        }
