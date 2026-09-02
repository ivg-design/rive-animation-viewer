import {
    clearStateMachineInputMetadata,
    getStateMachineInputMetadata,
    getStateMachineNames,
    isModernRuntime,
    normalizePlaybackConfig,
} from '../../../src/app/rive/runtime-compatibility.js';

describe('Rive runtime compatibility', () => {
    it.each(['2.41.0', 'v2.41.1', '2.42.0', '3.0.0', '2.41.0+build'])('uses the singular API on %s', (version) => {
        expect(isModernRuntime(version)).toBe(true);
        expect(normalizePlaybackConfig({ stateMachines: ['main'] }, version)).toEqual({ stateMachine: 'main' });
    });

    it.each(['2.40.1', '1.99.0', '', null, 'latest', 'garbage', '2.41.0-beta'])('keeps safe legacy emission on %s', (version) => {
        expect(isModernRuntime(version)).toBe(false);
        expect(normalizePlaybackConfig({ stateMachine: 'main' }, version)).toEqual({ stateMachines: 'main' });
    });

    it('accepts either spelling without mutating user config or setting both aliases', () => {
        const config = { autoBind: true, stateMachines: ['main'], animations: [] };
        expect(normalizePlaybackConfig(config, '2.41.0')).toEqual({ autoBind: true, stateMachine: 'main' });
        expect(config).toEqual({ autoBind: true, stateMachines: ['main'], animations: [] });
        expect(getStateMachineNames({ stateMachine: '', stateMachines: ['main', '', null] })).toEqual(['main']);
        expect(getStateMachineNames({ stateMachine: 'chosen', stateMachines: ['old'] })).toEqual(['chosen']);
    });

    it('preserves explicit multi-machine, timeline, and mixed legacy playback', () => {
        expect(normalizePlaybackConfig({ stateMachines: ['one', 'two'] }, '2.41.0'))
            .toEqual({ stateMachines: ['one', 'two'] });
        expect(normalizePlaybackConfig({ stateMachines: 'one', animations: ['idle'] }, '2.41.0'))
            .toEqual({ stateMachines: 'one', animations: ['idle'] });
        expect(normalizePlaybackConfig({ animations: 'idle' }, '2.41.0')).toEqual({ animations: 'idle' });
    });

    it('honors modern singular precedence and never invents an empty default-machine sentinel', () => {
        expect(normalizePlaybackConfig({ stateMachine: 'chosen', stateMachines: 'old', animations: 'idle' }, '2.41.0'))
            .toEqual({ stateMachine: 'chosen' });
        expect(normalizePlaybackConfig({ stateMachine: '', stateMachines: [], animations: undefined }, '2.41.0'))
            .toEqual({});
    });

    it('only treats exact active-artboard metadata as evidence of empty legacy inputs', () => {
        const inputs = [{ name: 'progress', type: 56 }];
        const instance = {
            activeArtboard: 'Main',
            contents: { artboards: [
                { name: 'Other', stateMachines: [{ name: 'sm', inputs }] },
                { name: 'Main', stateMachines: [{ name: 'sm', inputs: [] }] },
            ] },
        };
        expect(getStateMachineInputMetadata(instance, 'sm')).toEqual([]);
        expect(getStateMachineInputMetadata(instance, 'missing')).toBeNull();
        expect(getStateMachineInputMetadata({ ...instance, activeArtboard: 'Other' }, 'sm')).toBe(inputs);
        expect(getStateMachineInputMetadata({ ...instance, activeArtboard: '' }, 'sm')).toBeNull();
        expect(getStateMachineInputMetadata({ ...instance, activeArtboard: 'Absent' }, 'sm')).toBeNull();
        expect(getStateMachineInputMetadata({ get contents() { throw new Error('not loaded'); } }, 'sm')).toBeNull();
    });

    it('enumerates contents once across polling/artboard changes and invalidates when a file loads', () => {
        let inputs = [];
        const contents = vi.fn(() => ({ artboards: [
            { name: 'Main', stateMachines: [{ name: 'sm', inputs }] },
            { name: 'Other', stateMachines: [{ name: 'sm', inputs: [{ name: 'legacy' }] }] },
        ] }));
        const instance = { activeArtboard: 'Main', get contents() { return contents(); } };
        for (let tick = 0; tick < 20; tick += 1) expect(getStateMachineInputMetadata(instance, 'sm')).toEqual([]);
        instance.activeArtboard = 'Other';
        expect(getStateMachineInputMetadata(instance, 'sm')).toEqual([{ name: 'legacy' }]);
        expect(contents).toHaveBeenCalledTimes(1);
        inputs = [{ name: 'new-file-input' }];
        instance.activeArtboard = 'Main';
        clearStateMachineInputMetadata(instance);
        expect(getStateMachineInputMetadata(instance, 'sm')).toEqual(inputs);
        expect(contents).toHaveBeenCalledTimes(2);
    });
});
