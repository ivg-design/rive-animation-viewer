// Live input uses the same frame-start clock as scripted interactions. The
// queue owns no timer and never advances the player. Pending input is bounded;
// overflow fails the take explicitly instead of silently losing clicks.
function createRenderSurfaceLiveInput(recording) {
    var player = riveInstance, vm = player.viewModelInstance;
    var target = JSON.stringify(window.__ravRenderSurfaceTarget || {});
    var session = typeof renderSurfaceSessionId === 'undefined' ? null : renderSurfaceSessionId;
    var pending = [], accepted = 0, applied = 0, sealed = false, disposed = false, replaying = false;
    var lateInputs = 0, maxLateMs = 0, previousPointer = null, interpolated = 0;
    var receipts = [], lastFrame = -1, lastAcceptedFrame = -1, listeners = [], error = null;
    var fps = recording.options.fps.numerator / recording.options.fps.denominator;
    function current() {
        if (getRenderSurfaceMediaState().recording !== recording || riveInstance !== player
            || (typeof renderSurfaceSessionId !== 'undefined' && session !== renderSurfaceSessionId)
            || player.viewModelInstance !== vm || JSON.stringify(window.__ravRenderSurfaceTarget || {}) !== target) {
            throw new Error('Live recording input source changed.');
        }
    }
    function status() {
        return { mode: 'timestamped', accepted: accepted, applied: applied, pending: pending.length,
            sealed: sealed, cancelled: disposed, error: error, receipts: receipts.slice(),
            late_inputs: lateInputs, max_late_ms: maxLateMs, input_latency_window_ms: 100, interpolated_moves: interpolated,
            receipts_truncated: Math.max(0, applied - receipts.length) };
    }
    function inputSeconds(timestamp) {
        var now = performance.now();
        // DOM event.timeStamp uses this document's performance origin. Epoch
        // timestamps from older WebKit are normalized to that origin.
        if (timestamp > 1e12 && Number.isFinite(performance.timeOrigin)) timestamp -= performance.timeOrigin;
        if (!Number.isFinite(timestamp) || timestamp < recording.start || timestamp > now) timestamp = now;
        return Math.max(0, (timestamp - recording.start) / 1000);
    }
    function enqueue(operation, timestamp) {
        current();
        if (disposed || replaying) return null;
        if (sealed || recording.stopped || !recording.ready) throw new Error('Live recording input is closed.');
        var seconds = inputSeconds(timestamp);
        if (recording.options.duration_seconds != null && seconds >= recording.options.duration_seconds) {
            throw new Error('Live recording input is past the recording duration.');
        }
        if (pending.length >= 16384) {
            error = 'Live recording input backlog exceeded 16384 events; the take stopped without dropping input silently.';
            recording.error = new Error(error); recording.stopped = true;
            settleRenderSurfaceRecordingDrain(recording, recording.error);
            window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
            throw recording.error;
        }
        var requestedFrame = Math.ceil(seconds * fps - 1e-7);
        var frame = Math.max(lastFrame + 1, requestedFrame), late = frame > requestedFrame;
        var latenessMs = late ? Math.max(0, frame / fps - seconds) * 1000 : 0;
        // Normal IPC/DOM delivery has a bounded capture latency window. Input
        // beyond it remains usable; never abort a take merely for a late move.
        if (late) { lateInputs++; maxLateMs = Math.max(maxLateMs, latenessMs); }
        var entry = { operation: operation, index: accepted++, frame: frame, seconds: seconds, late: late, latenessMs: latenessMs };
        pending.push(entry); pending.sort(function (a, b) { return a.frame - b.frame || a.index - b.index; });
        lastAcceptedFrame = Math.max(lastAcceptedFrame, frame);
        return { queued: true, dispatched: false, input_index: entry.index, frame_index: frame, at_seconds: seconds, late: late, lateness_ms: latenessMs };
    }
    function run(frame) {
        current(); lastFrame = frame;
        while (!disposed && pending.length && pending[0].frame <= frame) {
            var entry = pending.shift(), op = entry.operation;
            replaying = true;
            try {
                if (op.type === 'pointer') { dispatchRenderSurfacePointer(op.payload, true); previousPointer = entry; }
                else {
                    previousPointer = null;
                    // Resolve by path at application time: list descendants may
                    // have changed since acceptance. Never retain a WASM handle.
                    var descriptor = op.descriptor, accessor = resolveControlAccessor(descriptor);
                    if (!accessor) throw new Error('Live recording control is unavailable: ' + descriptor.path);
                    if (descriptor.kind === 'enum') {
                        var choices = readEnumValues(accessor);
                        if (choices.length && choices.indexOf(op.value) < 0) throw new Error('Live recording enum value is unavailable.');
                    }
                    if (descriptor.kind === 'trigger' && player.isPlaying === false) player.play();
                    setRenderSurfaceAccessorValue(accessor, descriptor.kind, op.value);
                    if (descriptor.kind === 'trigger') recordRenderSurfaceTriggerReceipt(descriptor);
                }
                applied++;
                receipts.push({ index: entry.index, type: op.type, event: op.payload && op.payload.type,
                    at_seconds: entry.seconds, frame_index: frame, applied_seconds: frame / fps,
                    late: entry.late, lateness_ms: entry.latenessMs });
                if (receipts.length > 512) receipts.shift();
            } catch (failure) { error = String(failure.message || failure); throw failure; }
            finally { replaying = false; }
        }
        // Sample the continuous path at each video frame. Never interpolate
        // across a down/up/exit boundary or before the first accepted move.
        var nextPointer = pending[0] && pending[0].operation.type === 'pointer' ? pending[0] : null;
        var previous = previousPointer && previousPointer.operation.payload;
        var next = nextPointer && nextPointer.operation.payload;
        var seconds = frame / fps;
        if (!disposed && previous && next && previous.type === 'move' && next.type === 'move'
            && (previous.x !== next.x || previous.y !== next.y)
            && (previous.buttons || 0) === (next.buttons || 0) && (previous.id || 0) === (next.id || 0)
            && seconds > previousPointer.seconds && seconds < nextPointer.seconds) {
            var fraction = (seconds - previousPointer.seconds) / (nextPointer.seconds - previousPointer.seconds);
            replaying = true;
            try {
                dispatchRenderSurfacePointer({ ...previous,
                    x: previous.x + (next.x - previous.x) * fraction,
                    y: previous.y + (next.y - previous.y) * fraction }, true);
                interpolated++;
            } finally { replaying = false; }
        }
    }
    function seal(count) {
        sealed = true;
        // A frame already handed to capture cannot be rewritten. Retain a final
        // boundary frame when input arrived in its partial interval.
        return Math.max(count, lastAcceptedFrame + 1);
    }
    function pointer(event) {
        if (replaying || disposed) return;
        event.stopImmediatePropagation(); event.preventDefault();
        if (sealed || recording.stopped || !recording.ready
            || (recording.options.duration_seconds != null && inputSeconds(event.timeStamp) >= recording.options.duration_seconds)) return;
        var rect = els.canvas.getBoundingClientRect();
        var type = { mousedown: 'down', mousemove: 'move', mouseup: 'up', mouseout: 'exit' }[event.type];
        try {
            enqueue({ type: 'pointer', payload: { type: type,
                x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
                button: event.button, buttons: event.buttons, id: 0 } }, event.timeStamp);
        } catch (failure) {
            if (recording.error) return;
            recording.error = failure; recording.stopped = true;
            settleRenderSurfaceRecordingDrain(recording, failure);
            window.__ravRenderSurfaceEmit('render-surface:media-ended', { capture_id: recording.id });
        }
    }
    ['mousedown', 'mousemove', 'mouseup', 'mouseout'].forEach(function (type) {
        els.canvas.addEventListener(type, pointer, true); listeners.push(type);
    });
    return { enqueue: enqueue, run: run, seal: seal, status: status,
        minimumFrameCount: function () { return lastAcceptedFrame + 1; },
        isReplaying: function () { return replaying; },
        replay: function (apply) { var previous = replaying; replaying = true;
            try { return apply(); } finally { replaying = previous; } },
        dispose: function () {
            if (disposed) return;
            disposed = true; sealed = true; pending.length = 0;
            listeners.forEach(function (type) { els.canvas.removeEventListener(type, pointer, true); });
        } };
}

