import { readFileSync } from 'node:fs';
import path from 'node:path';

const templateRoot = path.resolve(process.cwd(), 'src-tauri/src/demo-template/js');
const accessorsSource = readFileSync(path.join(templateRoot, 'vm/accessors.js'), 'utf8');
const hierarchySource = readFileSync(path.join(templateRoot, 'vm/hierarchy.js'), 'utf8');
const riveLoaderSource = readFileSync(path.join(templateRoot, 'core/rive-loader.js'), 'utf8');
const editorConfigSource = readFileSync(path.join(templateRoot, 'core/editor-config.js'), 'utf8');
const controlsRenderSource = readFileSync(path.join(templateRoot, 'vm/controls-render.js'), 'utf8');
const syncSource = readFileSync(path.join(templateRoot, 'vm/sync.js'), 'utf8');

function createDemoVmHarness(riveInstance, { controlSelectionKeys = null, controlSnapshot = [], vmHierarchy = null } = {}) {
    const build = new Function('riveInstance', 'CONTROL_SELECTION_KEYS', 'CONTROL_SNAPSHOT', 'VM_HIERARCHY', `
        const VM_CONTROL_SYNC_INTERVAL_MS = 120;
        const VM_CONTROL_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color', 'image', 'trigger']);
        let vmControlBindings = [];
        let vmControlSyncTimer = null;
        let vmListTopologySignature = null;
        let pendingControlSnapshot = new Map();
        let topologyRenderCount = 0;
        let renderedHierarchy = null;
        function controlSnapshotKeyForDescriptor(descriptor) {
            if (!descriptor) return null;
            if (descriptor.source === 'state-machine') {
                return 'sm:' + (descriptor.stateMachineName || '') + ':' + (descriptor.name || '') + ':' + (descriptor.kind || '');
            }
            return 'vm:' + (descriptor.path || '') + ':' + (descriptor.kind || '');
        }
        function controlSelectionKeyForDescriptor(descriptor) {
            if (!descriptor) return null;
            if (descriptor.source === 'state-machine') return controlSnapshotKeyForDescriptor(descriptor);
            return normalizeControlSelectionKey(controlSnapshotKeyForDescriptor(descriptor));
        }
        function normalizeControlSelectionKey(key) {
            if (typeof key !== 'string') return null;
            const trimmed = key.trim();
            if (!trimmed.startsWith('vm:')) return trimmed || null;
            const kindSeparator = trimmed.lastIndexOf(':');
            if (kindSeparator <= 3) return trimmed || null;
            const path = trimmed.slice(3, kindSeparator)
                .split('/')
                .map((segment) => /^(0|[1-9]\\d*)$/.test(segment) ? '*' : segment)
                .join('/');
            return 'vm:' + path + ':' + trimmed.slice(kindSeparator + 1);
        }
        function countHierarchyInputs(node) {
            if (!node) return 0;
            let total = Array.isArray(node.inputs) ? node.inputs.length : 0;
            (node.children || []).forEach((child) => {
                total += countHierarchyInputs(child);
            });
            return total;
        }
        const ALLOWED_CONTROL_KEYS = new Set(
            (CONTROL_SELECTION_KEYS || CONTROL_SNAPSHOT
                .map((entry) => controlSelectionKeyForDescriptor(entry?.descriptor || entry)))
                .map((key) => normalizeControlSelectionKey(key))
                .filter(Boolean)
        );
        ${accessorsSource}
        ${hierarchySource}
        function renderVmControls() {
            topologyRenderCount += 1;
            const rootVm = resolveVmRootInstance();
            vmListTopologySignature = buildVmListTopologySignature(rootVm);
            renderedHierarchy = filterHierarchyNode(buildVmHierarchy(rootVm));
        }
        ${syncSource}
        return {
            applyControlSnapshot,
            bindViewModelInstanceByKey,
            buildVmHierarchy,
            filterHierarchyNode,
            formatVmListItemLabel,
            initializeTopology: () => {
                vmListTopologySignature = buildVmListTopologySignature(resolveVmRootInstance());
                return vmListTopologySignature;
            },
            retryPendingControlSnapshot,
            syncVmControlTopology,
            pendingCount: () => pendingControlSnapshot.size,
            renderedHierarchy: () => renderedHierarchy,
            topologyRenderCount: () => topologyRenderCount,
        };
    `);
    return build(riveInstance, controlSelectionKeys, controlSnapshot, vmHierarchy);
}

