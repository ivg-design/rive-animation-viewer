export function setRenderSurfaceFpsState(documentRef, active, fps = null) {
    const fpsChip = documentRef?.getElementById?.('fps-chip');
    if (!fpsChip) {
        return;
    }
    if (!active) {
        delete fpsChip.dataset.renderSurfaceActive;
        fpsChip.title = '';
        fpsChip.innerHTML = '<span class="dot"></span>-- FPS';
        return;
    }
    fpsChip.dataset.renderSurfaceActive = 'true';
    fpsChip.title = 'Dedicated playback renderer FPS; visual frame capture remains the performance acceptance test.';
    const hasFps = fps !== null && fps !== undefined && Number.isFinite(Number(fps));
    const label = hasFps ? `${Math.round(Number(fps))} FPS` : '-- FPS';
    fpsChip.innerHTML = `<span class="dot"></span>${label}`;
}
