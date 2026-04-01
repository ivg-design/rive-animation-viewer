export function updateMcpStatusChip(chip, state) {
    if (!chip) {
        return;
    }

    chip.dataset.mcpState = state;
    const labels = {
        off: 'MCP Bridge: disabled (click to enable)',
        waiting: 'MCP Bridge: waiting for connection (click to disable)',
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
        getRuntimeSourceText = () => '',
        getRuntimeVersion = () => '',
        handleFileButtonClick = () => {},
        injectCodeSnippet = async () => {},
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        pause = () => {},
        play = () => {},
        refreshVmInputControls = () => {},
        reset = () => {},
        resetToDefaultArtboard = () => {},
        setCurrentFile = () => {},
        setEditorCode = () => {},
        showMcpSetup = () => {},
        switchArtboard = () => {},
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
        windowRef._mcpSwitchArtboard = switchArtboard;
        windowRef._mcpResetArtboard = resetToDefaultArtboard;
        windowRef._mcpGetArtboardState = () => getArtboardStateSnapshot();
        windowRef.showMcpSetup = showMcpSetup;

        elements.mcpStatusChip?.addEventListener('click', () => {
            if (typeof windowRef._mcpBridge?.toggle === 'function') {
                windowRef._mcpBridge.toggle();
            }
        });

        isBound = true;
    }

    return {
        bind,
    };
}
