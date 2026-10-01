import { createInstantiationControlsDialogController } from '../../../src/app/ui/instantiation-controls-dialog.js';

function buildElements() {
    document.body.innerHTML = `
        <dialog id="instantiation-controls-dialog"></dialog>
        <button id="instantiation-controls-close-btn"></button>
        <div id="instantiation-controls-tree"></div>
        <span id="instantiation-selection-summary"></span>
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
        <input type="checkbox" id="instantiation-gpu-canvas-toggle" />
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
        instantiationPresetAllButton: document.getElementById('instantiation-preset-all-btn'),
        instantiationPresetNoneButton: document.getElementById('instantiation-preset-none-btn'),
        instantiationPackageSourceSelect: document.getElementById('instantiation-package-source-select'),
        instantiationSnippetModeSelect: document.getElementById('instantiation-snippet-mode-select'),
        instantiationGpuCanvasToggle: document.getElementById('instantiation-gpu-canvas-toggle'),
        instantiationPreviewStatus: document.getElementById('instantiation-preview-status'),
        instantiationPreviewOutput: document.getElementById('instantiation-preview-output'),
        copyInstantiationPreviewButton: document.getElementById('copy-instantiation-preview-btn'),
        instantiationDialogSnippetButton: document.getElementById('instantiation-dialog-snippet-btn'),
        instantiationDialogExportButton: document.getElementById('instantiation-dialog-export-btn'),
    };
}

describe('ui/instantiation-controls-dialog', () => {
    it('defaults to all controls, keeps explicit selection, and forwards selected keys into snippet generation', async () => {
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
        await expect(controller.openDialog()).resolves.toEqual({ open: true, selectionCount: 2 });
        expect(controller.getSelectedControlKeys()).toEqual([
            'vm:card/progress:number',
            'vm:card/reset:trigger',
        ]);
        expect(elements.instantiationSelectionSummary.textContent).toContain('2 of 2');

        elements.instantiationPresetNoneButton.click();
        expect(controller.getSelectedControlKeys()).toEqual([]);
        expect(elements.instantiationSelectionSummary.textContent).toContain('0 of 2');

        elements.instantiationPresetAllButton.click();
        expect(controller.getSelectedControlKeys()).toEqual([
            'vm:card/progress:number',
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
            enableGPUCanvas: false,
            packageSource: 'local',
            selectedControlKeys: [
                'vm:card/progress:number',
                'vm:card/reset:trigger',
            ],
            snippetMode: 'scaffold',
        });
    });

    it('defaults all thirteen authoritative controls selected in the untouched export dialog', async () => {
        const elements = buildElements();
        const inputs = Array.from({ length: 13 }, (_, index) => ({
            descriptor: { kind: 'number', name: `control${index}`, path: `control${index}` },
            kind: 'number',
            name: `control${index}`,
            path: `control${index}`,
        }));
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'authoritative-13.riv',
                getTauriInvoker: () => vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => ({
                children: [{ children: [], inputs, kind: 'vm', label: 'MainVM', path: '<root>' }],
                inputs: [], kind: 'controls', label: 'Controls', path: '<controls>',
            }),
        });

        controller.setup();
        await expect(controller.openDialog()).resolves.toMatchObject({ open: true, selectionCount: 13 });
        expect(controller.getSelectedControlKeys()).toHaveLength(13);
        expect(elements.instantiationControlsTree.querySelectorAll('[data-control-key]:checked')).toHaveLength(13);
    });

    it('defaults to all controls when the first authoritative hierarchy arrives, while preserving an explicit clear', async () => {
        const elements = buildElements();
        let hierarchy = { children: [], inputs: [], kind: 'controls', label: 'Controls', path: '__controls__' };
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'late-hierarchy.riv',
                getTauriInvoker: () => vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => hierarchy,
        });
        controller.setup();
        await controller.openDialog();
        expect(controller.getSelectedControlKeys()).toEqual([]);

        hierarchy = {
            children: [{ children: [], inputs: [{
                descriptor: { kind: 'number', name: 'x', path: 'x' },
                kind: 'number', name: 'x', path: 'x',
            }], kind: 'vm', label: 'Root VM', path: '' }],
            inputs: [], kind: 'controls', label: 'Controls', path: '__controls__',
        };
        document.dispatchEvent(new CustomEvent('rav:vm-topology-changed'));
        expect(controller.getSelectedControlKeys()).toEqual(['vm:x:number']);

        elements.instantiationPresetNoneButton.click();
        expect(controller.getSelectedControlKeys()).toEqual([]);
        document.dispatchEvent(new CustomEvent('rav:vm-topology-changed'));
        expect(controller.getSelectedControlKeys()).toEqual([]);
    });

    it('leaves untouched background exports unscoped after the source changes without reopening the dialog', async () => {
        const elements = buildElements();
        const hierarchyFor = (path) => ({
            children: [{
                children: [],
                inputs: [{
                    descriptor: { kind: 'number', name: path, path },
                    kind: 'number', name: path, path,
                }],
                kind: 'vm', label: 'Root VM', path: '',
            }],
            inputs: [], kind: 'controls', label: 'Controls', path: '__controls__',
        });
        let fileName = 'capybara.riv';
        let selectionScope = {
            artboardKey: 'Capybara',
            runtimeKey: 'webgl2@2.44.0',
            sourceIdentity: 'capybara-source',
            vmInstanceKey: 'Clara',
        };
        let hierarchy = hierarchyFor('look-x');
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => fileName,
                getCurrentSelectionScope: () => selectionScope,
                getTauriInvoker: () => vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => hierarchy,
        });

        await controller.openDialog();
        expect(controller.getSelectedControlKeys()).toEqual(['vm:look-x:number']);
        expect(controller.getExportControlSelection()).toBeNull();

        fileName = 'teachers-pet.riv';
        selectionScope = {
            artboardKey: 'SCENE',
            runtimeKey: 'webgl2@2.44.0',
            sourceIdentity: 'teachers-pet-source',
            vmInstanceKey: 'Teachers Pet',
        };
        hierarchy = hierarchyFor('cursor_boolean');

        expect(controller.getExportControlSelection()).toBeNull();
        await controller.toggleDialog('close');
        await controller.openDialog();
        expect(controller.getSelectedControlKeys()).toEqual(['vm:cursor_boolean:number']);
    });

    it('applies an explicit selection only within its source, artboard, and ViewModel scope', async () => {
        const elements = buildElements();
        const hierarchyFor = (...paths) => ({
            children: [{
                children: [],
                inputs: paths.map((path) => ({
                    descriptor: { kind: 'number', name: path, path },
                    kind: 'number', name: path, path,
                })),
                kind: 'vm', label: 'Root VM', path: '',
            }],
            inputs: [], kind: 'controls', label: 'Controls', path: '__controls__',
        });
        let selectionScope = {
            artboardKey: 'Main',
            runtimeKey: 'canvas@2.44.0',
            sourceIdentity: 'scoped-source',
            vmInstanceKey: 'Primary',
        };
        let hierarchy = hierarchyFor('x', 'y');
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'scoped.riv',
                getCurrentSelectionScope: () => selectionScope,
                getTauriInvoker: () => vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => hierarchy,
        });

        await controller.openDialog();
        controller.configureForMcp({ selection: ['vm:x:number'] });
        expect(controller.getExportControlSelection()).toEqual({
            keys: ['vm:x:number'],
            scope: expect.objectContaining(selectionScope),
        });

        hierarchy = hierarchyFor('y');
        expect(controller.getExportControlSelection()).toEqual({
            keys: ['vm:x:number'],
            scope: expect.objectContaining(selectionScope),
        });

        selectionScope = { ...selectionScope, artboardKey: 'Secondary' };
        hierarchy = hierarchyFor('z');
        expect(controller.getExportControlSelection()).toEqual({
            keys: ['vm:x:number'],
            scope: expect.objectContaining({ artboardKey: 'Main' }),
        });

        controller.configureForMcp({ selection: ['vm:z:number'] });
        expect(controller.getExportControlSelection()).toEqual({
            keys: ['vm:z:number'],
            scope: expect.objectContaining(selectionScope),
        });

        selectionScope = { ...selectionScope, vmInstanceKey: 'Alternate' };
        expect(controller.getExportControlSelection()).toEqual({
            keys: ['vm:z:number'],
            scope: expect.objectContaining({ vmInstanceKey: 'Primary' }),
        });
    });

    it('preserves explicit subset and Clear selections across renderer and runtime-version changes', async () => {
        const elements = buildElements();
        const hierarchy = {
            children: [{
                children: [],
                inputs: ['x', 'y'].map((path) => ({
                    descriptor: { kind: 'number', name: path, path },
                    kind: 'number', name: path, path,
                })),
                kind: 'vm', label: 'Root VM', path: '',
            }],
            inputs: [], kind: 'controls', label: 'Controls', path: '__controls__',
        };
        let selectionScope = {
            artboardKey: 'Main',
            runtimeKey: 'webgl2@2.44.0',
            sourceIdentity: 'same-source',
            vmInstanceKey: 'Primary',
        };
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'same-source.riv',
                getCurrentSelectionScope: () => selectionScope,
                getTauriInvoker: () => vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => hierarchy,
        });

        await controller.openDialog();
        controller.configureForMcp({ selection: ['vm:x:number'] });
        await controller.toggleDialog('close');

        selectionScope = { ...selectionScope, runtimeKey: 'canvas@2.44.0' };
        await controller.openDialog();
        expect(controller.getSelectedControlKeys()).toEqual(['vm:x:number']);
        await controller.toggleDialog('close');

        selectionScope = { ...selectionScope, runtimeKey: 'canvas@2.45.0' };
        await controller.openDialog();
        expect(controller.getSelectedControlKeys()).toEqual(['vm:x:number']);

        controller.configureForMcp({ selection: 'none' });
        await controller.toggleDialog('close');
        selectionScope = { ...selectionScope, runtimeKey: 'webgl2@2.45.0' };
        await controller.openDialog();
        expect(controller.getSelectedControlKeys()).toEqual([]);
        await controller.toggleDialog('close');

        selectionScope = { ...selectionScope, runtimeKey: 'webgl2@2.46.0' };
        await controller.openDialog();
        expect(controller.getSelectedControlKeys()).toEqual([]);
    });

    it.each([
        ['source file', { sourceIdentity: 'other-source' }],
        ['artboard', { artboardKey: 'Secondary' }],
        ['ViewModel instance', { vmInstanceKey: 'Alternate' }],
    ])('resets an explicit selection after a %s change', async (_label, changedScope) => {
        const elements = buildElements();
        const hierarchy = {
            children: [{
                children: [],
                inputs: ['x', 'y'].map((path) => ({
                    descriptor: { kind: 'number', name: path, path },
                    kind: 'number', name: path, path,
                })),
                kind: 'vm', label: 'Root VM', path: '',
            }],
            inputs: [], kind: 'controls', label: 'Controls', path: '__controls__',
        };
        let selectionScope = {
            artboardKey: 'Main',
            runtimeKey: 'webgl2@2.44.0',
            sourceIdentity: 'same-source',
            vmInstanceKey: 'Primary',
        };
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                getCurrentFileName: () => 'scoped.riv',
                getCurrentSelectionScope: () => selectionScope,
                getTauriInvoker: () => vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => hierarchy,
        });

        await controller.openDialog();
        controller.configureForMcp({ selection: ['vm:x:number'] });
        await controller.toggleDialog('close');
        selectionScope = { ...selectionScope, ...changedScope };

        await controller.openDialog();
        expect(controller.getSelectedControlKeys()).toEqual(['vm:x:number', 'vm:y:number']);
        expect(controller.getExportControlSelection()).toBeNull();
    });

    it('initializes the export override from the toolbar and applies dialog changes to both output paths', async () => {
        const elements = buildElements();
        const createDemoBundle = vi.fn().mockResolvedValue('/tmp/gpu-demo.html');
        const generateWebInstantiationCode = vi.fn().mockResolvedValue({ code: 'gpu snippet' });
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                createDemoBundle,
                generateWebInstantiationCode,
                getCurrentFileName: () => 'shader.riv',
                getCurrentRuntime: () => 'webgl2',
                getGpuCanvasEnabled: () => true,
                getTauriInvoker: () => vi.fn(),
            },
            elements,
            serializeControlHierarchy: () => ({ children: [], inputs: [], kind: 'controls' }),
        });

        controller.setup();
        await controller.openDialog();
        expect(elements.instantiationGpuCanvasToggle.checked).toBe(true);
        expect(controller.getExportGpuCanvasEnabled()).toBe(true);

        elements.instantiationGpuCanvasToggle.checked = false;
        elements.instantiationGpuCanvasToggle.dispatchEvent(new Event('change'));
        elements.instantiationDialogSnippetButton.click();
        elements.instantiationDialogExportButton.click();

        await vi.waitFor(() => {
            expect(generateWebInstantiationCode).toHaveBeenCalledWith(expect.objectContaining({ enableGPUCanvas: false }));
            expect(createDemoBundle).toHaveBeenCalledWith(expect.objectContaining({ enableGPUCanvas: false }));
        });
        expect(controller.getExportGpuCanvasEnabled()).toBe(false);
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
        expect(elements.instantiationSelectionSummary.textContent).toContain('2 of 2');
        expect(Array.from(elements.instantiationControlsTree.querySelectorAll('[data-control-key]'))
            .every((checkbox) => checkbox.checked)).toBe(true);
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
            selectionCount: 1,
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

    it('configures and closes native-overlay controls without querying the hidden host tree', async () => {
        const elements = buildElements();
        let overlayDefinition;
        const closeUiOverlay = vi.fn().mockResolvedValue(true);
        const dirtyListener = vi.fn();
        document.addEventListener('rav:ui-overlay-state-dirty', dirtyListener);
        const controller = createInstantiationControlsDialogController({
            callbacks: {
                closeUiOverlay,
                getCurrentFileName: () => 'overlay-export.riv',
                getTauriInvoker: () => vi.fn(),
                initLucideIcons: vi.fn(),
                requestUiOverlay: vi.fn(async (definition) => {
                    overlayDefinition = definition;
                    return true;
                }),
            },
            elements,
            serializeControlHierarchy: () => ({
                children: [{
                    children: [],
                    inputs: [
                        {
                            descriptor: { kind: 'string', name: 'name', path: 'name' },
                            kind: 'string',
                            name: 'name',
                            path: 'name',
                        },
                        {
                            descriptor: { kind: 'color', name: 'accentColor', path: 'accentColor' },
                            kind: 'color',
                            name: 'accentColor',
                            path: 'accentColor',
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

        await expect(controller.openDialog()).resolves.toEqual({
            open: true,
            overlay: true,
            selectionCount: 2,
        });
        expect(elements.instantiationControlsTree.querySelectorAll('[data-control-key]')).toHaveLength(0);

        expect(controller.configureForMcp({
            packageSource: 'local',
            selection: ['vm:name:string'],
            snippetMode: 'scaffold',
        })).toEqual(expect.objectContaining({
            packageSource: 'local',
            selectedControlKeys: ['vm:name:string'],
            snippetMode: 'scaffold',
        }));
        expect(overlayDefinition.getState()).toEqual(expect.objectContaining({
            packageSource: 'local',
            selectedControlKeys: ['vm:name:string'],
            snippetMode: 'scaffold',
        }));
        expect(dirtyListener).toHaveBeenCalled();
        expect(() => controller.configureForMcp({
            selection: ['vm:missing:string'],
        })).toThrow('Unknown control selection key(s): vm:missing:string');

        await expect(controller.toggleDialog('close')).resolves.toEqual({ open: false });
        expect(closeUiOverlay).toHaveBeenCalledWith({ restoreFocus: true });
        document.removeEventListener('rav:ui-overlay-state-dirty', dirtyListener);
    });
});
