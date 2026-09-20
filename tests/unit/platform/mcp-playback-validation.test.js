import { assertKnownPlaybackTarget } from '../../../src/app/platform/mcp/commands/playback-validation.js';

const metadata = {
    artboards: [
        { name: 'Main_Artboard', animations: ['Idle'], stateMachines: ['State Machine 1'] },
        { name: 'Thunderbolt 4', animations: [{ name: 'Thundering' }, { name: 'Thunder_Bolt' }], stateMachines: [] },
    ],
};

describe('playback target validation without a host Rive instance', () => {
    const authoritative = { canonicalState: { artboard: 'Main_Artboard', artboards: ['Main_Artboard', 'Thunderbolt 4'] } };

    it('validates a named animation on a non-current artboard from parse-once metadata', () => {
        const windowRef = { _mcpGetInspectionMetadata: () => metadata };
        expect(() => assertKnownPlaybackTarget({
            artboardName: 'Thunderbolt 4', authoritative, requestedPlayback: { type: 'animation', name: 'Thunder_Bolt' }, windowRef,
        })).not.toThrow();
        expect(() => assertKnownPlaybackTarget({
            artboardName: 'Thunderbolt 4', authoritative, requestedPlayback: { type: 'animation', name: 'thunder_bolt' }, windowRef,
        })).toThrow(/not found/);
        expect(() => assertKnownPlaybackTarget({
            artboardName: 'Nope', authoritative, requestedPlayback: null, windowRef,
        })).toThrow(/not found/);
    });

    it('keeps the canonical fallback when no metadata source exists', () => {
        expect(() => assertKnownPlaybackTarget({
            artboardName: 'Thunderbolt 4', authoritative, requestedPlayback: { type: 'animation', name: 'Thunder_Bolt' }, windowRef: {},
        })).toThrow(/metadata for artboard/);
    });
});
