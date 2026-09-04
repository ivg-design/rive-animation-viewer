import { setInspectionMetadata } from '../../../src/app/rive/runtime-compatibility.js';
import { createStatusPlaybackCommands } from '../../../src/app/platform/mcp/commands/status-playback.js';

describe('MCP legacy input discovery', () => {
    function setup(inputs) {
        const stateMachineInputs = vi.fn(() => inputs || []);
        const instance = { activeArtboard: 'Main', stateMachineNames: ['sm'], stateMachineInputs };
        if (inputs) setInspectionMetadata(instance, { artboards: [{ name: 'Main', stateMachines: [{ name: 'sm', inputs }] }] });
        return {
            stateMachineInputs,
            commands: createStatusPlaybackCommands({ documentRef: document, windowRef: { riveInst: instance } }),
        };
    }

    it('never invokes deprecated inputs for a metadata-confirmed empty state machine', async () => {
        const { commands, stateMachineInputs } = setup([]);
        expect(await commands.rav_get_sm_inputs()).toEqual({ inputs: [] });
        await expect(commands.rav_set_sm_input({ name: 'missing', value: 1 })).rejects.toThrow('not found');
        expect(stateMachineInputs).not.toHaveBeenCalled();
    });

    it('retains live legacy-input values and writes when authored inputs exist', async () => {
        const input = { name: 'progress', value: 0.5, type: 56 };
        const { commands, stateMachineInputs } = setup([input]);
        expect(await commands.rav_get_sm_inputs()).toEqual({ inputs: [
            { stateMachine: 'sm', name: 'progress', value: 0.5, type: 56 },
        ] });
        await commands.rav_set_sm_input({ name: 'progress', value: 1 });
        expect(input.value).toBe(1);
        expect(stateMachineInputs).toHaveBeenCalledTimes(2);
    });

    it('does not mistake unavailable metadata for an empty state machine', async () => {
        const { commands, stateMachineInputs } = setup(null);
        await commands.rav_get_sm_inputs();
        expect(stateMachineInputs).toHaveBeenCalledWith('sm');
    });
});
