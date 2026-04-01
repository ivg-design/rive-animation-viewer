import {
    detectDefaultStateMachineFromProbeInstance,
    detectDefaultStateMachineFromRiveFile,
    detectDefaultStateMachineName,
    normalizeStateMachineSelection,
} from '../../../src/app/rive/default-state-machine.js';

describe('rive/default-state-machine', () => {
    it('normalizes configured state machine selections', () => {
        expect(normalizeStateMachineSelection(['Main', '', null, 'Hover'])).toEqual(['Main', 'Hover']);
        expect(normalizeStateMachineSelection(' Idle ')).toEqual([' Idle ']);
        expect(normalizeStateMachineSelection(null)).toEqual([]);
    });

    it('reads the default state machine from the RiveFile API when available', async () => {
        const cleanup = vi.fn();
        const init = vi.fn();
        const runtime = {
            RiveFile: vi.fn(() => ({
                artboardByName: vi.fn(() => ({
                    stateMachineByIndex: vi.fn(() => ({ name: 'MainSM' })),
                    stateMachineCount: vi.fn(() => 1),
                })),
                cleanup,
                init,
            })),
        };

        const name = await detectDefaultStateMachineFromRiveFile(runtime, {
            artboardName: 'HUD',
            fileUrl: 'file:///demo.riv',
        });

        expect(name).toBe('MainSM');
        expect(init).toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalled();
    });

    it('falls back across artboard lookup strategies and supports file buffers', async () => {
        const cleanup = vi.fn();
        const defaultArtboard = vi.fn(() => null);
        const artboardByIndex = vi.fn(() => ({
            stateMachineNames: ['FallbackSM'],
        }));
        const runtime = {
            RiveFile: vi.fn((config) => {
                expect(config.buffer).toBeInstanceOf(ArrayBuffer);
                return {
                    artboardByIndex,
                    cleanup,
                    defaultArtboard,
                    init: vi.fn(),
                };
            }),
        };

        const name = await detectDefaultStateMachineFromRiveFile(runtime, {
            fileBuffer: Uint8Array.from([1, 2, 3]).buffer,
        });

        expect(name).toBe('FallbackSM');
        expect(defaultArtboard).toHaveBeenCalled();
        expect(artboardByIndex).toHaveBeenCalledWith(0);
        expect(cleanup).toHaveBeenCalled();
    });

    it('falls back to a probe instance when the file API cannot resolve a state machine', async () => {
        let onLoad = null;
        const cleanup = vi.fn();
        const runtime = {
            Rive: vi.fn((config) => {
                onLoad = config.onLoad;
                return {
                    cleanup,
                    stateMachineNames: ['HoverSM'],
                };
            }),
        };

        const detection = detectDefaultStateMachineFromProbeInstance(runtime, {
            documentRef: document,
            fileUrl: 'file:///demo.riv',
        });
        onLoad?.();

        await expect(detection).resolves.toBe('HoverSM');
        expect(runtime.Rive).toHaveBeenCalledWith(expect.objectContaining({
            autoplay: false,
            autoBind: false,
            src: 'file:///demo.riv',
        }));
        expect(cleanup).toHaveBeenCalled();
    });

    it('returns null for missing runtime APIs and probe failures', async () => {
        expect(await detectDefaultStateMachineFromRiveFile(null, {})).toBeNull();
        expect(await detectDefaultStateMachineFromProbeInstance(null, {})).toBeNull();

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let onLoadError = null;
        const runtime = {
            Rive: vi.fn((config) => {
                onLoadError = config.onLoadError;
                return {
                    cleanup: vi.fn(),
                    stateMachineNames: [],
                };
            }),
            RiveFile: vi.fn(() => {
                throw new Error('bad rive file');
            }),
        };

        const probeResult = detectDefaultStateMachineFromProbeInstance(runtime, {
            artboardName: 'HUD',
            documentRef: document,
            fileUrl: 'file:///demo.riv',
        });
        onLoadError?.(new Error('probe failed'));

        await expect(probeResult).resolves.toBeNull();
        await expect(detectDefaultStateMachineFromRiveFile(runtime, {
            artboardName: 'HUD',
            fileUrl: 'file:///demo.riv',
        })).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('returns null when probe construction throws', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const runtime = {
            Rive: vi.fn(() => {
                throw new Error('construction failed');
            }),
        };

        await expect(detectDefaultStateMachineFromProbeInstance(runtime, {
            fileBuffer: Uint8Array.from([1]).buffer,
        })).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('uses the file API result without probing when a default state machine is found', async () => {
        const runtime = {
            Rive: vi.fn(),
            RiveFile: vi.fn(() => ({
                cleanup: vi.fn(),
                defaultArtboard: vi.fn(() => ({
                    stateMachineByIndex: vi.fn(() => ({ name: 'FileFirstSM' })),
                    stateMachineCount: vi.fn(() => 1),
                })),
                init: vi.fn(),
            })),
        };

        await expect(detectDefaultStateMachineName(runtime, {
            documentRef: document,
            fileUrl: 'file:///demo.riv',
        })).resolves.toBe('FileFirstSM');
        expect(runtime.RiveFile).toHaveBeenCalled();
        expect(runtime.Rive).not.toHaveBeenCalled();
    });
});