function queueRenderSurfaceLiveVmInput(type, payload, timestamp) {
    var recording = getRenderSurfaceMediaState().recording;
    if (!recording || !recording.liveInput || recording.liveInput.isReplaying()) return null;
    var descriptor = payload.descriptor || payload;
    if (descriptor.kind === 'image') throw new Error('Use a prepared interaction schedule for image changes during recording.');
    var operation = RavMediaInteractions.validate([{ at_seconds: 0,
        type: type === 'vm-fire' ? 'vm-trigger' : 'vm-set',
        descriptor: { source: descriptor.source || 'view-model', path: descriptor.path,
            kind: type === 'vm-fire' ? 'trigger' : descriptor.kind,
            ...(descriptor.source === 'global-view-model' ? { globalViewModelName: descriptor.globalViewModelName } : {}) },
        ...(type === 'vm-fire' ? {} : { value: renderSurfaceCommandValue(payload, descriptor) }) }])[0];
    return recording.liveInput.enqueue(operation, timestamp);
}

function renderSurfaceRecordingClock(recording) {
    var offline = recording.options.clock === 'offline';
    var lag = offline ? 0 : Math.max(0, (recording.stopAt == null ? performance.now() - recording.start : recording.stopAt * 1000)
        - (recording.lastIndex + 1) * 1000 * recording.options.fps.denominator / recording.options.fps.numerator);
    return { mode: recording.ownsClock ? (offline ? 'offline' : 'fixed-step') : 'presentation', lag_ms: lag,
        max_lag_ms: offline ? 0 : (recording.maxLagMs || 0), sustained_lag: Boolean(recording.lagWarning),
        input_timing: recording.liveInput ? 'timestamped' : 'scheduled' };
}

function publishRenderSurfaceRecordingProgress(recording) {
    if (!recording.ownsClock || !recording.ready || getRenderSurfaceMediaState().recording !== recording) return;
    var now = performance.now(), clock = renderSurfaceRecordingClock(recording);
    if (clock.lag_ms >= 500) {
        if (recording.lagSince == null) recording.lagSince = now;
        if (now - recording.lagSince >= 1000) recording.lagWarning = true;
    } else if (clock.lag_ms <= 250) { recording.lagSince = null; recording.lagWarning = false; }
    clock.sustained_lag = Boolean(recording.lagWarning);
    if (recording.progressAt != null && now - recording.progressAt < 500 && recording.publishedLagWarning === clock.sustained_lag) return;
    recording.progressAt = now; recording.publishedLagWarning = clock.sustained_lag;
    Promise.resolve(window.__ravRenderSurfaceEmit('render-surface:media-progress', {
        capture_id: recording.id, capture_clock: clock,
        live_input: recording.liveInput ? recording.liveInput.status() : null,
    })).catch(function () {});
}
