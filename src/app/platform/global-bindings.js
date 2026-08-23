export function updateMcpStatusChip(chip, state) {
    if (!chip) {
        return;
    }

    const normalizedState = state === 'connected' ? 'idle' : state;
    chip.dataset.mcpState = normalizedState;
    const labels = {
        active: 'MCP: agent commands received within the last 30 seconds (click to disable)',
        error: 'MCP: bridge connection failed; retrying (click to disable)',
        idle: 'MCP: ready for agent connections (click to disable)',
        off: 'MCP: disabled (click to enable)',
        waiting: 'MCP: connecting to the bridge (click to disable)',
    };
    chip.title = labels[normalizedState] || labels.off;
}

export function createGlobalBindingsController({
    callbacks = {},
    elements,
    windowRef = globalThis.window,
} = {}) {
    const {
        applyCodeAndReload = async () => {},
        createDemoBundle = async () => {},
        ensureEditorReady = async () => true,
        exportDemoToPath = async () => {},
        openIsolatedPlayback = async () => {},
        getArtboardStateSnapshot = () => ({}),
        getCurrentCanvasSizing = () => null,
        getCurrentFileBuffer = () => null,
        getCurrentFileMimeType = () => 'application/octet-stream',
        getCurrentFileName = () => null,
        getCurrentRuntime = () => 'webgl2',
        getEditorCode = () => '',
        getEventLogEntries = () => [],
        getGenerateWebInstantiationCode = async () => ({ code: '' }),
        getLiveConfigState = () => ({
            draftDirty: false,
            sourceMode: 'internal',
        }),
        getRenderSurfaceState = () => null,
        getSidebarVisibility = () => ({ left: false, right: true }),
        getScriptConsoleEntries = () => ({ total: 0, returned: 0, entries: [] }),
        getVmExplorerSnippetState = () => ({ injected: false }),
        getVmSyncDiagnostics = () => null,
        getRuntimeSourceText = () => '',
        getRuntimeVersion = () => '',
        handleFileButtonClick = () => {},
        injectCodeSnippet = async () => {},
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        closeScriptConsole = () => ({ open: false }),
        execScriptConsole = async () => ({ ok: false }),
        isScriptConsoleOpen = () => false,
        openScriptConsole = async () => ({ open: true }),
        setConsoleMode = async () => {},
        setScriptConsoleFilter = () => ({}),
        setEventLogFilter = () => ({}),
        clearScriptConsole = () => {},
        clearEventLog = () => {},
        pause = () => {},
        play = () => {},
        refreshVmInputControls = () => {},
        reset = () => {},
        resetToDefaultArtboard = () => {},
        setCurrentFile = () => {},
        setCurrentCanvasSizing = () => {},
        setCanvasSizingState = (canvasSizing) => canvasSizing,
        setEditorCode = () => {},
        setLiveConfigSource = async () => ({ sourceMode: 'internal' }),
        setSidebarVisibility = () => ({ left: false, right: true }),
        setVmExplorerSnippetEnabled = async () => ({ injected: false }),
        showMcpSetup = () => {},
        switchArtboard = () => {},
        toggleInstantiationControlsDialog = async () => ({ open: false }),
        toggleLiveConfigSource = async () => {},
    } = callbacks;

    let isBound = false;

    function bind() {
        if (isBound || !windowRef) {
            return;
        }

        windowRef.applyCodeAndReload = applyCodeAndReload;
        windowRef.play = play;
        windowRef.pause = pause;
        windowRef.reset = reset;
        windowRef.createDemoBundle = createDemoBundle;
        windowRef.openIsolatedPlayback = openIsolatedPlayback;
        windowRef.injectCodeSnippet = injectCodeSnippet;
        windowRef.handleFileButtonClick = handleFileButtonClick;
        windowRef.refreshVmInputControls = refreshVmInputControls;
        windowRef.ravVmSyncDiagnostics = getVmSyncDiagnostics;
        windowRef.__riveRuntimeCache = {
            getRuntimeSourceText: (runtimeName) => getRuntimeSourceText(runtimeName || getCurrentRuntime()),
            getRuntimeVersion: (runtimeName) => getRuntimeVersion(runtimeName || getCurrentRuntime()),
        };
        windowRef.__riveAnimationCache = {
            getBuffer: () => getCurrentFileBuffer(),
            getName: () => getCurrentFileName(),
            getMimeType: () => getCurrentFileMimeType(),
        };

        windowRef._mcpSetCurrentFile = (...args) => setCurrentFile(...args);
        windowRef._mcpLoadAnimation = loadRiveAnimation;
        windowRef._mcpGetEventLog = getEventLogEntries;
        windowRef._mcpConsoleOpen = async () => openScriptConsole();
        windowRef._mcpConsoleClose = () => closeScriptConsole();
        windowRef._mcpConsoleIsOpen = () => isScriptConsoleOpen();
        windowRef._mcpConsoleRead = (limit) => getScriptConsoleEntries(limit);
        windowRef._mcpConsoleExec = async (code) => execScriptConsole(code);
        windowRef._mcpSetConsoleMode = async (mode) => {
            const normalized = mode === 'js' ? 'js' : mode === 'events' ? 'events' : mode === 'closed' ? 'closed' : null;
            if (!normalized) throw new Error("mode must be 'events', 'js', or 'closed'");
            await setConsoleMode(normalized);
            return { ok: true, mode: normalized, jsOpen: isScriptConsoleOpen() };
        };
        windowRef._mcpSetConsoleFilter = ({ mode, level, sources, search } = {}) => {
            const target = mode === 'events' || mode === 'js'
                ? mode
                : (isScriptConsoleOpen() ? 'js' : 'events');
            if (target === 'js') {
                const result = setScriptConsoleFilter({ level, search });
                return { ok: true, mode: 'js', ...result };
            }
            const result = setEventLogFilter({ sources, search });
            return { ok: true, mode: 'events', ...result };
        };
        windowRef._mcpConsoleClear = (mode) => {
            const target = mode === 'events' || mode === 'js'
                ? mode
                : (isScriptConsoleOpen() ? 'js' : 'events');
            if (target === 'js') {
                clearScriptConsole();
            } else {
                clearEventLog();
            }
            return { ok: true, mode: target };
        };
        windowRef._mcpGetEditorCode = async () => {
            await ensureEditorReady();
            return getEditorCode();
        };
        windowRef._mcpSetEditorCode = async (code) => {
            await ensureEditorReady();
            return setEditorCode(code);
        };
        windowRef._mcpLogEvent = (type, message, payload) => logEvent('mcp', type, message, payload);
        windowRef._mcpUpdateStatus = (state) => {
            updateMcpStatusChip(elements.mcpStatusChip, state);
        };
        updateMcpStatusChip(
            elements.mcpStatusChip,
            windowRef._mcpBridge?.indicatorState || windowRef._mcpBridge?.state || 'off',
        );
        windowRef._mcpExportDemoToPath = async (outputPath, options) => exportDemoToPath(outputPath, options);
        windowRef._mcpOpenIsolatedPlayback = async (options) => openIsolatedPlayback(options);
        windowRef._mcpGenerateWebInstantiationCode = async (packageSource, snippetMode) => getGenerateWebInstantiationCode(packageSource, snippetMode);
        windowRef._mcpSwitchArtboard = switchArtboard;
        windowRef._mcpResetArtboard = resetToDefaultArtboard;
        windowRef._mcpGetArtboardState = () => getArtboardStateSnapshot();
        windowRef._mcpGetCanvasSizing = () => getCurrentCanvasSizing();
        windowRef._mcpSetCanvasSizing = (canvasSizing, message) => (
            typeof setCanvasSizingState === 'function'
                ? setCanvasSizingState(canvasSizing, message)
                : (setCurrentCanvasSizing(canvasSizing), canvasSizing)
        );
        windowRef._mcpGetLiveConfigState = () => getLiveConfigState();
        windowRef._mcpGetRenderSurfaceState = () => getRenderSurfaceState();
        windowRef._mcpGetSidebarVisibility = () => getSidebarVisibility();
        windowRef._mcpGetVmExplorerSnippetState = () => getVmExplorerSnippetState();
        windowRef._mcpSetLiveConfigSource = async (sourceMode) => setLiveConfigSource(sourceMode);
        windowRef._mcpSetSidebarVisibility = (visibility) => setSidebarVisibility(visibility);
        windowRef._mcpSetVmExplorerSnippetEnabled = async (enabled) => setVmExplorerSnippetEnabled(enabled);
        windowRef._mcpToggleInstantiationControlsDialog = async (action) => toggleInstantiationControlsDialog(action);
        windowRef._mcpToggleLiveConfigSource = async () => toggleLiveConfigSource();
        windowRef.showMcpSetup = showMcpSetup;

        elements.mcpStatusChip?.addEventListener('click', () => {
            const bridge = windowRef._mcpBridge;
            const bridgeState = bridge?.indicatorState || bridge?.state;

            if (bridgeState === 'off' && typeof bridge?.enable === 'function') {
                bridge.enable();
                return;
            }

            if ((bridgeState === 'waiting' || bridgeState === 'error' || bridgeState === 'connected' || bridgeState === 'idle' || bridgeState === 'active') && typeof bridge?.disable === 'function') {
                void bridge.disable();
                return;
            }

            if (typeof bridge?.toggle === 'function') {
                void bridge.toggle();
            }
        });

        isBound = true;
    }

    return {
        bind,
    };
}
