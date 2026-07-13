import { readFileSync } from 'node:fs';
import path from 'node:path';

const helperSource = readFileSync(
    path.resolve(process.cwd(), 'src/app/snippets/source/web-instantiation/control-helper-runtime.js'),
    'utf8',
);

function createHelper(instance, vmOverrides) {
    const build = new Function(
        'riveInst',
        'VM_OVERRIDES',
        'STATE_MACHINE_OVERRIDES',
        'VM_TRIGGER_PATHS',
        'STATE_MACHINE_TRIGGER_INPUTS',
        `${helperSource}\nreturn ravRive;`,
    );
    return build(instance, vmOverrides, {}, [], []);
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
});
