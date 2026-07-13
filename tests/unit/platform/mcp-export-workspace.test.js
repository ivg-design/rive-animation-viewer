import { createExportWorkspaceCommands } from '../../../src/app/platform/mcp/commands/export-workspace.js';

describe('platform/mcp/export-workspace', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('applies explicit selections against the live rerendered control tree', async () => {
        const keys = [
            'vm:scrollScale:number',
            'vm:featureRank:number',
            'vm:showPlayer:trigger',
            'vm:rows/*/introY:number',
            'vm:rows/*/introY:number',
        ];
        let selected = new Set(['vm:scrollScale:number']);

        const tree = document.createElement('div');
        tree.id = 'instantiation-controls-tree';
        const noneButton = document.createElement('button');
        noneButton.id = 'instantiation-preset-none-btn';
        const exportButton = document.createElement('button');
        exportButton.id = 'instantiation-dialog-export-btn';
        const packageSourceSelect = document.createElement('select');
        packageSourceSelect.id = 'instantiation-package-source-select';
        packageSourceSelect.innerHTML = '<option value="cdn">cdn</option><option value="local">local</option>';
        const snippetModeSelect = document.createElement('select');
        snippetModeSelect.id = 'instantiation-snippet-mode-select';
        snippetModeSelect.innerHTML = '<option value="compact">compact</option><option value="scaffold">scaffold</option>';
        document.body.append(tree, noneButton, exportButton, packageSourceSelect, snippetModeSelect);

        function renderTree() {
            const selectedAtRender = new Set(selected);
            tree.replaceChildren(...keys.map((key) => {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.setAttribute('data-control-key', key);
                checkbox.checked = selectedAtRender.has(key);
                checkbox.addEventListener('change', () => {
                    const next = new Set(selectedAtRender);
                    if (checkbox.checked) next.add(key);
                    else next.delete(key);
                    selected = next;
                    renderTree();
                });
                return checkbox;
            }));
        }

        noneButton.addEventListener('click', () => {
            selected = new Set();
            renderTree();
        });
        renderTree();

        const windowRef = {
            _mcpExportDemoToPath: vi.fn(async (path) => path),
            _mcpToggleInstantiationControlsDialog: vi.fn(async () => ({ open: true })),
        };
        const commands = createExportWorkspaceCommands({ documentRef: document, windowRef });
        const requested = [
            'vm:scrollScale:number',
            'vm:featureRank:number',
            'vm:showPlayer:trigger',
            'vm:rows/0/introY:number',
        ];
        const expectedSelection = [
            'vm:scrollScale:number',
            'vm:featureRank:number',
            'vm:showPlayer:trigger',
            'vm:rows/*/introY:number',
        ];

        const exportPromise = commands.rav_export_demo_visual({
            output_path: '/tmp/dynamic-rows.html',
            package_source: 'local',
            selection: requested,
            snippet_mode: 'scaffold',
            step_delay_ms: 0,
        });
        await vi.runAllTimersAsync();
        await expect(exportPromise).resolves.toEqual({ ok: true, path: '/tmp/dynamic-rows.html' });

        expect(Array.from(selected)).toEqual(expectedSelection);
        expect(windowRef._mcpExportDemoToPath).toHaveBeenCalledWith('/tmp/dynamic-rows.html', {
            packageSource: 'local',
            selectedControlKeys: expectedSelection,
            snippetMode: 'scaffold',
        });
        expect(windowRef._mcpToggleInstantiationControlsDialog.mock.calls).toEqual([
            ['open'],
            ['close'],
        ]);
    });

    it('rejects unknown explicit control keys instead of silently omitting them', async () => {
        document.body.innerHTML = `
            <div id="instantiation-controls-tree">
                <input type="checkbox" data-control-key="vm:playerCount:number">
            </div>
        `;
        const windowRef = {
            _mcpExportDemoToPath: vi.fn(),
            _mcpToggleInstantiationControlsDialog: vi.fn(async () => ({ open: true })),
        };
        const commands = createExportWorkspaceCommands({ documentRef: document, windowRef });

        const exportPromise = commands.rav_export_demo_visual({
            output_path: '/tmp/dynamic-rows.html',
            selection: ['vm:missing:number'],
            step_delay_ms: 0,
        });
        const rejection = expect(exportPromise).rejects.toThrow(
            'Unknown control selection key(s): vm:missing:number',
        );
        await vi.runAllTimersAsync();
        await rejection;

        expect(windowRef._mcpExportDemoToPath).not.toHaveBeenCalled();
        expect(windowRef._mcpToggleInstantiationControlsDialog.mock.calls).toEqual([
            ['open'],
            ['close'],
        ]);
    });
});
