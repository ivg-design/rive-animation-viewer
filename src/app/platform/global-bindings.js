export function updateMcpStatusChip(chip, state) {
    if (!chip) {
        return;
    }

    chip.dataset.mcpState = state;
    const labels = {
        off: 'MCP Bridge: disabled (click to enable)',
        waiting: 'MCP Bridge: disconnected (click to disable)',
        connected: 'MCP Bridge: connected (click to disable)',
    };
    chip.title = labels[state] || labels.off;
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
        getArtboardStateSnapshot = () => ({}),
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
        getScriptConsoleEntries = () => ({ total: 0, returned: 0, entries: [] }),
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
        pause = () => {},
        play = () => {},
        refreshVmInputControls = () => {},
        reset = () => {},
        resetToDefaultArtboard = () => {},
        setCurrentFile = () => {},
        setEditorCode = () => {},
        showMcpSetup = () => {},
        switchArtboard = () => {},
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
        windowRef.injectCodeSnippet = injectCodeSnippet;
        windowRef.handleFileButtonClick = handleFileButtonClick;
        windowRef.refreshVmInputControls = refreshVmInputControls;
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
        windowRef._mcpExportDemoToPath = async (outputPath) => exportDemoToPath(outputPath);
        windowRef._mcpGenerateWebInstantiationCode = async (packageSource) => getGenerateWebInstantiationCode(packageSource);
        windowRef._mcpSwitchArtboard = switchArtboard;
        windowRef._mcpResetArtboard = resetToDefaultArtboard;
        windowRef._mcpGetArtboardState = () => getArtboardStateSnapshot();
        windowRef._mcpGetLiveConfigState = () => getLiveConfigState();
        windowRef._mcpToggleLiveConfigSource = async () => toggleLiveConfigSource();
        windowRef.showMcpSetup = showMcpSetup;

        elements.mcpStatusChip?.addEventListener('click', () => {
            const bridge = windowRef._mcpBridge;
            const bridgeState = bridge?.state;

            if (bridgeState === 'off' && typeof bridge?.enable === 'function') {
                bridge.enable();
                return;
            }

            if ((bridgeState === 'waiting' || bridgeState === 'connected') && typeof bridge?.disable === 'function') {
                bridge.disable();
                return;
            }

            if (typeof bridge?.toggle === 'function') {
                bridge.toggle();
            }
        });

        isBound = true;
    }

    return {
        bind,
    };
}
