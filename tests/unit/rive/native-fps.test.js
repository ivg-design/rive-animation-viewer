import {
    disableNativeFpsCounter,
    enableNativeFpsCounter,
} from '../../../src/app/rive/instances/native-fps.js';

describe('rive/native-fps', () => {
    it('uses the native callback mode and ignores stale or invalid reports', () => {
        let nativeCallback = null;
        let current = true;
        const onFps = vi.fn();
        const instance = {
            enableFPSCounter: vi.fn((callback) => { nativeCallback = callback; }),
        };

        expect(enableNativeFpsCounter(instance, onFps, () => current)).toBe(true);
        expect(instance.enableFPSCounter).toHaveBeenCalledWith(expect.any(Function));

        nativeCallback(59.6);
        nativeCallback(Number.NaN);
        current = false;
        nativeCallback(30);

        expect(onFps).toHaveBeenCalledOnce();
        expect(onFps).toHaveBeenCalledWith(59.6);
    });

    it('does not call the advertised WebGL2 disable wrapper when its delegate is absent', () => {
        const instance = {
            disableFPSCounter: vi.fn(() => { throw new Error('missing runtime delegate'); }),
            runtime: {},
        };

        expect(disableNativeFpsCounter(instance)).toBe(false);
        expect(instance.disableFPSCounter).not.toHaveBeenCalled();
    });

    it('disables a runtime that provides the native delegate', () => {
        const instance = {
            disableFPSCounter: vi.fn(),
            runtime: { disableFPSCounter: vi.fn() },
        };

        expect(disableNativeFpsCounter(instance)).toBe(true);
        expect(instance.disableFPSCounter).toHaveBeenCalledOnce();
    });
});
