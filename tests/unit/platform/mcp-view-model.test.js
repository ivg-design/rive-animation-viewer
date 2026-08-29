import { createViewModelCommands } from '../../../src/app/platform/mcp/commands/view-model.js';
import { createGlobalViewModelCommands } from '../../../src/app/platform/mcp/commands/global-view-model.js';
import { buildGlobalViewModelSnapshot, buildViewModelSnapshot } from '../../../src/app/platform/mcp/view-model-snapshot.js';

function createScalarAccessor(value) {
    return { value };
}

function createListItem(name, speed) {
    const accessors = {
        name: createScalarAccessor(name),
        speed: createScalarAccessor(speed),
        selected: createScalarAccessor(false),
    };
    const triggerAccessor = { trigger: vi.fn() };
    const fireAccessor = { fire: vi.fn() };

    return {
        accessors,
        fireAccessor,
        instance: {
            boolean(propertyName) {
                return propertyName === 'selected' ? accessors.selected : null;
            },
            number(propertyName) {
                return propertyName === 'speed' ? accessors.speed : null;
            },
            properties: [
                { name: 'name' },
                { name: 'speed' },
                { name: 'selected' },
                { name: 'launch' },
                { name: 'fallbackLaunch' },
            ],
            string(propertyName) {
                return propertyName === 'name' ? accessors.name : null;
            },
            trigger(propertyName) {
                if (propertyName === 'launch') {
                    return triggerAccessor;
                }
                return propertyName === 'fallbackLaunch' ? fireAccessor : null;
            },
            viewModelName: 'ListRowVM',
        },
        triggerAccessor,
    };
}

function createLiveVmHarness() {
    const rows = [createListItem('Alpha', 12)];
    const count = createScalarAccessor(1);
    const enabled = createScalarAccessor(true);
    const title = createScalarAccessor('Live title');
    const mode = createScalarAccessor('compact');
    const color = createScalarAccessor(0xff336699);
    const childValue = createScalarAccessor('nested');

    const childVm = {
        properties: [{ name: 'value' }],
        string(name) {
            return name === 'value' ? childValue : null;
        },
    };
    const listAccessor = {
        instanceAt(index) {
            return rows[index]?.instance || null;
        },
        get length() {
            return rows.length;
        },
    };
    const rootVm = {
        boolean(name) {
            return name === 'enabled' ? enabled : null;
        },
        color(name) {
            return name === 'color' ? color : null;
        },
        enum(name) {
            return name === 'mode' ? mode : null;
        },
        list(name) {
            return name === 'rows' ? listAccessor : null;
        },
        name: 'Live Root',
        number(name) {
            return name === 'count' ? count : null;
        },
        properties: [
            { name: 'count' },
            { name: 'enabled' },
            { name: 'title' },
            { name: 'mode' },
            { name: 'color' },
            { name: 'child' },
            { name: 'rows' },
        ],
        string(name) {
            return name === 'title' ? title : null;
        },
        viewModelInstance(name) {
            return name === 'child' ? childVm : null;
        },
    };

    const legacy = {
        vmFire: vi.fn(() => {
            throw new Error('legacy vmFire must not run');
        }),
        vmGet: vi.fn(() => {
            throw new Error('legacy vmGet must not run');
        }),
        vmInputs: [{ path: 'stale/value', kind: 'string', value: 'stale' }],
        vmPaths: ['stale/value'],
        vmSet: vi.fn(() => {
            throw new Error('legacy vmSet must not run');
        }),
        vmTree: { label: 'stale tree' },
    };
    const windowRef = {
        ...legacy,
        riveInst: {
            viewModelByName(name) {
                return name === 'ListRowVM' ? { instanceNames: ['Alpha', 'Bravo'] } : null;
            },
            viewModelInstance: rootVm,
        },
    };
    const commands = createViewModelCommands({ buildViewModelSnapshot, windowRef });

    return {
        accessors: { childValue, color, count, enabled, mode, title },
        commands,
        legacy,
        rootVm,
        rows,
        windowRef,
    };
}

