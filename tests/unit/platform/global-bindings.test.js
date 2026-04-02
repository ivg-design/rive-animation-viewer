import {
    createGlobalBindingsController,
    updateMcpStatusChip,
} from '../../../src/app/platform/global-bindings.js';

describe('platform/global-bindings', () => {
    it('updates the MCP status chip label and state', () => {
        document.body.innerHTML = '<button id="chip"></button>';
        const chip = document.getElementById('chip');

        expect(() => updateMcpStatusChip(null, 'off')).not.toThrow();
        updateMcpStatusChip(chip, 'connected');

        expect(chip.dataset.mcpState).toBe('connected');
        expect(chip.title).toContain('connected');
    });

    it('binds window globals and MCP bridge hooks', async () => {
        document.body.innerHTML = '<button id="chip"></button>';
        const chip = document.getElementById('chip');
        const enable = vi.fn();
        const disable = vi.fn();
        const ensureEditorReady = vi.fn().mockResolvedValue(true);
        const applyCodeAndReload = vi.fn();
        const createDemoBundle = vi.fn().mockResolvedValue('/tmp/demo');
        const exportDemoToPath = vi.fn().mockResolvedValue('/tmp/out');
        const handleFileButtonClick = vi.fn();
        const injectCodeSnippet = vi.fn();
        const loadRiveAnimation = vi.fn();
        const logEvent = vi.fn();
        const closeScriptConsole = vi.fn().mockReturnValue({ open: false });
        const execScriptConsole = vi.fn().mockResolvedValue({ ok: true });
        const openScriptConsole = vi.fn().mockResolvedValue({ open: true });
        const pause = vi.fn();
        const play = vi.fn();
        const refreshVmInputControls = vi.fn();
        const reset = vi.fn();
        const resetToDefaultArtboard = vi.fn();
        const setCurrentFile = vi.fn();
        const setEditorCode = vi.fn().mockReturnValue(true);
        const showMcpSetup = vi.fn();
        const switchArtboard = vi.fn();
        const windowRef = {
            _mcpBridge: {
                state: 'connected',
                disable,
                enable,
            },
        };
        const controller = createGlobalBindingsController({
            callbacks: {
                applyCodeAndReload,
                createDemoBundle,
                ensureEditorReady,
                exportDemoToPath,
                getArtboardStateSnapshot: () => ({ currentArtboard: 'Main' }),
                getCurrentFileBuffer: () => Uint8Array.from([1]).buffer,
                getCurrentFileMimeType: () => 'application/octet-stream',
                getCurrentFileName: () => 'demo.riv',
                getCurrentRuntime: () => 'canvas',
                getEditorCode: () => '({ autoplay: true })',
                getEventLogEntries: () => [{ type: 'ui' }],
                getScriptConsoleEntries: (limit) => ({ total: 2, returned: limit, entries: [{ method: 'log' }] }),
                getRuntimeSourceText: () => 'runtime();',
                getRuntimeVersion: () => '1.2.3',
                handleFileButtonClick,
                injectCodeSnippet,
                loadRiveAnimation,
                logEvent,
                closeScriptConsole,
                execScriptConsole,
                isScriptConsoleOpen: () => true,
                openScriptConsole,
                pause,
                play,
                refreshVmInputControls,
                reset,
                resetToDefaultArtboard,
                setCurrentFile,
                setEditorCode,
                showMcpSetup,
                switchArtboard,
            },
            elements: {
                mcpStatusChip: chip,
            },
            windowRef,
        });

        controller.bind();
        expect(windowRef.__riveRuntimeCache.getRuntimeVersion()).toBe('1.2.3');
        expect(windowRef.__riveRuntimeCache.getRuntimeSourceText()).toBe('runtime();');
        expect(windowRef.__riveAnimationCache.getBuffer()).toBeInstanceOf(ArrayBuffer);
        expect(windowRef.__riveAnimationCache.getName()).toBe('demo.riv');
        expect(windowRef.__riveAnimationCache.getMimeType()).toBe('application/octet-stream');
        await expect(windowRef._mcpGetEditorCode()).resolves.toBe('({ autoplay: true })');
        expect(ensureEditorReady).toHaveBeenCalledTimes(1);
        await expect(windowRef._mcpSetEditorCode('({ autoplay: false })')).resolves.toBe(true);
        expect(setEditorCode).toHaveBeenCalledWith('({ autoplay: false })');
        await expect(windowRef._mcpConsoleOpen()).resolves.toEqual({ open: true });
        expect(windowRef._mcpConsoleIsOpen()).toBe(true);
        expect(windowRef._mcpConsoleRead(5)).toEqual({ total: 2, returned: 5, entries: [{ method: 'log' }] });
        await expect(windowRef._mcpConsoleExec('1 + 1')).resolves.toEqual({ ok: true });
        expect(windowRef._mcpConsoleClose()).toEqual({ open: false });

        windowRef._mcpUpdateStatus('waiting');
        expect(chip.dataset.mcpState).toBe('waiting');

        chip.click();
        expect(disable).toHaveBeenCalledTimes(1);

        await windowRef.applyCodeAndReload();
        await windowRef.createDemoBundle();
        await windowRef.injectCodeSnippet();
        windowRef.handleFileButtonClick();
        windowRef.refreshVmInputControls();
        windowRef.play();
        windowRef.pause();
        windowRef.reset();
        windowRef._mcpSetCurrentFile('blob:demo', 'demo.riv');
        await windowRef._mcpLoadAnimation('blob:demo', 'demo.riv');
        expect(windowRef._mcpGetEventLog()).toEqual([{ type: 'ui' }]);
        windowRef._mcpLogEvent('reply', 'ok', { source: 'mcp' });
        await windowRef._mcpSwitchArtboard('Main', 'sm:Main');
        windowRef._mcpResetArtboard();
        expect(windowRef._mcpGetArtboardState()).toEqual({ currentArtboard: 'Main' });
        windowRef.showMcpSetup();

        expect(applyCodeAndReload).toHaveBeenCalled();
        expect(createDemoBundle).toHaveBeenCalled();
        expect(injectCodeSnippet).toHaveBeenCalled();
        expect(handleFileButtonClick).toHaveBeenCalled();
        expect(refreshVmInputControls).toHaveBeenCalled();
        expect(play).toHaveBeenCalled();
        expect(pause).toHaveBeenCalled();
        expect(reset).toHaveBeenCalled();
        expect(setCurrentFile).toHaveBeenCalledWith('blob:demo', 'demo.riv');
        expect(loadRiveAnimation).toHaveBeenCalledWith('blob:demo', 'demo.riv');
        expect(logEvent).toHaveBeenCalledWith('mcp', 'reply', 'ok', { source: 'mcp' });
        expect(switchArtboard).toHaveBeenCalledWith('Main', 'sm:Main');
        expect(resetToDefaultArtboard).toHaveBeenCalled();
        expect(showMcpSetup).toHaveBeenCalled();
        expect(openScriptConsole).toHaveBeenCalled();
        expect(execScriptConsole).toHaveBeenCalledWith('1 + 1');
        expect(closeScriptConsole).toHaveBeenCalled();

        windowRef._mcpBridge.state = 'off';
        chip.click();
        expect(enable).toHaveBeenCalledTimes(1);

        await expect(windowRef._mcpExportDemoToPath('/tmp/out')).resolves.toBe('/tmp/out');
        expect(exportDemoToPath).toHaveBeenCalledWith('/tmp/out');
    });

    it('ignores repeat binds when no window object is available', () => {
        const controller = createGlobalBindingsController({
            elements: {
                mcpStatusChip: null,
            },
            windowRef: null,
        });

        expect(() => controller.bind()).not.toThrow();
    });

    it('executes default-bound globals without throwing', async () => {
        document.body.innerHTML = '<button id="chip"></button>';
        const chip = document.getElementById('chip');
        const windowRef = {};
        const controller = createGlobalBindingsController({
            elements: {
                mcpStatusChip: chip,
            },
            windowRef,
        });

        controller.bind();
        await expect(windowRef.applyCodeAndReload()).resolves.toBeUndefined();
        await expect(windowRef.createDemoBundle()).resolves.toBeUndefined();
        await expect(windowRef.injectCodeSnippet()).resolves.toBeUndefined();
        windowRef.handleFileButtonClick();
        windowRef.refreshVmInputControls();
        windowRef.play();
        windowRef.pause();
        windowRef.reset();
        windowRef._mcpSetCurrentFile('blob:demo', 'demo.riv');
        await expect(windowRef._mcpLoadAnimation('blob:demo', 'demo.riv')).resolves.toBeUndefined();
        expect(windowRef._mcpGetEventLog()).toEqual([]);
        await expect(windowRef._mcpConsoleOpen()).resolves.toEqual({ open: true });
        expect(windowRef._mcpConsoleIsOpen()).toBe(false);
        expect(windowRef._mcpConsoleRead(2)).toEqual({ total: 0, returned: 0, entries: [] });
        await expect(windowRef._mcpConsoleExec('1 + 1')).resolves.toEqual({ ok: false });
        expect(windowRef._mcpConsoleClose()).toEqual({ open: false });
        await expect(windowRef._mcpGetEditorCode()).resolves.toBe('');
        await expect(windowRef._mcpSetEditorCode('demo')).resolves.toBeUndefined();
        windowRef._mcpLogEvent('noop', 'ok');
        windowRef._mcpUpdateStatus('off');
        await expect(windowRef._mcpExportDemoToPath('/tmp/out')).resolves.toBeUndefined();
        expect(() => windowRef._mcpSwitchArtboard('Main', 'sm:Main')).not.toThrow();
        windowRef._mcpResetArtboard();
        expect(windowRef._mcpGetArtboardState()).toEqual({});
        windowRef.showMcpSetup();
        chip.click();
        expect(chip.dataset.mcpState).toBe('off');
    });
});
