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
            bounds: { width: 680, height: 640, x: 172, y: 64 } });
        expect(h.request.getState().mediaExport.view).toBe('menu');
        expect(document.querySelector('dialog')).toBeNull();
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
    it('receives external/MCP jobs, polls encoding, then shows measured result bytes/path', async () => {
        h = harness();
        window.dispatchEvent(new CustomEvent('rav:media-status', { detail: { ...h.capture, state: 'encoding' } }));
        h.service.status.mockResolvedValue({ ...h.capture, state: 'completed', actual_bytes: 1234, output_path: '/tmp/movie.mp4', warnings: ['Some frames were held'] });
        await vi.advanceTimersByTimeAsync(750);
        expect(h.service.status).toHaveBeenCalledWith('job-1');
        expect(h.ui.getState().mediaExport.job).toMatchObject({ state: 'completed', actual_bytes: 1234, warnings: ['Some frames were held'] });
        const calls = h.service.status.mock.calls.length;
        await vi.advanceTimersByTimeAsync(2000);
        expect(h.service.status).toHaveBeenCalledTimes(calls);
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
