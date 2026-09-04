import { createMediaRenderer } from '../../../../src/app/ui/media/renderer.js';
import { createDraft } from '../../../../src/app/ui/media/model.js';
import { describeJob } from '../../../../src/app/ui/media/status.js';
import { isRecordingShortcut } from '../../../../src/app/ui/media/shortcuts.js';
import { capabilities as caps, timeline, stateMachine } from './fixtures.js';

let renderer;
const get = (selector) => document.querySelector(selector);
function mount(overrides = {}) {
    const emitAction = vi.fn(async () => true);
    const state = { view: 'settings', info: timeline, caps, draft: createDraft('timeline', timeline, caps), ...overrides };
    renderer = createMediaRenderer({ documentRef: document, emitAction }); renderer.render(state);
    return { state, emitAction };
}
afterEach(() => renderer?.dispose());

describe('media native overlay renderer', () => {
    it('shows the media and HTML entry points, disabling inappropriate sources', () => {
        mount({ view: 'menu' });
        expect(document.querySelectorAll('[data-media-choices] > .media-menu-item')).toHaveLength(3);
        expect([...document.querySelectorAll('[data-media-choices] .media-menu-index')].map((node) => node.textContent))
            .toEqual(['01', '02', '03']);
        expect(get('[data-media-mode="still"]').disabled).toBe(false);
        expect(get('[data-media-mode="record"]').disabled).toBe(true);
        expect(get('[data-media-mode="record"]').textContent).toContain('Select a state machine');
        expect(get('[data-media-action="media-html"]').disabled).toBe(false);
    });
    it('keeps capture and output settings in one compact workspace', () => {
        mount();
        const close = get('[data-media-action="close"]');
        expect(close.classList.contains('rav-modal-close')).toBe(true);
        expect(close.classList.contains('ui-overlay-close')).toBe(true);
        expect(close.hasAttribute('data-overlay-close')).toBe(true);
        expect(get('[data-media-mode-title]').textContent).toBe('Timeline export');
        expect(get('.media-settings-layout')).not.toBeNull();
        expect(get('.media-capture-stack [data-media-scope="timeline"]')).not.toBeNull();
        expect(get('.media-settings-layout > .media-output-panel')).not.toBeNull();
        expect(get('.media-actions [data-media-submit]').textContent).toBe('Export media');
        expect(get('[name="output_path"]')).toBeNull();
        expect(get('[data-media-action="media-choose-path"]').getAttribute('aria-label')).toBe('Choose output file');
    });
    it('renders and changes the native Save destination without an editable path field', () => {
        const { emitAction, state } = mount();
        get('[data-media-action="media-choose-path"]').click();
        expect(emitAction).toHaveBeenCalledWith('media-choose-path', undefined);
        renderer.render({ ...state, draft: { ...state.draft, output_path: '/tmp/<track>.mp4' } });
        expect(get('[data-media-path-value]').textContent).toBe('/tmp/<track>.mp4');
        expect(get('[data-media-path-value] b')).toBeNull();
        expect(get('[data-media-path-value]').title).toBe('/tmp/<track>.mp4');
        expect(get('[data-media-action="media-choose-path"]').getAttribute('aria-label')).toBe('Change output file');
        expect(get('[data-media-action="media-choose-path"] svg')).not.toBeNull();
    });
    it('shows unavailable codec reasons as text and does not invent alpha support', () => {
        const limited = { ...caps, formats: caps.formats.map((f) => f.id === 'h265' ? { ...f, available: false, reason: '<b>HEVC missing</b>' } : f) };
        mount({ caps: limited });
        expect(get('[name="format"] option[value="h265"]').disabled).toBe(true);
        expect(get('[data-media-unavailable]').textContent).toContain('<b>HEVC missing</b>');
        expect(get('[data-media-unavailable] b')).toBeNull();
        expect(get('[name="alpha"]').disabled).toBe(true);
        expect(get('[data-media-alpha-note]').textContent).toContain('Opaque');
    });
    it('hides gifski-only settings without gifski and gates them on the chosen encoder', () => {
        const draft = { ...createDraft('timeline', timeline, caps, 'gif'), gif_preset: 'target-size' };
        const { state } = mount({ draft });
        expect(get('[data-media-motion]').hidden).toBe(true);
        expect(get('[data-media-lossy]').hidden).toBe(true);
        expect(get('[name="encoder"] option[value="gifski"]').disabled).toBe(true);
        expect(get('[data-media-target]').hidden).toBe(false);
        expect(get('[data-media-target-note]').textContent).toContain('not a size guarantee');
        expect(get('[name="fps"]').max).toBe('50');
        const gifski = { ...caps, gif: { ...caps.gif, gifski_available: true, resolved_auto_encoder: 'gifski', motion_quality: true, lossy_quality: true } };
        renderer.render({ ...state, caps: gifski });
        expect(get('[data-media-motion]').hidden).toBe(false);
        renderer.render({ ...state, caps: gifski, draft: { ...draft, encoder: 'ffmpeg' } });
        expect(get('[data-media-motion]').hidden).toBe(true);
    });
    it('preserves input focus while state updates and sends explicit changes/submission', () => {
        const { emitAction, state } = mount();
        const width = get('[name="width"]'); width.focus(); width.value = '800';
        renderer.render({ ...state, preview: '800 × 450 px' });
        expect(width.value).toBe('800'); expect(document.activeElement).toBe(width);
        width.dispatchEvent(new Event('change', { bubbles: true }));
        expect(emitAction).toHaveBeenCalledWith('media-change', { name: 'width', value: '800' });
        get('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(emitAction).toHaveBeenCalledWith('media-submit');
    });
    it('shows live recording Stop/Cancel and disables settings during capture', () => {
        const { emitAction } = mount({ info: stateMachine, draft: createDraft('record', stateMachine, caps),
            job: { state: 'capturing', recording: true, captured_frames: 123 } });
        expect(get('[data-media-action="media-stop"]').hidden).toBe(false);
        expect(get('[data-media-action="media-cancel"]').hidden).toBe(false);
        expect(get('[data-media-submit]').disabled).toBe(true);
        expect(get('[data-media-job-text]').textContent).toContain('123 frames');
        expect(get('progress').hasAttribute('value')).toBe(false);
        get('[data-media-action="media-stop"]').click();
        expect(emitAction).toHaveBeenCalledWith('media-stop', undefined);
    });
    it('updates an untouched focused dimension when its aspect-locked peer changes', () => {
        const { state } = mount();
        const height = get('[name="height"]'); height.focus();
        renderer.render({ ...state, draft: { ...state.draft, width: 640, height: 360 } });
        expect(height.value).toBe('360'); expect(document.activeElement).toBe(height);
    });
    it('renders output bytes, path, warnings and failure details safely', () => {
        mount({ job: { state: 'completed', actual_bytes: 12345, output_path: '/tmp/<img>.gif', warnings: ['Target size unmet <script>'] } });
        expect(get('[data-media-job-details]').textContent).toContain('12,345 bytes');
        expect(get('[data-media-job-details]').textContent).toContain('/tmp/<img>.gif');
        expect(get('[data-media-warnings]').textContent).toContain('Target size unmet <script>');
        expect(get('[data-media-job] img, [data-media-job] script')).toBeNull();
        expect(get('[data-media-job-disclosure]').open).toBe(false);
        expect(get('progress').value).toBe(1);
        expect(get('progress').classList.contains('media-progress')).toBe(true);
        expect(describeJob({ state: 'failed', error: 'Destination is read-only' }).error).toContain('Destination is read-only');
    });
    it('summarizes repeated frame-hold sources using output frame counts, retaining distinct warnings', () => {
        mount({ view: 'menu', job: { state: 'completed', frame_count: 100, received_frames: 60, warnings: [
            '82 capture frames were held due to encoder backpressure.',
            '40 presentation frames hold preceding captures; duration is preserved.',
            '40 presentation frames hold preceding captures; duration is preserved.',
            'GIF target size was not met.', 'GIF target size was not met.',
        ] } });
        const warnings = get('[data-media-warnings]');
        expect(warnings.hidden).toBe(false);
        expect(warnings.children).toHaveLength(2);
        expect(warnings.firstElementChild.textContent).toContain('40 of 100 frames repeat earlier captures');
        expect(warnings.textContent).toContain('Try a lower FPS or smaller dimensions');
        expect(warnings.textContent).not.toContain('backpressure');
        expect(warnings.textContent).not.toContain('82');
        expect(warnings.classList.contains('media-warnings')).toBe(true);
        expect(warnings.getAttribute('role')).not.toBe('alert');
        expect(get('[data-media-job-error]').hidden).toBe(true);
    });
    it('reports held frames from job fields without requiring a warning string', () => {
        expect(describeJob({ state: 'completed', frame_count: 60, received_frames: 40 }).warnings)
            .toEqual([expect.stringContaining('20 of 60 frames repeat earlier captures')]);
    });
    it('does not mistake capture progress or a recording limit for held frames', () => {
        for (const job of [
            { state: 'capturing', frame_count: 100, received_frames: 60 },
            { state: 'completed', received_frames: 60, resolved_settings: { frame_count: 36000 } },
            { state: 'completed', frame_count: 60, received_frames: 60 },
            { state: 'completed', frame_count: 60, received_frames: null },
        ]) expect(describeJob(job).warnings).toEqual([]);
        expect(describeJob({ state: 'completed', warnings: ['82 capture frames were held due to encoder backpressure.'] }).warnings)
            .toEqual([expect.stringContaining('Some frames repeat earlier captures')]);
    });
    it('renders failures as alerts separately from warnings and clears both for a new job', () => {
        const { state } = mount({ error: 'Destination <script> is read-only', job: {
            state: 'failed', error: 'Destination <script> is read-only', warnings: ['GIF has binary transparency.'],
        } });
        expect(get('[data-media-job-error]').hidden).toBe(false);
        expect(get('[data-media-job-error]').getAttribute('role')).toBe('alert');
        expect(get('[data-media-job-error]').textContent).toContain('Destination <script>');
        expect(get('[data-media-job-details]').textContent).not.toContain('read-only');
        expect(get('[data-media-error]').hidden).toBe(true);
        expect(get('[data-media-job] script')).toBeNull();
        renderer.render({ ...state, error: '', job: { state: 'capturing' } });
        expect(get('[data-media-job-error]').hidden).toBe(true);
        expect(get('[data-media-warnings]').hidden).toBe(true);
    });
    it('caps native windows without misrepresenting capture progress', () => {
        mount();
        expect(get('[data-media-limits]').textContent).toContain('36,000 frames');
        expect(describeJob({ state: 'capturing', captured_frames: 50, frame_count: 100, progress: 0 }).progress).toBe(.5);
        expect(describeJob({ state: 'encoding', progress: .75 }).progress).toBe(.75);
        expect(describeJob({ state: 'encoding', stage: 'verifying', progress: .93 }).text).toBe('Verifying export…');
    });
    it('hides media presentation when the existing HTML export overlay is selected', () => {
        mount(); renderer.render(null);
        expect(get('.media-export-panel').hidden).toBe(true);
    });
});

describe('recording shortcut typing guards', () => {
    it.each(['input', 'textarea', 'select', '[contenteditable]', '[role="textbox"]', '.cm-editor'])('ignores %s and its descendants', (selector) => {
        const root = document.createElement(selector.startsWith('[') || selector.startsWith('.') ? 'div' : selector);
        if (selector === '[contenteditable]') root.setAttribute('contenteditable', 'true');
        if (selector === '[role="textbox"]') root.setAttribute('role', 'textbox');
        if (selector === '.cm-editor') root.className = 'cm-editor';
        const child = document.createElement('span'); root.appendChild(child); document.body.appendChild(root);
        expect(isRecordingShortcut({ key: 'R', metaKey: true, shiftKey: true, target: child })).toBe(false);
    });
    it('ignores composition, held keys, alternate modifiers and already handled shortcuts', () => {
        for (const override of [{ isComposing: true }, { repeat: true }, { altKey: true }, { defaultPrevented: true }, { shiftKey: false }]) {
            expect(isRecordingShortcut({ key: 'R', metaKey: true, shiftKey: true, ...override })).toBe(false);
        }
        expect(isRecordingShortcut({ key: 'R', ctrlKey: true, shiftKey: true })).toBe(true);
    });
});

it.each(['png', 'apng'])('%s hides/disables irrelevant quality and restores it when switching formats', (format) => {
    const mode = format === 'png' ? 'still' : 'timeline';
    const draft = createDraft(mode, timeline, caps, format);
    const { state } = mount({ draft });
    expect(get('[data-media-quality]').hidden).toBe(true);
    expect(get('[name="quality"]').disabled).toBe(true);
    expect(get('[data-media-format-note]').textContent).toContain('lossless; quality does not apply');
    const next = format === 'png' ? 'jpg' : 'gif';
    renderer.render({ ...state, draft: { ...draft, format: next } });
    expect(get('[data-media-quality]').hidden).toBe(false);
    expect(get('[name="quality"]').disabled).toBe(false);
});
