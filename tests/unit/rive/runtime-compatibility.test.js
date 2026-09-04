import {
    setInspectionMetadata,
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

    it('uses only bound inspection metadata and never reads the live getter', () => {
        const contents = vi.fn(() => { throw new Error('live getter forbidden'); });
        const instance = { activeArtboard: 'Main', get contents() { return contents(); } };
        const metadata = { artboards: [
            { name: 'Main', stateMachines: [{ name: 'sm', inputs: [] }] },
            { name: 'Other', stateMachines: [{ name: 'sm', inputs: [{ name: 'legacy' }] }] },
        ] };
        expect(getStateMachineInputMetadata(instance, 'sm')).toBeNull();
        setInspectionMetadata(instance, metadata);
        for (let i = 0; i < 20; i++) expect(getStateMachineInputMetadata(instance, 'sm')).toEqual([]);
        instance.activeArtboard = 'Other';
        expect(getStateMachineInputMetadata(instance, 'sm')).toEqual([{ name: 'legacy' }]);
        instance.activeArtboard = 'Absent';
        expect(getStateMachineInputMetadata(instance, 'sm')).toBeNull();
        clearStateMachineInputMetadata(instance);
        instance.activeArtboard = 'Main';
        expect(getStateMachineInputMetadata(instance, 'sm')).toBeNull();
        expect(contents).not.toHaveBeenCalled();
    });
});
