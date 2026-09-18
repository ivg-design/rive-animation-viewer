import { changeDraft, createDraft, isBusyJob, isRecording, isSequenceFormat,
    isOutputDirectoryConflict, mediaOptions, needsOutputConfirmation } from './model.js';
import { createMediaJobPresentation } from './status.js';
import { bindRecordingShortcut } from './shortcuts.js';

export function createMediaExportUiController({
    getService = () => globalThis.window?._mcpGetMediaExportController?.(),
    isDesktop = () => false, getSourceInfo = async () => ({}), resolveOptions,
    requestUiOverlay, closeUiOverlay, openHtmlExport, showError = () => {}, elements = {},
    documentRef = globalThis.document, windowRef = globalThis.window,
} = {}) {
    let caps = {}, info = {}, draft = null, view = 'menu', job = null, error = '';
    let pending = false, opened = false, disposed = false, opening = false, afterClose = null;
    let syncTimer = null, badge = null, unbindShortcut = null, installed = false;
    let eventRevision = 0, overlayTop = null, outputConflict = null;
    const dismissedJobIds = new Set();
    const isTerminalJob = (value) => ['completed', 'failed', 'cancelled'].includes(value?.state);
    const service = () => {
        if (!isDesktop()) throw new Error('Media export is available only in desktop RAV.');
        const value = getService();
        if (!value) throw new Error('Media export is not ready.');
        return value;
    };
    function validate() {
        if (!draft) return {};
        try {
            const options = mediaOptions(draft, info, caps);
            const resolved = resolveOptions(options, info, draft.mode === 'record', caps.limits);
            const rate = resolved.fps.numerator / resolved.fps.denominator;
            const count = draft.mode === 'record' ? (resolved.duration_seconds == null
                ? 'manual stop · no time limit'
                : `stops after ${resolved.duration_seconds}s`)
                : draft.mode === 'still' ? 'still image' : `${resolved.frame_count} frames`;
            const preview = `${resolved.width} × ${resolved.height} px · ${draft.mode === 'still' ? '' : `${Number(rate.toFixed(3))} FPS · `}${count}`;
            return { options, resolved, preview };
        } catch (failure) { return { validationError: failure.message || String(failure) }; }
    }
    function getState() {
        const { preview, validationError } = validate();
        return { mediaExport: { view, caps, info, draft, job, error, pending, preview, validationError,
            outputConflict: outputConflict ? { output_path: outputConflict.output_path } : null } };
    }
    function dirty() {
        badge?.render(job, pending);
        if (!opened || syncTimer != null || disposed) return;
        syncTimer = windowRef.setTimeout(() => {
            syncTimer = null;
            if (opened && !disposed) documentRef.dispatchEvent(new windowRef.CustomEvent('rav:ui-overlay-state-dirty', { detail: { purpose: 'export' } }));
        }, 100);
    }
    function report(failure) {
        error = failure?.message || String(failure); dirty();
        if (!opened) showError(error);
    }
    function acceptJob(next) {
        if (disposed || !next) return;
        if (next.job_id && isTerminalJob(next) && dismissedJobIds.has(next.job_id)) {
            if (job?.job_id === next.job_id) job = null;
            return;
        }
        job = next; dirty();
    }
    function dismissJob() {
        if (!isTerminalJob(job)) return;
        if (job.job_id) {
            dismissedJobIds.add(job.job_id);
            if (dismissedJobIds.size > 20) dismissedJobIds.delete(dismissedJobIds.values().next().value);
        }
        eventRevision += 1;
        job = null;
        error = '';
        dirty();
    }
    async function run(operation) {
        if (pending || disposed) return;
        pending = true; error = ''; dirty();
        try { await operation(); } catch (failure) { report(failure); }
        finally { pending = false; dirty(); }
    }
    async function confirmOutput(options) {
        // Consent belongs to this request, never to the draft or future exports.
        outputConflict = { ...options }; error = ''; view = 'settings';
        await open(draft.mode, true);
    }
    async function submit(options) {
        await run(async () => {
            if (isSequenceFormat(options.format)) {
                if (!options.output_path) {
                    const selected = await service().chooseOutputPath({ format: options.format, suggested_name: suggestedOutputName() });
                    if (disposed) return;
                    if (!selected) { await open(draft.mode, true); return; }
                    draft = changeDraft(draft, 'output_path', selected, info, caps);
                    options = { ...options, output_path: selected };
                }
                if (options.overwrite !== true) {
                    const state = await service().outputState({ output_path: options.output_path, format: options.format });
                    if (disposed) return;
                    if (state.exists && !state.is_dir) throw new Error('Output exists and is not a plain directory');
                    if (needsOutputConfirmation(options, state)) { await confirmOutput(options); return; }
                }
            }
            if (disposed) return;
            try {
                const result = draft.mode === 'record' ? await service().startRecording(options) : await service().exportMedia(options);
                // Capture events can finish a short job before its start promise returns.
                if (job?.job_id !== result.job_id || isBusyJob(job)) acceptJob(result);
            } catch (failure) {
                if (!isOutputDirectoryConflict(failure, options)) throw failure;
                // Begin rechecks the path. A racer must get the same prompt, not
                // a raw failure toast or a stale failed-job card on reopening.
                if (job?.state === 'failed' && isOutputDirectoryConflict(job.error, options)) dismissJob();
                await confirmOutput(options);
            }
        });
    }
    function closed() {
        opened = false;
        overlayTop = null;
        const next = afterClose; afterClose = null;
        if (next && !disposed) windowRef.setTimeout(() => { if (!disposed) void next(); }, 0);
    }
    function selectMode(mode) {
        if (!['still', 'timeline', 'record'].includes(mode) || isBusyJob(job)) return;
        draft = createDraft(mode, info, caps); view = 'settings'; error = ''; outputConflict = null;
    }
    function suggestedOutputName() {
        const stem = String(info.label || 'animation').replace(/\.riv$/i, '') || 'animation';
        const suffix = draft?.mode === 'record' ? 'recording' : draft?.mode === 'timeline' ? 'timeline' : 'still';
        return `${stem}-${suffix}`;
    }
    function overlayBounds(requestedHeight = 420) {
        const width = Math.max(1, Math.min(680, windowRef.innerWidth - 40));
        const maximumHeight = Math.max(1, windowRef.innerHeight - 40);
        const requested = Math.max(240, Math.ceil(Number(requestedHeight) || 420));
        const centeredHeight = Math.max(1, Math.min(maximumHeight, requested));
        const y = overlayTop ?? Math.max(0, Math.round((windowRef.innerHeight - centeredHeight) / 2));
        const height = Math.max(1, Math.min(requested, windowRef.innerHeight - y - 20));
        return { width, height,
            x: Math.max(0, Math.round((windowRef.innerWidth - width) / 2)),
            y };
    }
    async function handleAction({ action, value }) {
        if (action === 'media-resize') return { bounds: overlayBounds(value), transitionMs: 200 };
        if (outputConflict && !['media-output-overwrite', 'media-output-choose', 'media-output-cancel'].includes(action)) return;
        if (action === 'media-output-cancel') {
            if (pending || !outputConflict) return;
            outputConflict = null; error = ''; view = 'settings';
            await open(draft.mode, true);
        } else if (action === 'media-output-overwrite') {
            if (pending || isBusyJob(job) || !outputConflict) return;
            const options = { ...outputConflict, overwrite: true };
            outputConflict = null;
            afterClose = () => submit(options);
            return { close: true, restoreFocus: false };
        } else if (action === 'media-change' && !pending && !isBusyJob(job)) {
            draft = changeDraft(draft, value?.name, value?.value, info, caps); error = '';
        } else if (action === 'media-select') selectMode(value);
        else if (action === 'media-menu') { view = 'menu'; error = ''; }
        else if (action === 'media-choose-path' || action === 'media-output-choose') {
            if (pending || isBusyJob(job) || !draft) return;
            outputConflict = null; view = 'settings'; error = '';
            const request = { format: draft.format, suggested_name: suggestedOutputName() };
            afterClose = async () => {
                await run(async () => {
                    const selected = await service().chooseOutputPath(request);
                    if (selected && !disposed) draft = changeDraft(draft, 'output_path', selected, info, caps);
                });
                if (!disposed) await open(undefined, true);
            };
            return { close: true, restoreFocus: false };
        }
        else if (action === 'media-html') {
            afterClose = () => Promise.resolve(openHtmlExport?.()).catch(report);
            return { close: true };
        } else if (action === 'media-submit') {
            if (pending || isBusyJob(job)) return;
            const { options, validationError } = validate();
            if (validationError) { error = validationError; return; }
            // Let the shell close its own native overlay before opening a save
            // chooser/capturing. Calling closeUiOverlay inside this queued action
            // would deadlock the shell's operation queue.
            afterClose = () => submit(options);
            return { close: true, restoreFocus: false };
        } else if (action === 'media-stop') await stop();
        else if (action === 'media-cancel') await cancel();
        else if (action === 'media-dismiss-job') dismissJob();
        else if (action === 'media-toggle-recording') {
            if (isRecording(job)) await stop();
            else if (!isBusyJob(job)) {
                if (draft?.mode !== 'record') selectMode('record');
                else return handleAction({ action: 'media-submit' });
            }
        }
    }
    async function open(mode, preserveState = false) {
        if (disposed || opening || !isDesktop()) return false;
        if (opened) return true;
        opening = true;
        if (!preserveState) { error = ''; outputConflict = null; }
        try {
            const api = service();
            const revision = eventRevision;
            const [capResult, infoResult, statusResult] = await Promise.allSettled([api.capabilities(), getSourceInfo(), api.status(job?.job_id)]);
            caps = capResult.status === 'fulfilled' ? capResult.value : {};
            info = infoResult.status === 'fulfilled' ? infoResult.value : {};
            if (capResult.status === 'rejected') error = `Media encoders unavailable: ${capResult.reason?.message || capResult.reason}`;
            if (infoResult.status === 'rejected') info = { error: String(infoResult.reason?.message || infoResult.reason) };
            if (statusResult.status === 'fulfilled' && revision === eventRevision) acceptJob(statusResult.value);
            if (disposed) return false;
            if (!preserveState) {
                view = 'menu';
                if (mode && !isBusyJob(job)) selectMode(mode);
            }
            const initialBounds = overlayBounds();
            overlayTop = initialBounds.y;
            opened = !!await requestUiOverlay?.({
                purpose: 'export', focus: true, bounds: initialBounds,
                getState, handleAction, onClose: closed, syncDelays: [0], restoreFocusTarget: elements.demoBundleButton,
            });
            if (!opened) throw new Error('Native export controls are unavailable. The media dialog cannot be shown above the playback surface.');
            return true;
        } catch (failure) { report(failure); return false; }
        finally { opening = false; }
    }
    async function stop() { await run(async () => acceptJob(await service().stopRecording())); }
    async function cancel() { await run(async () => acceptJob(await service().cancel(job?.job_id))); }
    async function toggleRecording() {
        if (!isDesktop() || pending) return;
        if (outputConflict) return open(draft?.mode, true);
        try {
            acceptJob(await service().status());
            if (isRecording(job)) return stop();
            if (isBusyJob(job)) return;
            if (draft?.mode === 'record') {
                const { options, validationError } = validate();
                if (validationError) { report(new Error(validationError)); return open('record'); }
                if (opened) {
                    afterClose = () => submit(options);
                    if (!await closeUiOverlay?.({ restoreFocus: false })) {
                        afterClose = null; throw new Error('Close the export panel before recording.');
                    }
                    return;
                }
                return submit(options);
            }
            return open('record');
        } catch (failure) { report(failure); }
    }
    function onStatus(event) { eventRevision++; acceptJob(event.detail); }
    function setup() {
        if (installed || disposed) return;
        installed = true;
        if (isDesktop()) void Promise.resolve(getService()?.setup?.()).catch(report);
        badge = createMediaJobPresentation({ documentRef, anchor: elements.demoBundleButton, statusAnchor: elements.info, onStop: stop });
        unbindShortcut = bindRecordingShortcut(documentRef, toggleRecording);
        windowRef.addEventListener('rav:media-status', onStatus);
        // The parent may forward the same shortcut from the native Rive child.
        windowRef.addEventListener('rav:media-toggle-recording', toggleRecording);
    }
    function dispose() {
        disposed = true; afterClose = null;
        windowRef.clearTimeout(syncTimer);
        unbindShortcut?.(); badge?.dispose();
        windowRef.removeEventListener('rav:media-status', onStatus);
        windowRef.removeEventListener('rav:media-toggle-recording', toggleRecording);
    }
    return { setup, dispose, open, stop, cancel, toggleRecording, getState, handleAction };
}