function createHierarchyInput(path, kind = 'string') {
    const name = path.split('/').pop();
    return {
        descriptor: { kind, name, path },
        kind,
        name,
        path,
    };
}

function createExportHierarchy(rowCount) {
    return {
        children: [{
            children: Array.from({ length: rowCount }, (_, index) => ({
                children: [],
                inputs: [createHierarchyInput(`rows/${index}/playerName`)],
                kind: 'instance',
                label: `Row ${index + 1}`,
                path: `rows/${index}`,
            })),
            inputs: [],
            kind: 'list',
            label: `rows [${rowCount}]`,
            path: 'rows',
        }],
        inputs: [
            createHierarchyInput('scrollScale', 'number'),
            createHierarchyInput('featureRank', 'number'),
            createHierarchyInput('playerCount', 'number'),
            createHierarchyInput('showPlayer', 'trigger'),
            createHierarchyInput('focusIndex', 'number'),
        ],
        kind: 'vm',
        label: 'LeaderboardVM',
        path: '<root>',
    };
}

function stripHierarchyDescriptors(node) {
    return {
        ...node,
        children: (node.children || []).map(stripHierarchyDescriptors),
        inputs: (node.inputs || []).map(({ descriptor: _descriptor, ...input }) => input),
    };
}

describe('exported demo ViewModel snapshot runtime', () => {
    it('executes the distinctive applied editor callback from exported config', () => {
        const build = new Function(`${editorConfigSource}; return { resolveStandaloneEditorConfig, invokeStandaloneEditorCallback };`);
        const helpers = build();
        const applied = helpers.resolveStandaloneEditorConfig(
            '({ marker: "applied-editor", onLoad: function () { this.markerSeen = true; } })',
            'editor',
        );
        const instance = {};
        helpers.invokeStandaloneEditorCallback(applied.onLoad, instance, []);
        expect(applied.marker).toBe('applied-editor');
        expect(instance.markerSeen).toBe(true);
    });

    it('keeps standalone image controls wired to runtime decode and clear', () => {
        expect(controlsRenderSource).toContain("descriptor.kind === 'image'");
        expect(controlsRenderSource).toContain('rive.decodeImage');
        expect(controlsRenderSource).toContain('live.value = null');
    });

    it('disables runtime auto-binding only when an explicit instance is configured', () => {
        expect(riveLoaderSource).toContain('autoBind: !CONFIG.viewModelInstanceName');
        expect(riveLoaderSource).toContain('bindViewModelInstanceByKey(riveInstance, CONFIG.viewModelInstanceName)');
    });

    it('binds a configured ViewModel instance by name and falls back to index', () => {
        const named = { name: 'Board' };
        const indexed = { index: 0 };
        const bindViewModelInstance = vi.fn();
        const riveInstance = {
            bindViewModelInstance,
            defaultViewModel: () => ({
                instanceByIndex: (index) => (index === 0 ? indexed : null),
                instanceByName: (name) => (name === 'Board' ? named : null),
            }),
        };
        const harness = createDemoVmHarness(riveInstance);

        expect(harness.bindViewModelInstanceByKey(riveInstance, 'Board')).toBe(true);
        expect(bindViewModelInstance).toHaveBeenLastCalledWith(named);
        expect(harness.bindViewModelInstanceByKey(riveInstance, '0')).toBe(true);
        expect(bindViewModelInstance).toHaveBeenLastCalledWith(indexed);
        expect(harness.bindViewModelInstanceByKey(riveInstance, 'Missing')).toBe(false);
    });

    it('applies an available count once and restores a delayed list row later', () => {
        const playerCount = { value: 0 };
        const rows = [];
        const riveInstance = {
            stateMachineNames: [],
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    get length() { return rows.length; },
                    instanceAt: (index) => rows[index] || null,
                } : null),
                number: (name) => (name === 'playerCount' ? playerCount : null),
            },
        };
        const harness = createDemoVmHarness(riveInstance);

        expect(harness.applyControlSnapshot([
            {
                descriptor: { kind: 'number', name: 'playerCount', path: 'playerCount' },
                kind: 'number',
                value: 50,
            },
            {
                descriptor: { kind: 'string', name: 'playerName', path: 'rows/0/playerName' },
                kind: 'string',
                value: 'Restored Player',
            },
        ])).toBe(1);
        expect(playerCount.value).toBe(50);
        expect(harness.pendingCount()).toBe(1);

        playerCount.value = 100;
        const playerName = { value: '' };
        rows.push({ string: (name) => (name === 'playerName' ? playerName : null) });

        expect(harness.retryPendingControlSnapshot()).toBe(1);
        expect(playerName.value).toBe('Restored Player');
        expect(playerCount.value).toBe(100);
        expect(harness.pendingCount()).toBe(0);
    });

    it('rerenders when an empty list gains delayed items, grows, and shrinks', () => {
        const rows = [];
        const listAccessor = {
            get length() { return rows.length; },
            instanceAt: (index) => rows[index] || null,
        };
        const riveInstance = {
            stateMachineNames: [],
            viewModelInstance: {
                list: (name) => (name === 'rows' ? listAccessor : null),
                properties: [{ name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance);

        expect(harness.initializeTopology()).toContain('["list","rows",0]');
        expect(harness.syncVmControlTopology()).toBe(false);

        rows.push(null);
        expect(harness.syncVmControlTopology()).toBe(true);
        expect(harness.topologyRenderCount()).toBe(1);

        rows[0] = { properties: [] };
        expect(harness.syncVmControlTopology()).toBe(true);

        rows.push({ properties: [] });
        expect(harness.syncVmControlTopology()).toBe(true);

        rows.splice(1, 1);
        expect(harness.syncVmControlTopology()).toBe(true);
        expect(harness.syncVmControlTopology()).toBe(false);
        expect(harness.topologyRenderCount()).toBe(4);
    });

    it('hides excluded root controls while extending a selected list field to new rows', () => {
        const exportedHierarchy = createExportHierarchy(2);
        const controlSnapshot = [
            createHierarchyInput('playerCount', 'number'),
            createHierarchyInput('rows/0/playerName'),
            createHierarchyInput('rows/1/playerName'),
        ];
        const harness = createDemoVmHarness(null, { controlSnapshot, vmHierarchy: exportedHierarchy });
        const grownHierarchy = stripHierarchyDescriptors(createExportHierarchy(3));

        const filtered = harness.filterHierarchyNode(grownHierarchy);
        expect(filtered.inputs.map((input) => input.path)).toEqual(['playerCount']);
        expect(filtered.inputs.map((input) => input.path)).not.toContain('focusIndex');
        expect(filtered.children[0].children.flatMap((child) => child.inputs.map((input) => input.path))).toEqual([
            'rows/0/playerName',
            'rows/1/playerName',
            'rows/2/playerName',
        ]);
        expect(filtered.totalInputs).toBe(4);
    });

    it('treats a selected list field as a family even when only some exported rows had changed values', () => {
        const exportedHierarchy = createExportHierarchy(2);
        const controlSnapshot = [createHierarchyInput('rows/0/playerName')];
        const harness = createDemoVmHarness(null, { controlSnapshot, vmHierarchy: exportedHierarchy });

        const filtered = harness.filterHierarchyNode(createExportHierarchy(3));
        expect(filtered.children[0].children).toHaveLength(3);
        expect(filtered.children[0].children.map((child) => child.path)).toEqual([
            'rows/0',
            'rows/1',
            'rows/2',
        ]);
    });

    it('expands ten selected row values across all 180 live rows without exposing focusIndex', () => {
        const exportedHierarchy = createExportHierarchy(150);
        const controlSnapshot = [
            createHierarchyInput('scrollScale', 'number'),
            createHierarchyInput('featureRank', 'number'),
            createHierarchyInput('playerCount', 'number'),
            createHierarchyInput('showPlayer', 'trigger'),
            ...Array.from({ length: 10 }, (_, index) => createHierarchyInput(`rows/${index}/playerName`)),
        ];
        const harness = createDemoVmHarness(null, { controlSnapshot, vmHierarchy: exportedHierarchy });

        const filtered = harness.filterHierarchyNode(stripHierarchyDescriptors(createExportHierarchy(180)));
        expect(filtered.inputs.map((input) => input.path)).toEqual([
            'scrollScale',
            'featureRank',
            'playerCount',
            'showPlayer',
        ]);
        expect(filtered.inputs.some((input) => input.path === 'focusIndex')).toBe(false);
        expect(filtered.children[0].children).toHaveLength(180);
        expect(filtered.children[0].children[0].label).toBe('Row 1');
        expect(filtered.children[0].children[179].label).toBe('Row 180');
        expect(filtered.totalInputs).toBe(184);
    });

    it('builds one-based list-aware labels for live list instances', () => {
        const rows = Array.from({ length: 3 }, (_, index) => ({
            properties: [{ name: 'playerName' }],
            string: (name) => (name === 'playerName' ? { value: `Player ${index + 1}` } : null),
        }));
        const riveInstance = {
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    instanceAt: (index) => rows[index] || null,
                    length: rows.length,
                } : null),
                properties: [{ name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance, {
            controlSelectionKeys: ['vm:rows/*/playerName:string'],
        });

        const hierarchy = harness.filterHierarchyNode(harness.buildVmHierarchy(riveInstance.viewModelInstance));
        expect(hierarchy.children[0].children.map((child) => child.label)).toEqual([
            'Row 1',
            'Row 2',
            'Row 3',
        ]);
        expect(harness.formatVmListItemLabel('playerEntries', 3)).toBe('Player Entry 4');
    });

    it('uses authored list instance names and discovers image controls', () => {
        const imageAccessor = { value: null };
        const rows = [
            {
                name: 'First Authored Row',
                image: (name) => (name === 'avatar' ? imageAccessor : null),
                properties: [{ name: 'avatar' }],
            },
        ];
        const riveInstance = {
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    instanceAt: (index) => rows[index] || null,
                    length: rows.length,
                } : null),
                properties: [{ name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance, {
            controlSelectionKeys: ['vm:rows/*/avatar:image'],
        });

        const hierarchy = harness.filterHierarchyNode(harness.buildVmHierarchy(riveInstance.viewModelInstance));
        expect(hierarchy.children[0].children[0].label).toBe('First Authored Row');
        expect(hierarchy.children[0].children[0].inputs[0]).toEqual(expect.objectContaining({
            kind: 'image',
            path: 'rows/0/avatar',
        }));
    });

    it('tracks playerCount-driven list growth and shrinkage in the rendered hierarchy', () => {
        const playerCount = { value: 150 };
        const createRow = (index) => ({
            number: (name) => (name === 'introY' ? { value: index } : null),
            properties: [{ name: 'introY' }],
        });
        const rows = Array.from({ length: playerCount.value }, (_, index) => createRow(index));
        const resizeRows = (count) => {
            playerCount.value = count;
            if (rows.length > count) rows.length = count;
            while (rows.length < count) rows.push(createRow(rows.length));
        };
        const riveInstance = {
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    get length() { return rows.length; },
                    instanceAt: (index) => rows[index] || null,
                } : null),
                number: (name) => (name === 'playerCount' ? playerCount : null),
                properties: [{ name: 'playerCount' }, { name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance, {
            controlSelectionKeys: [
                'vm:playerCount:number',
                'vm:rows/*/introY:number',
            ],
        });

        harness.initializeTopology();
        resizeRows(180);
        expect(harness.syncVmControlTopology()).toBe(true);
        expect(harness.renderedHierarchy().children[0].children).toHaveLength(180);
        expect(harness.renderedHierarchy().children[0].children[179].label).toBe('Row 180');
        expect(harness.renderedHierarchy().totalInputs).toBe(181);

        resizeRows(7);
        expect(harness.syncVmControlTopology()).toBe(true);
        expect(harness.renderedHierarchy().children[0].children).toHaveLength(7);
        expect(harness.renderedHierarchy().children[0].children[6].label).toBe('Row 7');
        expect(harness.renderedHierarchy().totalInputs).toBe(8);
    });

    it('renders no Properties hierarchy when the export selection is empty', () => {
        const exportedHierarchy = createExportHierarchy(2);
        const harness = createDemoVmHarness(null, {
            controlSelectionKeys: [],
            controlSnapshot: [createHierarchyInput('rows/0/playerName')],
            vmHierarchy: exportedHierarchy,
        });

        expect(harness.filterHierarchyNode(stripHierarchyDescriptors(exportedHierarchy))).toBeNull();
    });
});
