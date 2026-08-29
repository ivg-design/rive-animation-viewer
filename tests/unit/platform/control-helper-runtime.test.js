import { readFileSync } from 'node:fs';
import path from 'node:path';

const helperRuntimeSource = readFileSync(
    path.resolve(process.cwd(), 'src/app/snippets/source/web-instantiation/control-helper-runtime.js'),
    'utf8',
);
const helperControllerSource = readFileSync(
    path.resolve(process.cwd(), 'src/app/snippets/source/web-instantiation/control-helper-controller.js'),
    'utf8',
);
const helperSource = `${helperRuntimeSource}\n${helperControllerSource}`;

function createHelper(instance, vmOverrides, globalVmOverrides = {}) {
    const build = new Function(
        'riveInst',
        'VM_OVERRIDES',
        'GLOBAL_VM_OVERRIDES',
        'STATE_MACHINE_OVERRIDES',
        'VM_TRIGGER_PATHS',
        'GLOBAL_VM_TRIGGER_PATHS',
        'STATE_MACHINE_TRIGGER_INPUTS',
        `${helperSource}\nreturn ravRive;`,
    );
    return build(instance, vmOverrides, globalVmOverrides, {}, [], [], []);
}

describe('web instantiation control helper runtime', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('restores a manual bind before user writes, then retries only delayed list paths', () => {
        vi.stubGlobal('requestAnimationFrame', vi.fn());
        const playerCount = { value: 0 };
        const rows = [];
        const board = {
            list(name) {
                return name === 'rows' ? {
                    get length() { return rows.length; },
                    instanceAt(index) { return rows[index] || null; },
                } : null;
            },
            number(name) {
                return name === 'playerCount' ? playerCount : null;
            },
        };
        const unboundCount = { value: -1 };
        const instance = {
            viewModelInstance: null,
            bindViewModelInstance(nextInstance) {
                this.viewModelInstance = nextInstance;
            },
            defaultViewModel: () => ({
                defaultInstance: () => ({ number: () => unboundCount }),
            }),
        };
        const helper = createHelper(instance, {
            playerCount: 50,
            'rows/0/playerName': 'Restored Player',
        });

        helper.runOnLoad(() => {
            instance.bindViewModelInstance(board);
            playerCount.value = 100;
        });

        expect(unboundCount.value).toBe(-1);
        expect(playerCount.value).toBe(100);

        const playerName = { value: '' };
        rows.push({ string: (name) => (name === 'playerName' ? playerName : null) });
        expect(helper.retryPendingSnapshotOnAdvance()).toBe(1);
        expect(playerName.value).toBe('Restored Player');
        expect(playerCount.value).toBe(100);
    });

    it('restores and exposes named global ViewModel values independently of the bound root', () => {
        vi.stubGlobal('requestAnimationFrame', vi.fn());
        const boundValue = { value: 'bound' };
        const globalValue = { value: 'global' };
        const trigger = { trigger: vi.fn() };
        const globalRoot = {
            string: (name) => (name === 'value' ? globalValue : null),
            trigger: (name) => (name === 'pulse' ? trigger : null),
        };
        const instance = {
            viewModelInstance: { string: (name) => (name === 'value' ? boundValue : null) },
            globalViewModelNames: () => ['GlobalLabels'],
            globalViewModelInstance: (name) => (name === 'GlobalLabels' ? globalRoot : null),
        };
        const helper = createHelper(instance, {}, { GlobalLabels: { value: 'restored' } });

        expect(helper.applySnapshot()).toBe(1);
        expect(globalValue.value).toBe('restored');
        expect(boundValue.value).toBe('bound');
        expect(helper.setGlobalVmValue('GlobalLabels', 'value', 'changed', 'string')).toBe(true);
        expect(helper.fireGlobalVmTrigger('GlobalLabels', 'pulse')).toBe(true);
        expect(trigger.trigger).toHaveBeenCalledOnce();
    });
});
