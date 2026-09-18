import { createMediaExportUiController } from '../../../../src/app/ui/media/controller.js';
import { resolveMediaOptions } from '../../../../src/app/platform/media/options.js';
import { capabilities, stateMachine, timeline } from './fixtures.js';

function harness({ desktop = true, info = stateMachine, overlayAvailable = true } = {}) {
    const button = document.createElement('button'); document.body.appendChild(button);
    document.body.insertAdjacentHTML('beforeend', '<div class="runtime-strip"><div class="runtime-strip-right"><span id="info">Playing TrackMap</span></div></div>');
    const capture = { job_id: 'job-1', state: 'capturing', recording: true, captured_frames: 0 };
    const service = {
        capabilities: vi.fn(async () => capabilities), status: vi.fn(async () => ({ state: 'idle' })),
        chooseOutputPath: vi.fn(async () => '/tmp/trackmap-timeline.mp4'),
        outputState: vi.fn(async () => ({ exists: false, empty: true, is_dir: false })),
        startRecording: vi.fn(async () => capture), exportMedia: vi.fn(async () => ({ ...capture, recording: false })),
        stopRecording: vi.fn(async () => ({ ...capture, state: 'encoding' })),
        cancel: vi.fn(async () => ({ ...capture, state: 'cancelled' })),
    };
    let request;
    const openHtmlExport = vi.fn(async () => true), showError = vi.fn();
    const requestUiOverlay = vi.fn(async (value) => { request = value; return overlayAvailable; });
    const closeUiOverlay = vi.fn(async () => { request.onClose(); return true; });
    const ui = createMediaExportUiController({ getService: () => service, isDesktop: () => desktop,
        getSourceInfo: async () => info, resolveOptions: resolveMediaOptions, requestUiOverlay,
        closeUiOverlay, openHtmlExport, showError, elements: { demoBundleButton: button } });
    ui.setup();
    return { ui, service, capture, requestUiOverlay, closeUiOverlay, openHtmlExport, showError, get request() { return request; } };
}
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
let h;
afterEach(() => h?.ui.dispose());

