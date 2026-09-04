import { ANIMATED_FORMATS, FORMATS, STILL_FORMATS, describeLimits, formatCapability,
    gifControl, isBusyJob, isRecording, sourceReason, supportsAlpha } from './model.js';
import { describeJob } from './status.js';
import { mediaTemplate } from './template.js';
import { bindRecordingShortcut } from './shortcuts.js';

// This renderer runs in the existing native EXPORT overlay, above the Rive child.
// The host owns jobs, options validation, and all service calls.
export function createMediaRenderer({ documentRef = document, emitAction, container } = {}) {
    let root = null, unbindShortcut = null;
    const query = (selector) => root?.querySelector(selector);
    const field = (name) => query(`[name="${name}"]`);
    const show = (selector, visible) => { const node = query(selector); if (node) node.hidden = !visible; };
    const text = (selector, value) => { const node = query(selector); if (node) node.textContent = value || ''; };
    function install() {
        if (root) return;
        root = documentRef.createElement('section');
        root.className = 'media-export-panel'; root.hidden = true;
        root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'Export media'); root.innerHTML = mediaTemplate();
        (container || documentRef.getElementById('ui-overlay-root') || documentRef.body).appendChild(root);
        root.addEventListener('click', (event) => {
            const button = event.target.closest('[data-media-action]');
            if (button && !button.disabled) void emitAction(button.dataset.mediaAction, button.dataset.mediaMode);
        });
        root.addEventListener('change', (event) => {
            const node = event.target;
            if (node.name) void emitAction('media-change', { name: node.name, value: node.type === 'checkbox' ? node.checked : node.value });
        });
        query('form').addEventListener('submit', (event) => {
            event.preventDefault();
            if (!query('[data-media-submit]').disabled) void emitAction('media-submit');
        });
        unbindShortcut = bindRecordingShortcut(documentRef, () => {
            if (!root.hidden) return emitAction('media-toggle-recording');
        });
    }
    function renderMenu(state) {
        const choices = query('[data-media-choices]');
        if (!choices.childElementCount) {
            for (const [mode, index, title, detail] of [
                ['still', '01', 'Still image', 'PNG · JPG · WebP'],
                ['timeline', '02', 'Timeline', 'H.264 · H.265 · WebM · APNG · GIF'],
                ['record', '03', 'Record interactions', 'State machine · manual or timed'],
            ]) {
                const button = documentRef.createElement('button');
                button.type = 'button'; button.className = 'media-menu-item';
                button.dataset.mediaAction = 'media-select'; button.dataset.mediaMode = mode;
                const marker = documentRef.createElement('span'); marker.className = 'media-menu-index'; marker.textContent = index;
                const heading = documentRef.createElement('strong'); heading.textContent = title;
                const hint = documentRef.createElement('span'); hint.textContent = detail;
                const reason = documentRef.createElement('span'); reason.className = 'media-note';
                button.append(marker, heading, hint, reason); choices.appendChild(button);
            }
        }
        choices.querySelectorAll('button').forEach((button) => {
            const reason = sourceReason(button.dataset.mediaMode, state.info);
            button.disabled = !!reason || state.pending || isBusyJob(state.job);
            button.lastElementChild.textContent = reason;
        });
    }
    function renderFields(state) {
        const d = state.draft, caps = state.caps || {}, gif = d.format === 'gif';
        const modeCopy = {
            still: ['Still image', 'Current frame or exact timeline position'],
            timeline: ['Timeline export', 'Full duration or an exact segment'],
            record: ['Interaction recording', 'Live state machine · manual or timed'],
        }[d.mode] || ['Media settings', ''];
        text('[data-media-mode-title]', modeCopy[0]);
        text('[data-media-mode-detail]', modeCopy[1]);
        root.dataset.mediaMode = d.mode;
        const ids = d.mode === 'still' ? STILL_FORMATS : ANIMATED_FORMATS;
        const formats = field('format');
        if (formats.dataset.mode !== d.mode) {
            formats.replaceChildren(...ids.map((id) => {
                const option = documentRef.createElement('option'); option.value = id; return option;
            }));
            formats.dataset.mode = d.mode;
        }
        [...formats.options].forEach((option) => {
            const cap = formatCapability(caps, option.value);
            option.disabled = !cap?.available;
            option.textContent = `${FORMATS[option.value]}${cap?.available ? '' : ' — unavailable'}`;
            option.title = cap?.reason || '';
        });
        const unavailable = ids.filter((id) => !formatCapability(caps, id)?.available);
        show('[data-media-unavailable]', unavailable.length > 0);
        query('[data-media-unavailable]').replaceChildren(...unavailable.map((id) => {
            const node = documentRef.createElement('li');
            node.textContent = `${FORMATS[id]}: ${formatCapability(caps, id)?.reason || 'Encoder unavailable.'}`;
            return node;
        }));
        for (const [name, value] of Object.entries(d)) {
            const node = field(name);
            if (!node) continue;
            if (documentRef.activeElement === node && node.type !== 'checkbox'
                && node.value !== node.dataset.renderedValue) continue;
            if (node.type === 'checkbox') node.checked = value === true;
            else { node.value = value ?? ''; node.dataset.renderedValue = node.value; }
        }
        root.querySelectorAll('fieldset, [name="format"]').forEach((node) => { node.disabled = state.pending || isBusyJob(state.job); });
        root.querySelectorAll('[data-media-scope]').forEach((node) => {
            node.hidden = node.dataset.mediaScope !== d.mode;
            node.disabled ||= node.hidden;
        });
        show('[data-media-gif]', gif); query('[data-media-gif]').disabled ||= !gif;
        show('[data-media-segment]', d.range === 'segment');
        field('range_unit').disabled = d.range !== 'segment';
        show('[data-media-at-time]', d.at_mode === 'time'); show('[data-media-at-frame]', d.at_mode === 'frame');
        [...field('at_mode').options].forEach((option) => { option.disabled = option.value !== 'current' && state.info?.playback?.type !== 'animation'; });
        show('[data-media-duration]', d.stop_mode === 'duration');
        show('[data-media-fps]', d.mode !== 'still');
        const lossless = ['png', 'apng'].includes(d.format);
        show('[data-media-quality]', !lossless);
        field('quality').disabled = lossless;
        const maxFps = gif ? caps.gif?.fps_max || 50 : caps.limits?.max_fps || 60;
        field('fps').max = maxFps;
        for (const name of ['width', 'height']) field(name).max = caps.limits?.max_edge || 4096;
        const durationMax = Math.min(caps.limits?.max_duration_seconds ?? Infinity, (caps.limits?.max_frames ?? Infinity) / (Number(d.fps) || 60));
        if (Number.isFinite(durationMax)) field('duration_seconds').max = durationMax;
        else field('duration_seconds').removeAttribute('max');
        const alpha = supportsAlpha(caps, d.format);
        field('alpha').disabled = !alpha; field('background').disabled = d.alpha && alpha;
        text('[data-media-alpha-note]', !alpha ? 'Opaque output only. The selected background is the matte.'
            : gif ? 'GIF has binary transparency, not smooth alpha.' : 'Transparency is available from this encoder.');
        const cap = formatCapability(caps, d.format);
        text('[data-media-format-note]', !cap?.available ? cap?.reason || 'Encoder unavailable.'
            : lossless ? `${d.format.toUpperCase()} is lossless; quality does not apply.${d.format === 'apng' ? ' APNG repeat settings are not exposed by the current media service.' : ''}`
                : d.format === 'webp' ? 'Quality 100 uses lossless WebP; lower values use lossy encoding.' : '');
        if (gif) renderGif(d, caps);
        const chosenPath = String(d.output_path || '');
        const pathValue = query('[data-media-path-value]');
        pathValue.textContent = chosenPath || 'Choose a folder and file name';
        pathValue.title = chosenPath;
        pathValue.classList.toggle('is-empty', !chosenPath);
        const pathButton = query('[data-media-action="media-choose-path"]');
        const pathAction = chosenPath ? 'Change output file' : 'Choose output file';
        pathButton.setAttribute('aria-label', pathAction);
        pathButton.title = pathAction;
        pathButton.disabled = state.pending || isBusyJob(state.job);
        text('[data-media-preview]', state.preview);
        const submit = query('[data-media-submit]');
        submit.textContent = d.mode === 'record' ? 'Start recording' : 'Export media';
        submit.disabled = !!state.validationError || !!state.error || state.pending || isBusyJob(state.job);
    }
    function renderGif(d, caps) {
        [...field('encoder').options].forEach((option) => {
            option.disabled = option.value !== 'auto' && !caps.gif?.[`${option.value}_available`];
        });
        for (const [name, selector] of [['motion_quality', '[data-media-motion]'], ['lossy_quality', '[data-media-lossy]']]) {
            const supported = gifControl(d, caps, name);
            show(selector, supported); field(name).disabled = !supported;
        }
        const preset = caps.gif?.[d.gif_preset];
        text('[data-media-preset-note]', preset
            ? `Up to ${preset.max_edge}px longest edge · up to ${preset.max_fps} FPS · never upscales. Output preview shows resolved dimensions.`
            : `Explicit dimensions and FPS. GIF limit: ${caps.gif?.fps_max || 50} FPS; timing is quantized.`);
        show('[data-media-target]', d.gif_preset === 'target-size');
        [...field('size_policy').options].forEach((option) => { option.disabled = !caps.gif?.size_policies?.includes(option.value); });
        text('[data-media-target-note]', `At most ${caps.gif?.max_attempts || 5} attempts. This is a target, not a size guarantee. Duration is preserved; measured bytes and warnings appear in the result. Adjustment floors are not configurable in this service.`);
    }
    function renderJob(state) {
        const job = state.job, display = describeJob(job);
        show('[data-media-job]', !!display.text);
        text('[data-media-job-text]', display.text); text('[data-media-job-details]', display.details);
        text('[data-media-job-error]', display.error); show('[data-media-job-error]', !!display.error);
        show('[data-media-job-disclosure]', !!display.details);
        const progress = query('progress');
        progress.hidden = !isBusyJob(job) && job?.state !== 'completed';
        if (display.progress == null) progress.removeAttribute('value'); else progress.value = display.progress;
        show('[data-media-action="media-stop"]', isRecording(job));
        show('[data-media-action="media-cancel"]', isBusyJob(job));
        query('[data-media-action="media-stop"]').disabled = state.pending;
        query('[data-media-action="media-cancel"]').disabled = state.pending;
        query('[data-media-warnings]').replaceChildren(...display.warnings.map((warning) => {
            const item = documentRef.createElement('li'); item.textContent = warning; return item;
        }));
        show('[data-media-warnings]', display.warnings.length > 0);
    }
    function render(state) {
        if (!state) { if (root) root.hidden = true; return; }
        install(); root.hidden = false;
        show('[data-media-menu]', state.view === 'menu'); show('[data-media-form]', state.view !== 'menu');
        text('[data-media-source]', state.info?.label || 'Animation only · no application chrome');
        renderMenu(state);
        if (state.draft) renderFields(state);
        renderJob(state);
        const error = (state.error !== state.job?.error ? state.error : '') || (state.view !== 'menu' ? state.validationError : '');
        text('[data-media-error]', error); show('[data-media-error]', !!error);
        text('[data-media-limits]', describeLimits(state.caps));
    }
    return { render, dispose() { unbindShortcut?.(); root?.remove(); root = null; } };
}