function findTreeNode(node, path) {
    if (!node) {
        return null;
    }
    if (node.path === path) {
        return node;
    }
    for (const child of node.children || []) {
        const found = findTreeNode(child, path);
        if (found) {
            return found;
        }
    }
    return null;
}

describe('platform/mcp ViewModel traversal', () => {
    it('enumerates and mutates multiple named global ViewModels without colliding paths', async () => {
        const firstValue = createScalarAccessor('red');
        const secondValue = createScalarAccessor('blue');
        const pulse = { trigger: vi.fn() };
        const globals = {
            GlobalColors: {
                properties: [{ name: 'value' }, { name: 'pulse' }],
                string: (name) => (name === 'value' ? firstValue : null),
                trigger: (name) => (name === 'pulse' ? pulse : null),
                viewModelName: 'GlobalColors',
            },
            GlobalLabels: {
                properties: [{ name: 'value' }],
                string: (name) => (name === 'value' ? secondValue : null),
                viewModelName: 'GlobalLabels',
            },
        };
        const windowRef = {
            riveInst: {
                viewModelInstance: null,
                globalViewModelNames: () => Object.keys(globals),
                globalViewModelInstance: (name) => globals[name] || null,
            },
        };
        const commands = {
            ...createViewModelCommands({ buildViewModelSnapshot, windowRef }),
            ...createGlobalViewModelCommands({ windowRef }),
        };

        expect(buildGlobalViewModelSnapshot(windowRef)).toEqual(expect.objectContaining({
            count: 2,
            names: ['GlobalColors', 'GlobalLabels'],
        }));
        const tree = await commands.rav_get_global_vm_tree();
        expect(tree.globalViewModels[0].inputs[0]).toEqual(expect.objectContaining({
            source: 'global-view-model', globalViewModelName: 'GlobalColors', path: 'value',
        }));
        await expect(commands.rav_global_vm_get({ name: 'GlobalLabels', path: 'value' })).resolves.toEqual({
            name: 'GlobalLabels', path: 'value', kind: 'string', value: 'blue',
        });
        await commands.rav_global_vm_set({ name: 'GlobalColors', path: 'value', value: 'green' });
        expect(firstValue.value).toBe('green');
        expect(secondValue.value).toBe('blue');
        await commands.rav_global_vm_fire({ name: 'GlobalColors', path: 'pulse' });
        expect(pulse.trigger).toHaveBeenCalledOnce();
        await expect(commands.rav_global_vm_get({ name: 'Missing', path: 'value' }))
            .rejects.toThrow('Global ViewModel "Missing" not found');
        await expect(commands.rav_global_vm_set_image({
            name: 'GlobalColors', path: 'image', bytes: [0, 256],
        })).rejects.toThrow('bytes must contain only integers from 0 through 255');
        await expect(commands.rav_global_vm_clear_image({ name: 'GlobalColors', path: 'image' }))
            .rejects.toThrow('Image mutation requires the authoritative playback surface');
    });

    it('builds every snapshot from the current live root and enumerates nested and indexed list paths', () => {
        const harness = createLiveVmHarness();
        const snapshot = buildViewModelSnapshot(harness.windowRef);

        expect(snapshot.hasRoot).toBe(true);
        expect(snapshot.tree.label).toBe('Live Root');
        expect(snapshot.paths).toEqual([
            'count',
            'enabled',
            'title',
            'mode',
            'color',
            'child/value',
            'rows/0/name',
            'rows/0/speed',
            'rows/0/selected',
            'rows/0/launch',
            'rows/0/fallbackLaunch',
        ]);
        expect(snapshot.inputs).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'count', kind: 'number', value: 1 }),
            expect.objectContaining({ path: 'enabled', kind: 'boolean', value: true }),
            expect.objectContaining({ path: 'title', kind: 'string', value: 'Live title' }),
            expect.objectContaining({ path: 'mode', kind: 'enum', value: 'compact' }),
            expect.objectContaining({ path: 'color', kind: 'color', value: 0xff336699 }),
            expect.objectContaining({ path: 'child/value', kind: 'string', value: 'nested' }),
            expect.objectContaining({ path: 'rows/0/launch', kind: 'trigger', value: null }),
        ]));
        expect(findTreeNode(snapshot.tree, 'rows')).toEqual(expect.objectContaining({
            kind: 'list',
            label: 'rows [1]',
        }));
        expect(findTreeNode(snapshot.tree, 'rows/0')).toEqual(expect.objectContaining({
            kind: 'instance',
            label: 'Alpha',
        }));
        expect(snapshot.tree).not.toBe(harness.legacy.vmTree);
    });

    it('reflects same-root list growth and shrinkage on every tree and command call', async () => {
        const harness = createLiveVmHarness();

        await expect(harness.commands.rav_vm_get({ path: 'rows/0/name' })).resolves.toEqual({
            path: 'rows/0/name',
            kind: 'string',
            value: 'Alpha',
        });

        harness.rows.push(createListItem('Bravo', 27));
        const grownTree = await harness.commands.rav_get_vm_tree();
        expect(findTreeNode(grownTree.tree, 'rows').label).toBe('rows [2]');
        expect(findTreeNode(grownTree.tree, 'rows/1').label).toBe('Bravo');
        expect(grownTree.paths).toContain('rows/1/name');
        await expect(harness.commands.rav_vm_get({ path: 'rows/1/speed' })).resolves.toEqual({
            path: 'rows/1/speed',
            kind: 'number',
            value: 27,
        });

        harness.rows.splice(1, 1);
        const shrunkTree = await harness.commands.rav_get_vm_tree();
        expect(findTreeNode(shrunkTree.tree, 'rows').label).toBe('rows [1]');
        expect(shrunkTree.paths).not.toContain('rows/1/name');
        await expect(harness.commands.rav_vm_get({ path: 'rows/1/name' }))
            .rejects.toThrow('List index 1 is out of bounds for "rows" (length 1)');

        expect(harness.legacy.vmGet).not.toHaveBeenCalled();
        expect(harness.legacy.vmTree).toEqual({ label: 'stale tree' });
    });

    it('gets and sets live scalar values through root, nested VM, and indexed list paths', async () => {
        const harness = createLiveVmHarness();

        await expect(harness.commands.rav_vm_get({ path: 'child/value' })).resolves.toEqual({
            path: 'child/value',
            kind: 'string',
            value: 'nested',
        });
        await expect(harness.commands.rav_vm_get({ path: 'child.value' })).resolves.toEqual({
            path: 'child/value',
            kind: 'string',
            value: 'nested',
        });
        await expect(harness.commands.rav_vm_set({ path: 'count', value: 4 })).resolves.toEqual({
            ok: true,
            path: 'count',
            kind: 'number',
            value: 4,
        });
        await expect(harness.commands.rav_vm_set({ path: 'rows/0/selected', value: true })).resolves.toEqual({
            ok: true,
            path: 'rows/0/selected',
            kind: 'boolean',
            value: true,
        });
        await expect(harness.commands.rav_vm_set({ path: 'rows.0.selected', value: false })).resolves.toEqual({
            ok: true,
            path: 'rows/0/selected',
            kind: 'boolean',
            value: false,
        });

        expect(harness.accessors.count.value).toBe(4);
        expect(harness.rows[0].accessors.selected.value).toBe(false);
        expect(harness.legacy.vmGet).not.toHaveBeenCalled();
        expect(harness.legacy.vmSet).not.toHaveBeenCalled();
    });

    it('fires only live trigger accessors and supports both runtime trigger method names', async () => {
        const harness = createLiveVmHarness();

        await expect(harness.commands.rav_vm_fire({ path: 'rows/0/launch' })).resolves.toEqual({
            ok: true,
            path: 'rows/0/launch',
            kind: 'trigger',
        });
        await expect(harness.commands.rav_vm_fire({ path: 'rows/0/fallbackLaunch' })).resolves.toEqual({
            ok: true,
            path: 'rows/0/fallbackLaunch',
            kind: 'trigger',
        });

        expect(harness.rows[0].triggerAccessor.trigger).toHaveBeenCalledTimes(1);
        expect(harness.rows[0].fireAccessor.fire).toHaveBeenCalledTimes(1);
        expect(harness.legacy.vmFire).not.toHaveBeenCalled();
        await expect(harness.commands.rav_vm_get({ path: 'rows/0/launch' }))
            .rejects.toThrow('Property "launch" not found or not readable');
        await expect(harness.commands.rav_vm_set({ path: 'rows/0/launch', value: true }))
            .rejects.toThrow('Property "launch" not found or not writable');
        await expect(harness.commands.rav_vm_fire({ path: 'rows/0/speed' }))
            .rejects.toThrow('Trigger "speed" not found');
    });

    it('rejects malformed and invalid list indices without falling through to another path', async () => {
        const harness = createLiveVmHarness();

        await expect(harness.commands.rav_vm_get({ path: 'rows/-1/name' }))
            .rejects.toThrow('Invalid list index "-1"');
        await expect(harness.commands.rav_vm_get({ path: 'rows/1.0/name' }))
            .rejects.toThrow('Invalid list index "1.0"');
        await expect(harness.commands.rav_vm_get({ path: 'rows/1/name' }))
            .rejects.toThrow('List index 1 is out of bounds for "rows" (length 1)');
        await expect(harness.commands.rav_vm_get({ path: 'rows/0' }))
            .rejects.toThrow('must be followed by an index and property name');
        await expect(harness.commands.rav_vm_get({ path: 'rows//name' }))
            .rejects.toThrow('Invalid ViewModel path');
        await expect(harness.commands.rav_vm_get())
            .rejects.toThrow('path is required');
        await expect(harness.commands.rav_vm_set({ path: 'count' }))
            .rejects.toThrow('value is required');
    });

    it('keeps empty lists visible and terminates cyclic ViewModel graphs', () => {
        const harness = createLiveVmHarness();
        harness.rows.splice(0);
        harness.rootVm.properties.push({ name: 'self' });
        harness.rootVm.viewModelInstance = (name) => {
            if (name === 'self') {
                return harness.rootVm;
            }
            return name === 'child'
                ? { properties: [{ name: 'self' }], viewModel: () => harness.rootVm }
                : null;
        };

        const snapshot = buildViewModelSnapshot(harness.windowRef);
        expect(findTreeNode(snapshot.tree, 'rows')).toEqual(expect.objectContaining({
            label: 'rows [0]',
            children: [],
        }));
        expect(findTreeNode(snapshot.tree, 'self')).toEqual(expect.objectContaining({
            circular: true,
            children: [],
        }));
        expect(JSON.stringify(snapshot.tree).length).toBeLessThan(5000);
    });

    it('reports missing animation and missing live bindings without consulting legacy state', async () => {
        expect(buildViewModelSnapshot({})).toEqual(expect.objectContaining({
            hasRoot: false,
            message: 'No animation loaded',
        }));

        const windowRef = {
            riveInst: {},
            vmTree: { label: 'stale tree' },
            vmPaths: ['stale/value'],
        };
        expect(buildViewModelSnapshot(windowRef)).toEqual(expect.objectContaining({
            hasRoot: false,
            tree: null,
            paths: [],
            message: 'No ViewModel instance is currently bound',
        }));

        const commands = createViewModelCommands({ buildViewModelSnapshot, windowRef });
        await expect(commands.rav_get_vm_tree()).resolves.toEqual(expect.objectContaining({
            tree: null,
            paths: [],
            message: 'No ViewModel instance is currently bound',
        }));
        await expect(commands.rav_vm_get({ path: 'stale/value' }))
            .rejects.toThrow('No ViewModel available');
    });
});