describe('media UI native integration', () => {
    it('keeps export unavailable on web and never calls the media service', async () => {
        h = harness({ desktop: false });
        expect(await h.ui.open()).toBe(false);
        await h.ui.toggleRecording();
        expect(h.service.capabilities).not.toHaveBeenCalled();
        expect(h.requestUiOverlay).not.toHaveBeenCalled();
    });
    it('opens in the existing native export overlay with keyboard focus', async () => {
        h = harness(); await h.ui.open();
        expect(h.request).toMatchObject({ purpose: 'export', focus: true,
            bounds: { width: 680, height: 420, x: 172, y: 174 } });
        expect(h.request.getState().mediaExport.view).toBe('menu');
        expect(document.querySelector('dialog')).toBeNull();
    });
    it('anchors measured content at the opening top edge and clamps the bottom', async () => {
        h = harness(); await h.ui.open();
        await expect(h.request.handleAction({ action: 'media-resize', value: 378 })).resolves.toEqual({
            bounds: { width: 680, height: 378, x: 172, y: 174 }, transitionMs: 200,
        });
        await expect(h.request.handleAction({ action: 'media-resize', value: 5000 })).resolves.toEqual({
            bounds: { width: 680, height: 574, x: 172, y: 174 }, transitionMs: 200,
        });
    });
    it('reports unavailable overlays instead of hiding a host dialog behind the child', async () => {
        h = harness({ overlayAvailable: false });
        expect(await h.ui.open()).toBe(false);
        expect(h.showError).toHaveBeenCalledWith(expect.stringContaining('above the playback surface'));
        expect(h.service.startRecording).not.toHaveBeenCalled();
    });
    it('keeps HTML/snippet export routed to its existing controller after closing', async () => {
        h = harness(); await h.ui.open();
        expect(await h.request.handleAction({ action: 'media-html' })).toEqual({ close: true });
        expect(h.openHtmlExport).not.toHaveBeenCalled();
        h.request.onClose(); await flush();
        expect(h.openHtmlExport).toHaveBeenCalledOnce();
        expect(h.closeUiOverlay).not.toHaveBeenCalled();
    });
    it('closes before manual recording and exposes Stop outside the overlay', async () => {
        h = harness(); await h.ui.open('record');
        expect(h.request.getState().mediaExport.preview).toContain('manual stop · no time limit');
        const result = await h.request.handleAction({ action: 'media-submit' });
        expect(result).toEqual({ close: true, restoreFocus: false });
        expect(h.service.startRecording).not.toHaveBeenCalled();
        h.request.onClose(); await flush();
        expect(h.service.startRecording).toHaveBeenCalledOnce();
        expect(h.service.startRecording.mock.calls[0][0]).not.toHaveProperty('duration_seconds');
        const badge = document.querySelector('.media-recording-badge');
        expect(badge.hidden).toBe(false);
        expect(badge.querySelectorAll('button')).toHaveLength(1);
        expect(badge.querySelector('.media-job-open')).toBeNull();
        expect(document.querySelector('.media-statusbar [role="status"]').textContent).toContain('Recording');
        expect(badge.querySelector('.media-stop').getAttribute('aria-label')).toContain('Stop recording');
        badge.querySelector('.media-stop').click(); await flush();
        expect(h.service.stopRecording).toHaveBeenCalledOnce();
        expect(h.requestUiOverlay).toHaveBeenCalledOnce();
    });
    it.each(['completed', 'failed', 'cancelled'])('keeps %s results in Export without a second navigation button', async (state) => {
        h = harness();
        const result = { ...h.capture, state, actual_bytes: 1234, output_path: '/tmp/movie.mp4' };
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: result }));
        const badge = document.querySelector('.media-recording-badge');
        expect(badge.hidden).toBe(true);
        expect(badge.querySelector('.media-job-open')).toBeNull();
        h.service.status.mockResolvedValue(result);
        await h.ui.open();
        expect(h.request.purpose).toBe('export');
        expect(h.request.getState().mediaExport).toMatchObject({ view: 'menu', job: result });
    });
    it('dismisses a terminal result and does not restore it on the next open', async () => {
        h = harness();
        const result = { ...h.capture, state: 'failed', error: 'Control is unavailable.' };
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: result }));
        h.service.status.mockResolvedValue(result);
        await h.ui.open();
        await h.request.handleAction({ action: 'media-dismiss-job' });
        expect(h.request.getState().mediaExport.job).toBeNull();
        h.request.onClose();
        await h.ui.open();
        expect(h.request.getState().mediaExport.job).toBeNull();
    });
    it('shows passive encoding progress without an enabled Stop or a navigation control', () => {
        h = harness();
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: { ...h.capture, state: 'encoding', progress: .45 } }));
        const badge = document.querySelector('.media-recording-badge');
        expect(badge.hidden).toBe(true);
        const footer = document.querySelector('.media-statusbar');
        expect(footer.closest('.runtime-strip')).not.toBeNull();
        expect(footer.hidden).toBe(false);
        expect(footer.querySelector('progress').value).toBe(.45);
        expect(footer.querySelector('.media-job-percent').textContent).toBe('45%');
        const status = footer.querySelector('[role="status"]');
        expect(status.tagName).toBe('SPAN');
        expect(status.textContent).toContain('Encoding');
        status.click();
        expect(h.requestUiOverlay).not.toHaveBeenCalled();
        expect(h.service.stopRecording).not.toHaveBeenCalled();
    });
    it('restores the current playback status after export and clears indeterminate progress between jobs', () => {
        h = harness();
        const strip = document.querySelector('.runtime-strip');
        const footer = document.querySelector('.media-statusbar');
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: { ...h.capture, state: 'encoding', stage: 'verifying', progress: .93 } }));
        expect(strip.classList.contains('media-busy')).toBe(true);
        expect(footer.textContent).toContain('Verifying export');
        document.getElementById('info').textContent = 'Paused TrackMap';
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: { ...h.capture, state: 'completed', progress: 1 } }));
        expect(footer.hidden).toBe(true);
        expect(strip.classList.contains('media-busy')).toBe(false);
        expect(document.getElementById('info').textContent).toBe('Paused TrackMap');
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: h.capture }));
        expect(footer.querySelector('progress').hasAttribute('value')).toBe(false);
        h.ui.dispose();
        expect(document.querySelector('.media-statusbar')).toBeNull();
        expect(strip.classList.contains('media-busy')).toBe(false);
    });
    it('uses the shared resolver for invalid dimensions without starting an export', async () => {
        h = harness({ info: timeline }); await h.ui.open('timeline');
        await h.request.handleAction({ action: 'media-change', value: { name: 'width', value: '1919' } });
        expect(h.ui.getState().mediaExport.validationError).toContain('even');
        await h.request.handleAction({ action: 'media-submit' });
        expect(h.service.exportMedia).not.toHaveBeenCalled();
    });
    it('chooses the destination with a native Save dialog and submits the selected path', async () => {
        h = harness({ info: { ...timeline, label: 'trackmap_v7.5.riv' } });
        await h.ui.open('timeline');
        expect(await h.request.handleAction({ action: 'media-choose-path' }))
            .toEqual({ close: true, restoreFocus: false });
        expect(h.service.chooseOutputPath).not.toHaveBeenCalled();
        h.request.onClose(); await flush();
        await vi.waitFor(() => expect(h.service.chooseOutputPath).toHaveBeenCalledWith({
            format: 'h264', suggested_name: 'trackmap_v7.5-timeline',
        }));
        await vi.waitFor(() => expect(h.requestUiOverlay).toHaveBeenCalledTimes(2));
        expect(h.request.getState().mediaExport).toMatchObject({
            view: 'settings', draft: { output_path: '/tmp/trackmap-timeline.mp4' },
        });
        expect(await h.request.handleAction({ action: 'media-submit' }))
            .toEqual({ close: true, restoreFocus: false });
        h.request.onClose(); await flush();
        await vi.waitFor(() => expect(h.service.exportMedia).toHaveBeenCalledWith(
            expect.objectContaining({ output_path: '/tmp/trackmap-timeline.mp4' }),
        ));
    });
    it('returns to unchanged media settings when the native Save dialog is cancelled', async () => {
        h = harness({ info: timeline });
        h.service.chooseOutputPath.mockResolvedValueOnce(null);
        await h.ui.open('timeline');
        await h.request.handleAction({ action: 'media-change', value: { name: 'width', value: '1280' } });
        await h.request.handleAction({ action: 'media-choose-path' });
        h.request.onClose(); await flush();
        await vi.waitFor(() => expect(h.requestUiOverlay).toHaveBeenCalledTimes(2));
        expect(h.request.getState().mediaExport).toMatchObject({
            view: 'settings', draft: { width: '1280', output_path: '' }, error: '',
        });
    });
    it('receives external/MCP jobs and shows an event-delivered measured result without polling', async () => {
        h = harness();
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: { ...h.capture, state: 'encoding' } }));
        h.service.status.mockClear();
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: { ...h.capture, state: 'completed', actual_bytes: 1234, output_path: '/tmp/movie.mp4', warnings: ['Some frames were held'] } }));
        expect(h.ui.getState().mediaExport.job).toMatchObject({ state: 'completed', actual_bytes: 1234, warnings: ['Some frames were held'] });
        await vi.advanceTimersByTimeAsync(2000);
        expect(h.service.status).not.toHaveBeenCalled();
    });
    it('handles cancellation and recording errors without leaving the UI busy', async () => {
        h = harness();
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: h.capture }));
        await h.ui.cancel();
        expect(h.service.cancel).toHaveBeenCalledWith('job-1');
        expect(h.ui.getState().mediaExport.job.state).toBe('cancelled');
        h.service.stopRecording.mockRejectedValue(new Error('Source changed'));
        await h.ui.stop();
        expect(h.ui.getState().mediaExport).toMatchObject({ pending: false, error: 'Source changed' });
    });
    it('starts configured recording using the shortcut and stops an active recording', async () => {
        h = harness(); await h.ui.open('record'); h.request.onClose();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
        await flush(); expect(h.service.startRecording).toHaveBeenCalledOnce();
        h.service.status.mockResolvedValue(h.capture);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
        await flush(); expect(h.service.stopRecording).toHaveBeenCalledOnce();
    });
    it('ignores the shortcut in typing fields and disposes event listeners', async () => {
        h = harness();
        const input = document.createElement('input'); document.body.appendChild(input);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', metaKey: true, shiftKey: true, bubbles: true }));
        expect(h.service.status).not.toHaveBeenCalled();
        h.ui.dispose();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', metaKey: true, shiftKey: true, bubbles: true }));
        expect(h.service.status).not.toHaveBeenCalled();
    });
});


