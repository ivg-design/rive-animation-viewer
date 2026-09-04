import { isBusyJob, isRecording } from './model.js';

function describeWarnings(job) {
    const warnings = [...new Set((job.warnings || []).filter((warning) => typeof warning === 'string').map((warning) => warning.trim()).filter(Boolean))];
    // These two legacy sources describe the same capture-quality issue. Do not
    // add their counts: backpressure events are not presentation-frame counts.
    const isFrameHold = (warning) => /capture frames were held due to encoder backpressure|presentation frames hold preceding captures/i.test(warning);
    const total = job.frame_count, received = job.received_frames;
    const held = Math.max(Number(job.resolved_settings?.capture_receipt?.repeated_frames) || 0, ['encoding', 'completed'].includes(job.state)
        && Number.isInteger(total) && Number.isInteger(received) && received > 0 && total > received
        ? total - received : 0);
    const quality = held > 0 || warnings.some(isFrameHold)
        ? `Capture quality: ${held ? `${held.toLocaleString()} of ${total.toLocaleString()} frames repeat earlier captures` : 'Some frames repeat earlier captures'}. Motion may be less smooth. Try a lower FPS or smaller dimensions.`
        : '';
    return [quality, ...warnings.filter((warning) => !isFrameHold(warning))].filter(Boolean);
}

export function describeJob(job) {
    if (!job || job.state === 'idle') return { text: '', progress: null, details: '', warnings: [] };
    const frames = job.captured_frames ?? job.received_frames ?? 0;
    const total = job.frame_count || job.resolved_settings?.frame_count;
    const fraction = Number(job.progress);
    const progress = job.stage === 'draining' ? null : job.state === 'completed' ? 1
        : job.state === 'capturing' ? (!job.recording && total > 0 ? Math.min(1, frames / total) : null)
            : job.progress != null && Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null;
    const text = job.state === 'capturing' ? `${job.recording ? 'Recording' : 'Capturing'} · ${frames} frames`
        : ({ preparing: 'Preparing capture…', encoding: ({ draining: 'Finishing capture…', preparing: 'Preparing frames…', verifying: 'Verifying export…', publishing: 'Saving export…' }[job.stage] || (job.resolved_settings?.capture_codec ? 'Finalizing video…' : 'Encoding…')), completed: 'Export complete',
            cancelled: 'Export cancelled', failed: 'Export failed' }[job.state] || job.state);
    const settings = job.resolved_settings;
    const dimensions = settings?.width && settings?.height ? `${settings.width} × ${settings.height} px` : '';
    const capture = settings?.capture_transport === 'webcodecs-binary' ? `Video capture: ${String(settings.capture_codec).toUpperCase()} · hardware preferred` : '';
    const timing = Number.isFinite(settings?.encode_seconds) && Number.isFinite(settings?.verify_seconds)
        ? `Finalization ${settings.encode_seconds.toFixed(1)}s · verification ${settings.verify_seconds.toFixed(1)}s` : '';
    const details = [dimensions, capture, timing, job.actual_bytes != null && `${Number(job.actual_bytes).toLocaleString()} bytes`, job.output_path, settings?.recovery_spool && `Recovery capture: ${settings.recovery_spool}`].filter(Boolean).join('\n');
    return { text, progress, details, error: job.error || '', warnings: describeWarnings(job) };
}

export function createMediaJobPresentation({ documentRef, anchor, statusAnchor, onStop }) {
    const root = documentRef.createElement('span');
    root.className = 'media-recording-badge'; root.hidden = true;
    root.innerHTML = '<button type="button" class="btn media-stop" aria-label="Stop recording (Cmd or Ctrl Shift R)">■ STOP</button>';
    anchor?.insertAdjacentElement('beforebegin', root);
    const stop = root.querySelector('.media-stop');
    stop.addEventListener('click', onStop);

    const footer = documentRef.createElement('span');
    footer.className = 'media-statusbar'; footer.hidden = true;
    footer.innerHTML = '<span class="media-job-status" role="status" aria-live="polite" aria-atomic="true"></span><progress class="media-progress" max="1" aria-label="Export progress"></progress><span class="media-job-percent" aria-hidden="true"></span>';
    const info = statusAnchor || documentRef.getElementById('info');
    info?.insertAdjacentElement('beforebegin', footer);
    const strip = info?.closest('.runtime-strip');
    const label = footer.querySelector('.media-job-status');
    const progress = footer.querySelector('progress'), percent = footer.querySelector('.media-job-percent');
    return {
        render(job, pending = false) {
            root.hidden = !isRecording(job); stop.disabled = pending;
            const busy = isBusyJob(job), display = describeJob(job);
            footer.hidden = !busy;
            // The normal playback status continues updating underneath and is
            // restored immediately at completion, failure or cancellation.
            strip?.classList.toggle('media-busy', busy);
            const text = busy ? display.text : '';
            if (label.textContent !== text) label.textContent = text;
            if (display.progress == null) progress.removeAttribute('value');
            else progress.value = display.progress;
            const value = busy && display.progress != null ? `${Math.round(display.progress * 100)}%` : '';
            if (percent.textContent !== value) percent.textContent = value;
        },
        dispose() { strip?.classList.remove('media-busy'); root.remove(); footer.remove(); },
    };
}
