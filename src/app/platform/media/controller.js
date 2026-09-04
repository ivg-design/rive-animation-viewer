import { validateRecordingInteractions } from './interaction-validation.js';
import { frameTime, resolveMediaOptions } from './options.js';

export function createMediaExportController({ getTauriInvoker, getTauriEventListener, renderSurfaceController,
    getControlSnapshot = () => [], onChange = () => {}, windowRef = globalThis.window } = {}) {
    const jobs = new Map();
    let current = null, listenerPromise = null, recordingWrite = Promise.resolve();
    const invoke = (command, request) => {
        const fn = getTauriInvoker?.();
        if (!fn) throw new Error('Media export is available only in desktop RAV.');
        return Promise.resolve(fn(command, request == null ? {} : { request })).catch((error) => {
            throw error instanceof Error ? error : new Error(String(error));
        });
    };
    const emit = (job) => { onChange(publicJob(job)); windowRef?.dispatchEvent?.(new CustomEvent('rav:media-status', { detail: publicJob(job) })); };
    function publicJob(job) {
        if (!job) return null;
        const { id, state, native, error, source_session, recording, resolved_settings, warnings, captured_frames, interaction_schedule } = job;
        return { job_id: id, state, recording, source_session, resolved_settings, warnings, captured_frames, interaction_schedule,
            ...(native || {}), job_id: id, state, warnings: [...new Set([...(warnings || []), ...(native?.warnings || [])])],
            resolved_settings: { ...(resolved_settings || {}), ...(native?.resolved_settings || {}) },
            ...(error ? { error } : {}),
            ...(job.draining && state === 'capturing' ? { state: 'encoding', stage: 'draining' } : {}) };
    }
    function sourceSession() { return renderSurfaceController.getState()?.activeSessionId; }
    async function command(job, type, payload = {}) {
        if (sourceSession() !== job.source_session) throw new Error('Capture source changed. Start a new export.');
        const response = await renderSurfaceController.requestActiveCommand(type, payload);
        if (sourceSession() !== job.source_session) throw new Error('Capture source changed before the frame was acknowledged.');
        if (!response?.applied) throw new Error(response?.error || response?.message || response?.reason || `Renderer rejected ${type}.`);
        return response.result;
    }
    async function fail(job, error) {
        if (job.state !== 'cancelled') job.state = 'failed';
        job.error = String(error.message || error);
        if (current === job) current = null;
        // Dispose capture immediately. Failure is different from the user's
        // explicit Cancel: acknowledged native data must survive for recovery.
        if (sourceSession() === job.source_session) await command(job, job.recording ? 'media-record-abort' : 'media-close', job.recording ? { capture_id: job.id } : {}).catch(() => {});
        if (job.native?.job_id) {
            try { job.native = await invoke(job.state === 'cancelled' ? 'media_export_cancel' : 'media_export_abort',
                { job_id: job.native.job_id, ...(job.state === 'cancelled' ? {} : { error: job.error.slice(0, 4096) }) }); }
            catch (failure) { (job.warnings ||= []).push(`Could not retain recovery receipt: ${String(failure.message || failure)}`); }
        }
        emit(job);
    }
    async function ensureListeners() {
        if (listenerPromise) return listenerPromise;
        listenerPromise = (async () => {
            const listen = await getTauriEventListener();
            if (!listen) throw new Error('Desktop recording events are unavailable.');
            await listen('render-surface:media-frame', ({ payload }) => {
                const job = current;
                if (!job?.recording || payload.sessionId !== job.source_session || payload.capture_id !== job.id) return;
                recordingWrite = recordingWrite.then(async () => {
                    if (job.state !== 'capturing') return;
                    await invoke('media_export_frame', { job_id: job.native.job_id,
                        frame_index: payload.frame_index, png_base64: payload.png_base64 });
                    job.captured_frames += 1;
                    await command(job, 'media-record-ack', { capture_id: job.id, frame_index: payload.frame_index });
                    emit(job);
                }).catch((error) => fail(job, error));
            });
            await listen('render-surface:media-ended', ({ payload }) => {
                if (current?.id === payload.capture_id && current.source_session === payload.sessionId) void stopRecording().catch(() => {});
            });
            await listen('render-surface:media-shortcut', ({ payload }) => {
                if (payload.sessionId === sourceSession()) windowRef?.dispatchEvent?.(new CustomEvent('rav:media-toggle-recording'));
            });
        })();
        return listenerPromise;
    }
    async function begin(input, recording) {
        if (recording) input = validateRecordingInteractions(input);
        if (current) throw new Error('Finish or cancel the current capture first.');
        const session = sourceSession();
        if (!session) throw new Error('Load a Rive file first.');
        const job = { id: crypto.randomUUID(), source_session: session, recording, state: 'preparing', captured_frames: 0 };
        current = job; jobs.set(job.id, job);
        if (jobs.size > 20) jobs.delete(jobs.keys().next().value);
        try {
            const info = await command(job, 'media-info');
            const capabilities = await invoke('media_export_capabilities');
            if (current !== job || job.state === 'cancelled') throw new Error('Capture cancelled.');
            const options = resolveMediaOptions(input, info, recording, capabilities.limits);
            if (recording && info.playback?.type !== 'stateMachine') throw new Error('Select a state machine to record.');
            if (recording) Object.assign(options, await command(job, 'media-record-config', options));
            const { interactions, ...resolved } = options;
            job.resolved_settings = resolved; job.warnings = options.warnings;
            const { formats } = capabilities;
            const capability = formats.find((item) => item.id === options.format);
            if (!capability?.available) throw new Error(capability?.reason || 'Requested encoder is unavailable.');
            const { format, width, height, fps, output_path, overwrite, alpha, background, quality, gif } = options;
            job.native = await invoke('media_export_begin', { format, width, height, fps, output_path, overwrite,
                alpha, background, quality, gif, source_identity: info.sourceIdentity ?? null,
                source_session: session, max_frames: capabilities.limits.max_frames, capture_codec: options.capture_codec || null });
            if (current !== job || job.state === 'cancelled') throw new Error('Capture cancelled.');
            job.state = 'capturing';
            if (recording) {
                await ensureListeners();
                await command(job, 'media-record-start', { ...options, capture_id: job.id, native_job_id: job.native.job_id });
            } else {
                await command(job, 'media-open', { ...options, snapshot: getControlSnapshot() });
            }
            emit(job); return job;
        } catch (error) { await fail(job, error); throw error; }
    }
    async function finish(job, count) {
        job.native = await invoke('media_export_finish', { job_id: job.native.job_id, frame_count: count });
        job.state = job.native.state;
        if (current === job) current = null;
        emit(job); return publicJob(job);
    }
    async function exportMedia(input) {
        const job = await begin(input, false);
        void (async () => {
            try {
                const options = job.resolved_settings;
                for (let index = 0; index < options.frame_count; index++) {
                    if (job.state !== 'capturing') return;
                    const frame = await command(job, 'media-frame', { frame_index: index, seconds: frameTime(options, index) });
                    if (job.state !== 'capturing') return;
                    const receipt = await invoke('media_export_frame', { job_id: job.native.job_id, frame_index: frame.frame_index, png_base64: frame.png_base64 });
                    if (receipt.resolved_settings?.stop_reason === 'disk_space') {
                        job.native = receipt;
                        await command(job, 'media-close');
                        await finish(job, receipt.resolved_settings.accepted_frame_count);
                        return;
                    }
                    job.captured_frames = index + 1; emit(job);
                }
                await command(job, 'media-close');
                await finish(job, options.frame_count);
            } catch (error) { if (job.state !== 'cancelled') await fail(job, error); }
        })();
        return publicJob(job);
    }
    async function startRecording(input) { return publicJob(await begin(input, true)); }
    function stopRecording() {
        const job = current;
        if (!job?.recording) return Promise.reject(new Error('No recording is active.'));
        if (!job.stopping) {
            job.draining = true;
            job.stopping = stopJob(job).finally(() => { job.draining = false; });
            job.stopping.catch(() => {}); // Failure is retained in job status.
            emit(job);
        }
        // Stop is an asynchronous job operation, like native finalization. MCP
        // and UI must remain responsive while all accepted frames are drained.
        return Promise.resolve(publicJob(job));
    }
    async function stopJob(job) {
        try {
            const receipt = await command(job, 'media-record-stop');
            await recordingWrite;
            if (job.state === 'cancelled') return publicJob(job);
            if (job.state === 'failed') throw new Error(job.error);
            // Native frame_count - received_frames is the single authoritative
            // quality count, including the final interval. Encoding happens later.
            if (receipt.interactions) job.interaction_schedule = receipt.interactions;
            if (receipt.clock) job.resolved_settings.capture_clock = receipt.clock;
            if (receipt.stop_reason) {
                job.resolved_settings.stop_reason = receipt.stop_reason;
                job.warnings.push('Recording reached the disk-space reserve; the captured portion was saved.');
            }
            if (receipt.video) {
                job.resolved_settings.capture_receipt = receipt.video;
                if (receipt.video.repeated_frames) job.warnings.push(`${receipt.video.repeated_frames} presentation frames hold preceding captures; duration is preserved.`);
            }
            return await finish(job, receipt.frame_count);
        } catch (error) { await fail(job, error); throw error; }
    }
    async function status(id) {
        const job = id ? jobs.get(id) || [...jobs.values()].find((j) => j.native?.job_id === id) : current || [...jobs.values()].at(-1);
        if (!job) return { state: 'idle' };
        // A source replacement can race or suppress the animation-loaded
        // notification. Polling must still terminate the old capture promptly;
        // otherwise its renderer events are ignored and the native job can sit
        // frozen until the idle watchdog expires.
        if (['preparing', 'capturing'].includes(job.state) && sourceSession() !== job.source_session) {
            await fail(job, new Error('Capture stopped because the source or playback selection changed.'));
            return publicJob(job);
        }
        if (job.native && !['failed', 'cancelled'].includes(job.state)) {
            job.native = await invoke('media_export_status', { job_id: job.native.job_id });
            if (job.recording && job.native.received_frames != null) job.captured_frames = job.native.received_frames;
            if (job.recording && job.state === 'capturing' && !job.draining && sourceSession() === job.source_session) {
                const recordingStatus = await command(job, 'media-record-status');
                if (recordingStatus?.interaction_schedule) job.interaction_schedule = recordingStatus.interaction_schedule;
                if (recordingStatus?.capture_clock) job.resolved_settings.capture_clock = recordingStatus.capture_clock;
            }
            if (job.state !== 'capturing') job.state = job.native.state;
            else if (['failed', 'cancelled'].includes(job.native.state)) {
                await fail(job, new Error(job.native.error || 'The native capture ended before all frames were received.'));
            }
        }
        return publicJob(job);
    }
    async function cancel(id) {
        const job = id ? jobs.get(id) || [...jobs.values()].find((j) => j.native?.job_id === id) : current || [...jobs.values()].at(-1);
        if (!job) return { state: 'idle' };
        if (['completed', 'failed', 'cancelled'].includes(job.state)) return publicJob(job);
        job.state = 'cancelled';
        if (sourceSession() === job.source_session) await command(job, job.recording ? 'media-record-abort' : 'media-close', job.recording ? { capture_id: job.id } : {}).catch(() => {});
        await recordingWrite;
        if (job.native) { job.native = await invoke('media_export_cancel', { job_id: job.native.job_id }); job.state = job.native.state; }
        if (current === job) current = null;
        emit(job); return publicJob(job);
    }

    async function chooseOutputPath(options) {
        return invoke('media_export_choose_path', options);
    }
    windowRef?.document?.addEventListener?.('rav:animation-loaded', () => {
        if (current) void fail(current, new Error('Capture stopped because the source or playback selection changed.'));
    });
    return { setup: ensureListeners, capabilities: () => invoke('media_export_capabilities'), chooseOutputPath,
        exportMedia, startRecording, stopRecording, status, cancel,
        stepFrames: (options) => command({ source_session: sourceSession() }, 'step-frames', options),
        pointer: (options) => command({ source_session: sourceSession() }, 'pointer', options) };
}
