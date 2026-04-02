import { createInstantiationControlsDialogController } from '../../../src/app/ui/instantiation-controls-dialog.js';

function buildElements() {
    document.body.innerHTML = `
        <dialog id="instantiation-controls-dialog"></dialog>
        <button id="instantiation-controls-close-btn"></button>
        <div id="instantiation-controls-tree"></div>
        <span id="instantiation-selection-summary"></span>
        <button id="instantiation-preset-changed-btn"></button>
        <button id="instantiation-preset-all-btn"></button>
        <button id="instantiation-preset-none-btn"></button>
        <select id="instantiation-package-source-select">
            <option value="cdn" selected>cdn</option>
            <option value="local">local</option>
        </select>
        <span id="instantiation-preview-status"></span>
        <pre id="instantiation-preview-output"></pre>
        <button id="copy-instantiation-preview-btn"></button>
        <button id="instantiation-dialog-snippet-btn"></button>
        <button id="instantiation-dialog-export-btn"></button>
    `;

    const dialog = document.getElementById('instantiation-controls-dialog');
    dialog.showModal = vi.fn(() => {
        dialog.open = true;
    });
    dialog.close = vi.fn(() => {
        dialog.open = false;
    });

    return {
        instantiationControlsDialog: dialog,
        instantiationControlsCloseButton: document.getElementById('instantiation-controls-close-btn'),
        instantiationControlsTree: document.getElementById('instantiation-controls-tree'),
        instantiationSelectionSummary: document.getElementById('instantiation-selection-summary'),
        instantiationPresetChangedButton: document.getElementById('instantiation-preset-changed-btn'),
        instantiationPresetAllButton: document.getElementById('instantiation-preset-all-btn'),
        instantiationPresetNoneButton: document.getElementById('instantiation-preset-none-btn'),
        instantiationPackageSourceSelect: document.getElementById('instantiation-package-source-select'),
        instantiationPreviewStatus: document.getElementById('instantiation-preview-status'),
        instantiationPreviewOutput: document.getElementById('instantiation-preview-output'),
        copyInstantiationPreviewButton: document.getElementById('copy-instantiation-preview-btn'),
        instantiationDialogSnippetButton: document.getElementById('instantiation-dialog-snippet-btn'),
        instantiationDialogExportButton: document.getElementById('instantiation-dialog-export-btn'),
    };
}

describe('ui/instantiation-controls-dialog', () => {
    it('defaults to changed controls, supports select-all, and forwards the selected keys into snippet generation', async () => {
        const elements = buildElements();
        const generateWebInstantiationCode = vi.fn().mockResolvedValue({ code: '<script>demo</script>' });
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                createDemoBundle: vi.fn(),
                generateWebInstantiationCode,
                getCurrentFileName: () => 'demo.riv',
                getTauriInvoker: () => vi.fn(),
                initLucideIcons: vi.fn(),
                logEvent: vi.fn(),
                showError: vi.fn(),
                updateInfo: vi.fn(),
            },
            elements,
            getChangedVmControlSnapshot: () => [{
                descriptor: {
                    kind: 'number',
                    name: 'progress',
                    path: 'card/progress',
                },
                kind: 'number',
                value: 10,
            }],
            serializeControlHierarchy: () => ({
                children: [{
                    children: [],
                    inputs: [
                        {
                            descriptor: {
                                kind: 'number',
                                name: 'progress',
                                path: 'card/progress',
                            },
                            kind: 'number',
                            name: 'progress',
                            path: 'card/progress',
                        },
                        {
                            descriptor: {
                                kind: 'boolean',
                                name: 'armed',
                                path: 'stateMachine/Main/armed',
                                source: 'state-machine',
                                stateMachineName: 'Main',
                            },
                            kind: 'boolean',
                            name: 'armed',
                            path: 'stateMachine/Main/armed',
                            source: 'state-machine',
                            stateMachineName: 'Main',
                        },
                    ],
                    kind: 'vm',
                    label: 'Root VM',
                    path: '',
                }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '__controls__',
            }),
        });

        controller.setup();
        await expect(controller.openDialog()).resolves.toEqual({ open: true, selectionCount: 1 });
        expect(controller.getSelectedControlKeys()).toEqual(['vm:card/progress:number']);
        expect(elements.instantiationSelectionSummary.textContent).toContain('1 of 2');

        elements.instantiationPresetAllButton.click();
        expect(controller.getSelectedControlKeys()).toEqual([
            'vm:card/progress:number',
            'sm:Main:armed:boolean',
        ]);

        elements.instantiationDialogSnippetButton.click();
        await vi.waitFor(() => {
            expect(generateWebInstantiationCode).toHaveBeenCalledWith({
                packageSource: 'cdn',
                selectedControlKeys: ['vm:card/progress:number', 'sm:Main:armed:boolean'],
            });
        });
        expect(elements.instantiationPreviewOutput.textContent).toContain('<script>demo</script>');
    });
});
