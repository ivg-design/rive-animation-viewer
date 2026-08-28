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
        <select id="instantiation-snippet-mode-select">
            <option value="compact" selected>compact</option>
            <option value="scaffold">scaffold</option>
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
        instantiationSnippetModeSelect: document.getElementById('instantiation-snippet-mode-select'),
        instantiationPreviewStatus: document.getElementById('instantiation-preview-status'),
        instantiationPreviewOutput: document.getElementById('instantiation-preview-output'),
        copyInstantiationPreviewButton: document.getElementById('copy-instantiation-preview-btn'),
        instantiationDialogSnippetButton: document.getElementById('instantiation-dialog-snippet-btn'),
        instantiationDialogExportButton: document.getElementById('instantiation-dialog-export-btn'),
    };
}

describe('ui/instantiation-controls-dialog', () => {
    it('defaults to changed controls, keeps select-all safe for values, and forwards the selected keys into snippet generation', async () => {
        const elements = buildElements();
        const createDemoBundle = vi.fn().mockResolvedValue('/tmp/demo.html');
        const generateWebInstantiationCode = vi.fn().mockResolvedValue({ code: '<script>demo</script>' });
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                createDemoBundle,
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
                        {
                            descriptor: {
                                kind: 'trigger',
                                name: 'reset',
                                path: 'card/reset',
                            },
                            kind: 'trigger',
                            name: 'reset',
                            path: 'card/reset',
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
        expect(elements.instantiationSelectionSummary.textContent).toContain('1 of 3');

        elements.instantiationPresetAllButton.click();
        expect(controller.getSelectedControlKeys()).toEqual([
            'vm:card/progress:number',
            'sm:Main:armed:boolean',
            'vm:card/reset:trigger',
        ]);

        elements.instantiationSnippetModeSelect.value = 'scaffold';
        elements.instantiationDialogSnippetButton.click();
        await vi.waitFor(() => {
            expect(generateWebInstantiationCode).toHaveBeenCalled();
        });
        const lastCall = generateWebInstantiationCode.mock.calls.at(-1)?.[0];
        expect(lastCall).toEqual(expect.objectContaining({
            packageSource: 'cdn',
            snippetMode: 'scaffold',
        }));
        expect([...lastCall.selectedControlKeys].sort()).toEqual([
            'sm:Main:armed:boolean',
            'vm:card/progress:number',
            'vm:card/reset:trigger',
        ]);
        expect(elements.instantiationPreviewOutput.textContent).toContain('<script>demo</script>');

        elements.instantiationPackageSourceSelect.value = 'local';
        elements.instantiationDialogExportButton.click();
        await vi.waitFor(() => {
            expect(createDemoBundle).toHaveBeenCalled();
        });
        expect(createDemoBundle).toHaveBeenCalledWith({
            packageSource: 'local',
            selectedControlKeys: [
                'vm:card/progress:number',
                'sm:Main:armed:boolean',
                'vm:card/reset:trigger',
            ],
            snippetMode: 'scaffold',
        });
    });

    it('uses one dynamic field selection while counting every concrete list-item control', async () => {
        const elements = buildElements();
        const listInput = (index) => ({
            descriptor: {
                kind: 'number',
                name: 'introY',
                path: `rows/${index}/introY`,
            },
            kind: 'number',
            name: 'introY',
            path: `rows/${index}/introY`,
        });
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'leaderboard.riv',
                getTauriInvoker: () => vi.fn(),
                initLucideIcons: vi.fn(),
            },
            elements,
            getChangedVmControlSnapshot: () => [{
                ...listInput(0),
                value: 0,
            }],
            serializeControlHierarchy: () => ({
                children: [{
                    children: [
                        { children: [], inputs: [listInput(0)], kind: 'instance', label: 'Row 1', path: 'rows/0' },
                        { children: [], inputs: [listInput(1)], kind: 'instance', label: 'Row 2', path: 'rows/1' },
                    ],
                    inputs: [],
                    kind: 'list',
                    label: 'rows [2]',
                    path: 'rows',
                }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '__controls__',
            }),
        });

        controller.setup();
        await controller.openDialog();

        expect(controller.getSelectedControlKeys()).toEqual(['vm:rows/*/introY:number']);
        expect(elements.instantiationSelectionSummary.textContent).toContain('2 of 2');
        expect(elements.instantiationSelectionSummary.textContent).toContain('1 of 1 reusable field selectors');
        const itemCheckboxes = Array.from(elements.instantiationControlsTree.querySelectorAll('[data-control-key]'));
        expect(itemCheckboxes).toHaveLength(2);
        expect(itemCheckboxes.every((checkbox) => checkbox.checked)).toBe(true);
        expect(Array.from(elements.instantiationControlsTree.querySelectorAll('.instantiation-tree-badge'))
            .some((badge) => badge.textContent === '2/2')).toBe(true);
    });

    it('keeps nested branches open when toggling child checkboxes', async () => {
        const elements = buildElements();
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                createDemoBundle: vi.fn(),
                generateWebInstantiationCode: vi.fn().mockResolvedValue({ code: '' }),
                getCurrentFileName: () => 'demo.riv',
                getTauriInvoker: () => vi.fn(),
                initLucideIcons: vi.fn(),
                logEvent: vi.fn(),
                showError: vi.fn(),
                updateInfo: vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => ({
                children: [{
                    children: [{
                        children: [],
                        inputs: [{
                            descriptor: {
                                kind: 'boolean',
                                name: 'armed',
                                path: 'root/child/armed',
                            },
                            kind: 'boolean',
                            name: 'armed',
                            path: 'root/child/armed',
                        }],
                        kind: 'vm',
                        label: 'Child',
                        path: 'root/child',
                    }],
                    inputs: [],
                    kind: 'vm',
                    label: 'Root',
                    path: 'root',
                }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '__controls__',
            }),
        });

        controller.setup();
        await controller.openDialog();

        const detailsNodes = () => Array.from(elements.instantiationControlsTree.querySelectorAll('details'));
        const [rootDetails] = detailsNodes();
        rootDetails.open = true;
        rootDetails.dispatchEvent(new Event('toggle'));

        const childSummary = elements.instantiationControlsTree.querySelectorAll('summary')[1];
        const [, childDetailsBeforeToggle] = detailsNodes();
        childDetailsBeforeToggle.open = true;
        childDetailsBeforeToggle.dispatchEvent(new Event('toggle'));
        expect(childDetailsBeforeToggle.open).toBe(true);

        const childCheckbox = childSummary.querySelector('input[type="checkbox"]');
        childCheckbox.checked = true;
        childCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

        const [, childDetailsAfterToggle] = detailsNodes();
        expect(childDetailsAfterToggle.open).toBe(true);
    });

    it('refreshes an open selection tree when the live ViewModel list topology changes', async () => {
        const elements = buildElements();
        const inputs = [{
            descriptor: { kind: 'number', name: 'count', path: 'count' },
            kind: 'number',
            name: 'count',
            path: 'count',
        }];
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'dynamic.riv',
                getTauriInvoker: () => vi.fn(),
                initLucideIcons: vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => ({
                children: [{ children: [], inputs: [...inputs], kind: 'vm', label: 'Root', path: '' }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '__controls__',
            }),
        });

        controller.setup();
        await controller.openDialog();
        expect(elements.instantiationControlsTree.textContent).toContain('count (number)');

        inputs.push({
            descriptor: { kind: 'string', name: 'playerName', path: 'rows/0/playerName' },
            kind: 'string',
            name: 'playerName',
            path: 'rows/0/playerName',
        });
        document.dispatchEvent(new CustomEvent('rav:vm-topology-changed'));

        expect(elements.instantiationControlsTree.textContent).toContain('playerName (string)');
        expect(elements.instantiationSelectionSummary.textContent).toContain('0 of 2');
    });

    it('resends same-size reordered list topology until the overlay confirms delivery', async () => {
        const elements = buildElements();
        let overlayDefinition;
        const listItem = (index, label) => ({
            children: [],
            inputs: [{
                descriptor: { kind: 'number', name: 'score', path: `rows/${index}/score` },
                kind: 'number',
                name: 'score',
                path: `rows/${index}/score`,
            }],
            kind: 'instance',
            label,
            path: `rows/${index}`,
        });
        let currentHierarchy = {
            children: [{
                children: [listItem(0, 'Alice'), listItem(1, 'Bob')],
                inputs: [],
                kind: 'list',
                label: 'rows [2]',
                path: 'rows',
            }],
            inputs: [],
            kind: 'controls',
            label: 'Controls',
            path: '__controls__',
        };
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'dynamic.riv',
                getTauriInvoker: () => vi.fn(),
                initLucideIcons: vi.fn(),
                requestUiOverlay: vi.fn(async (definition) => {
                    overlayDefinition = definition;
                    return true;
                }),
            },
            elements,
            serializeControlHierarchy: () => currentHierarchy,
        });

        controller.setup();
        await expect(controller.openDialog()).resolves.toEqual({
            open: true,
            overlay: true,
            selectionCount: 0,
        });
        const initial = overlayDefinition.getState();
        overlayDefinition.onStateSynced(initial);

        currentHierarchy = {
            ...currentHierarchy,
            children: [{
                ...currentHierarchy.children[0],
                children: [listItem(0, 'Bob'), listItem(1, 'Alice')],
            }],
        };
        document.dispatchEvent(new CustomEvent('rav:vm-topology-changed'));

        const firstAttempt = overlayDefinition.getState({ incremental: true });
        const retryAttempt = overlayDefinition.getState({ incremental: true });
        expect(firstAttempt.hierarchy.children[0].children.map((node) => node.label))
            .toEqual(['Bob', 'Alice']);
        expect(retryAttempt.hierarchy).toBe(currentHierarchy);

        overlayDefinition.onStateSynced(retryAttempt);
        expect(overlayDefinition.getState({ incremental: true })).not.toHaveProperty('hierarchy');
    });

    it('captures and reapplies export tree scroll position across overlay state updates', async () => {
        const elements = buildElements();
        let overlayDefinition;
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'scroll-test.riv',
                getTauriInvoker: () => vi.fn(),
                initLucideIcons: vi.fn(),
                requestUiOverlay: vi.fn(async (definition) => {
                    overlayDefinition = definition;
                    return true;
                }),
            },
            elements,
            serializeControlHierarchy: () => ({
                children: [],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '__controls__',
            }),
        });

        await controller.openDialog();
        expect(overlayDefinition.getState().treeScrollTop).toBe(0);
        await overlayDefinition.handleAction({ action: 'tree-scroll', value: 347 });
        expect(overlayDefinition.getState({ incremental: true }).treeScrollTop).toBe(347);
    });
});
