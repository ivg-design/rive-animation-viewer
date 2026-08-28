import {
    buildPlaybackResetContract,
    normalizeResetViewModelInstanceKey,
} from '../../../src/app/rive/reset-contract.js';
import { AUTO_BOUND_VM_INSTANCE_KEY } from '../../../src/app/rive/view-model/instances.js';

describe('rive/reset-contract', () => {
    it.each([
        ['named', 'Board', 'Board', false],
        ['runtime list index', 0, 0, false],
        ['auto', AUTO_BOUND_VM_INSTANCE_KEY, null, true],
        ['implicit auto', undefined, null, true],
    ])('preserves %s ViewModel selection across reset', (_label, input, expectedKey, expectedAutoBind) => {
        const contract = buildPlaybackResetContract({
            artboard: 'Main',
            playbackName: 'Timeline',
            playbackType: 'animation',
            viewModelInstanceKey: input,
        });

        expect(contract).toEqual(expect.objectContaining({
            animations: 'Timeline',
            artboard: 'Main',
            autoBind: expectedAutoBind,
            viewModelInstanceName: expectedKey,
        }));
    });

    it('never aliases numeric zero to auto-bound', () => {
        expect(normalizeResetViewModelInstanceKey(0)).toBe(0);
        expect(normalizeResetViewModelInstanceKey('')).toBeNull();
    });
});
