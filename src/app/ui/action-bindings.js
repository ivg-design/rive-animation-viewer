export function bindUiActionHandlers({ elements, actions }) {
    const bindings = [
        [elements.fileTriggerButton, actions.handleFileButtonClick],
        [elements.resetButton, actions.reset],
        [elements.playButton, actions.play],
        [elements.pauseButton, actions.pause],
        [elements.demoBundleButton, actions.createDemoBundle],
        [elements.mcpSetupButton, actions.showMcpSetup],
        [elements.injectVmExplorerButton, actions.injectCodeSnippet],
        [elements.applyEditorConfigButton, actions.applyCodeAndReload],
        [elements.mcpSetupCloseButton, () => elements.mcpSetupDialog?.close()],
    ];

    bindings.forEach(([element, handler]) => {
        if (!element || typeof handler !== 'function') {
            return;
        }
        element.addEventListener('click', handler);
    });
}
