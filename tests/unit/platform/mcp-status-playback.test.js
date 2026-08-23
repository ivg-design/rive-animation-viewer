import { createStatusPlaybackCommands } from '../../../src/app/platform/mcp/commands/status-playback.js';

describe('platform/mcp/status-playback', () => {
    it('reports a bounded render-surface identity for live regression checks', async () => {
        document.body.innerHTML = `
            <select id="runtime-select"><option value="webgl2" selected>WebGL2</option></select>
            <select id="layout-select"><option value="contain" selected>Contain</option></select>
            <select id="alignment-select"><option value="center" selected>Center</option></select>
            <input id="canvas-color-input" value="#0d1117">
        `;
        const windowRef = {
            __riveAnimationCache: {
                getBuffer: () => new ArrayBuffer(12),
                getName: () => 'demo.riv',
            },
            __riveRuntimeCache: { getRuntimeVersion: () => '2.40.1' },
            _mcpGetArtboardState: () => ({ currentArtboard: 'Main' }),
            _mcpGetCanvasSizing: () => ({ mode: 'fixed', width: 960, height: 540 }),
            _mcpGetLiveConfigState: () => ({ draftDirty: false, sourceMode: 'internal' }),
            _mcpGetRenderSurfaceState: () => ({
                isLoaded: true,
                isSetup: true,
                pendingCommands: 0,
                sessionId: 'surface-1',
                surfaceCreated: true,
            }),
            riveInst: { isPlaying: true, isStopped: false },
        };
        const commands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: true, paths: ['speed'] }),
            documentRef: document,
            windowRef,
        });

        await expect(commands.rav_status()).resolves.toEqual(expect.objectContaining({
            renderSurface: {
                active: true,
                isLoaded: true,
                pendingCommands: 0,
                sessionId: 'surface-1',
                surfaceCreated: true,
            },
        }));
    });

    it('reports null when the dedicated surface is unavailable', async () => {
        const commands = createStatusPlaybackCommands({
            buildViewModelSnapshot: () => ({ hasRoot: false, paths: [] }),
            documentRef: document,
            windowRef: {},
        });

        await expect(commands.rav_status()).resolves.toEqual(expect.objectContaining({
            renderSurface: null,
        }));
    });
});
