import {
    buildArtboardSelectionSummary,
    buildPlaybackContext,
    buildPlaybackStatusLabel,
    getActiveViewModelLabel,
    getViewModelDefinitionLabel,
} from '../../../src/app/rive/playback-status.js';

describe('rive/playback-status', () => {
    it('formats artboard, playback, vm, and instance labels without dropping filename-like values', () => {
        const riveInstance = {
            artboard: { name: 'Diagram' },
            defaultViewModel: () => ({ name: 'diagram_vm' }),
            viewModelInstance: { name: 'ms_teams' },
        };

        const context = buildPlaybackContext({
            playbackState: {
                currentArtboard: 'Diagram',
                currentPlaybackName: 'State Machine 1',
                currentPlaybackType: 'stateMachine',
                currentVmInstanceName: 'ms_teams',
            },
            riveInstance,
        });

        expect(getViewModelDefinitionLabel(riveInstance)).toBe('diagram_vm');
        expect(getActiveViewModelLabel(riveInstance)).toBe('diagram_vm');
        expect(buildPlaybackStatusLabel(context)).toBe(
            'Loaded: [AB] Diagram · [SM] State Machine 1 · [VM] diagram_vm · [INST] ms_teams',
        );
        expect(buildArtboardSelectionSummary(context)).toBe('Diagram / State Machine 1 / ms_teams');
    });

    it('omits unavailable playback and instance fields cleanly', () => {
        const context = buildPlaybackContext({
            playbackState: {
                currentArtboard: 'Idle Artboard',
                currentPlaybackName: 'idle',
                currentPlaybackType: 'animation',
            },
            riveInstance: {
                artboard: { name: 'Idle Artboard' },
            },
        });

        expect(buildPlaybackStatusLabel(context, 'Playing')).toBe('Playing: [AB] Idle Artboard · [ANIM] idle');
        expect(buildArtboardSelectionSummary(context)).toBe('Idle Artboard / idle');
    });
});
