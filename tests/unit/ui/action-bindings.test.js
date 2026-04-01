import { bindUiActionHandlers } from '../../../src/app/ui/action-bindings.js';

function createButton(id) {
    const button = document.createElement('button');
    button.id = id;
    document.body.appendChild(button);
    return button;
}

describe('ui/action-bindings', () => {
    it('binds click handlers to available action elements', () => {
        const dialog = { close: vi.fn() };
        const elements = {
            fileTriggerButton: createButton('file'),
            resetButton: createButton('reset'),
            playButton: createButton('play'),
            pauseButton: createButton('pause'),
            demoBundleButton: createButton('demo'),
            mcpSetupButton: createButton('mcp'),
            injectVmExplorerButton: createButton('inject'),
            applyEditorConfigButton: createButton('apply'),
            mcpSetupCloseButton: createButton('close'),
            mcpSetupDialog: dialog,
        };
        const actions = {
            handleFileButtonClick: vi.fn(),
            reset: vi.fn(),
            play: vi.fn(),
            pause: vi.fn(),
            createDemoBundle: vi.fn(),
            showMcpSetup: vi.fn(),
            injectCodeSnippet: vi.fn(),
            applyCodeAndReload: vi.fn(),
        };

        bindUiActionHandlers({ elements, actions });

        elements.fileTriggerButton.click();
        elements.resetButton.click();
        elements.playButton.click();
        elements.pauseButton.click();
        elements.demoBundleButton.click();
        elements.mcpSetupButton.click();
        elements.injectVmExplorerButton.click();
        elements.applyEditorConfigButton.click();
        elements.mcpSetupCloseButton.click();

        expect(actions.handleFileButtonClick).toHaveBeenCalledTimes(1);
        expect(actions.reset).toHaveBeenCalledTimes(1);
        expect(actions.play).toHaveBeenCalledTimes(1);
        expect(actions.pause).toHaveBeenCalledTimes(1);
        expect(actions.createDemoBundle).toHaveBeenCalledTimes(1);
        expect(actions.showMcpSetup).toHaveBeenCalledTimes(1);
        expect(actions.injectCodeSnippet).toHaveBeenCalledTimes(1);
        expect(actions.applyCodeAndReload).toHaveBeenCalledTimes(1);
        expect(dialog.close).toHaveBeenCalledTimes(1);
    });
});