describe('sequence destination confirmation', () => {
    const change = (name, value) => h.request.handleAction({ action: 'media-change', value: { name, value } });
    async function sequence(mode = 'timeline', path = '/tmp/frames') {
        h = harness({ info: mode === 'record' ? stateMachine : timeline });
        await h.ui.open(mode);
        await change('format', 'png-sequence');
        await change('fps', '30');
        await change('output_path', path);
    }
    async function submit() {
        expect(await h.request.handleAction({ action: 'media-submit' })).toEqual({ close: true, restoreFocus: false });
        h.request.onClose(); await flush();
    }
    async function conflict(mode = 'timeline') {
        await sequence(mode);
        h.service.outputState.mockResolvedValue({ exists: true, empty: false, is_dir: true });
        await submit();
    }
    it('checks an explicit non-empty folder before beginning and reopens the prompt', async () => {
        await conflict();
        expect(h.service.outputState).toHaveBeenCalledWith({ format: 'png-sequence', output_path: '/tmp/frames' });
        expect(h.service.exportMedia).not.toHaveBeenCalled();
        expect(h.showError).not.toHaveBeenCalled();
        expect(h.request.getState().mediaExport).toMatchObject({ error: '', pending: false, outputConflict: { output_path: '/tmp/frames' } });
    });
    it('overwrites only after the overlay closes and does not persist consent in the draft', async () => {
        await conflict('record');
        const before = { ...h.request.getState().mediaExport.draft };
        expect(await h.request.handleAction({ action: 'media-output-overwrite' })).toEqual({ close: true, restoreFocus: false });
        expect(h.service.startRecording).not.toHaveBeenCalled();
        h.request.onClose(); await flush();
        expect(h.service.startRecording).toHaveBeenCalledWith(expect.objectContaining({ format: 'png-sequence', fps: 30, output_path: '/tmp/frames', overwrite: true }));
        expect(h.service.outputState).toHaveBeenCalledOnce();
        expect(h.ui.getState().mediaExport.draft).toEqual(before);
        expect(h.ui.getState().mediaExport.draft).not.toHaveProperty('overwrite');
    });
    it('chooses a new folder after closing, then restores settings without auto-submitting', async () => {
        await conflict();
        h.service.chooseOutputPath.mockResolvedValue('/tmp/new-frames');
        expect(await h.request.handleAction({ action: 'media-output-choose' })).toEqual({ close: true, restoreFocus: false });
        expect(h.service.chooseOutputPath).not.toHaveBeenCalled();
        h.request.onClose(); await flush();
        expect(h.service.chooseOutputPath).toHaveBeenCalledWith({ format: 'png-sequence', suggested_name: 'animation-timeline' });
        expect(h.request.getState().mediaExport).toMatchObject({ view: 'settings', outputConflict: null, draft: { fps: '30', output_path: '/tmp/new-frames' } });
        expect(h.service.exportMedia).not.toHaveBeenCalled();
    });
    it('cancels the conflict without changing settings or starting a job', async () => {
        await conflict();
        const before = { ...h.request.getState().mediaExport.draft };
        await h.request.handleAction({ action: 'media-output-cancel' });
        expect(h.request.getState().mediaExport).toMatchObject({ view: 'settings', outputConflict: null, draft: before });
        expect(h.service.exportMedia).not.toHaveBeenCalled();
        expect(h.service.chooseOutputPath).not.toHaveBeenCalled();
    });
    it('preserves the original folder when the replacement picker is cancelled', async () => {
        await conflict(); h.service.chooseOutputPath.mockResolvedValue(null);
        await h.request.handleAction({ action: 'media-output-choose' });
        h.request.onClose(); await flush();
        expect(h.request.getState().mediaExport).toMatchObject({ outputConflict: null, draft: { output_path: '/tmp/frames', fps: '30' } });
        expect(h.service.exportMedia).not.toHaveBeenCalled();
    });
    it('gets a folder from the picker before preflighting a request without a path', async () => {
        await sequence('record', '');
        h.service.chooseOutputPath.mockResolvedValue('/tmp/picked-frames');
        h.service.outputState.mockResolvedValue({ exists: true, empty: false, is_dir: true });
        await submit();
        expect(h.service.outputState).toHaveBeenCalledWith({ format: 'png-sequence', output_path: '/tmp/picked-frames' });
        expect(h.request.getState().mediaExport.outputConflict.output_path).toBe('/tmp/picked-frames');
        expect(h.service.startRecording).not.toHaveBeenCalled();
    });
    it('returns to settings without an error when the initial folder picker is cancelled', async () => {
        await sequence('record', ''); h.service.chooseOutputPath.mockResolvedValue(null);
        await submit();
        expect(h.request.getState().mediaExport).toMatchObject({ view: 'settings', outputConflict: null, error: '' });
        expect(h.service.outputState).not.toHaveBeenCalled();
        expect(h.service.startRecording).not.toHaveBeenCalled();
        expect(h.showError).not.toHaveBeenCalled();
    });
    it('maps the begin-time race to the same prompt and dismisses its failed job', async () => {
        await sequence();
        const message = 'Output directory exists and is not empty';
        h.service.exportMedia.mockImplementation(async () => {
            window.dispatchEvent(new CustomEvent('rav:media-status', { detail: { job_id: 'raced', state: 'failed', error: message } }));
            throw new Error(message);
        });
        await submit();
        expect(h.request.getState().mediaExport).toMatchObject({ outputConflict: { output_path: '/tmp/frames' }, error: '' });
        expect(h.showError).not.toHaveBeenCalled();
        expect(h.request.getState().mediaExport.job?.job_id).not.toBe('raced');
    });
    it('does not misclassify IO failures or offer overwrite for non-directories', async () => {
        await sequence();
        h.service.outputState.mockResolvedValue({ exists: true, empty: false, is_dir: false });
        await submit();
        expect(h.ui.getState().mediaExport.outputConflict).toBeNull();
        expect(h.service.exportMedia).not.toHaveBeenCalled();
        expect(h.showError).toHaveBeenCalledWith('Output exists and is not a plain directory');
    });
    it('starts normally for an empty folder without granting overwrite', async () => {
        await sequence(); h.service.outputState.mockResolvedValue({ exists: true, empty: true, is_dir: true });
        await submit();
        expect(h.service.exportMedia).toHaveBeenCalledOnce();
        expect(h.service.exportMedia.mock.calls[0][0]).not.toHaveProperty('overwrite');
    });
    it('blocks form edits and recording shortcuts until a conflict choice is made', async () => {
        await conflict('record');
        await change('format', 'h264');
        await h.ui.toggleRecording();
        await h.request.handleAction({ action: 'media-submit' });
        expect(h.request.getState().mediaExport.draft.format).toBe('png-sequence');
        expect(h.request.getState().mediaExport.outputConflict).not.toBeNull();
        expect(h.service.startRecording).not.toHaveBeenCalled();
    });
});
