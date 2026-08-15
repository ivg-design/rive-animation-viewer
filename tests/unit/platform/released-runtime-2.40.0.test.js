import fixtureManifest from '../../fixtures/rive-suite-runtime-v2.40.0.json';
import { getRuntimeSourceUrl } from '../../../src/app/platform/runtime/runtime-utils.js';

describe('released Web runtime 2.40.0 coverage contract', () => {
    it.each(['webgl2', 'canvas'])('selects the exact %s package at 2.40.0', (runtimeName) => {
        expect(getRuntimeSourceUrl(runtimeName, '2.40.0', '2.40.0')).toBe(
            `https://cdn.jsdelivr.net/npm/@rive-app/${runtimeName}@2.40.0`,
        );
    });

    it('pins the released fixture bytes for both renderers', () => {
        expect(fixtureManifest.releasedWebVersion).toBe('2.40.0');
        expect(fixtureManifest.releasedRuntimeTag).toBe('runtime-v0.1.271');
        expect(fixtureManifest.fixtures).toEqual([
            expect.objectContaining({
                findingId: 'RIVE-271-0002',
                sha256: 'eb10db89909e33d0327166be15b8f3794791e0ff29e89afe3c9c41b3ad4dbb47',
                renderers: ['webgl2', 'canvas'],
                runtimeVersion: '2.40.0',
                liveValidationRequired: true,
            }),
        ]);
    });
});
