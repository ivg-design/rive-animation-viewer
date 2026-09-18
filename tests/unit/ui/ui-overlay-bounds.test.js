import { createOverlayBoundsController } from '../../../src/app/ui/overlay/interaction/bounds.js';

it('animates height over 200ms while keeping the overlay top edge fixed', async () => {
    let now = 0;
    const invoke = vi.fn(async () => {});
    const bounds = createOverlayBoundsController({
        enqueueOperation: (operation) => operation(),
        getActiveEpoch: () => 7,
        getTauriInvoker: () => invoke,
        isDisposed: () => false,
        windowRef: {
            performance: { now: () => 0 },
            requestAnimationFrame: (callback) => callback(now += 50),
        },
    });
    bounds.setCurrent({ x: 10, y: 20, width: 680, height: 320 });
    await expect(bounds.resizeNow({ x: 10, y: 20, width: 680, height: 440 }, 200)).resolves.toBe(true);
    const frames = invoke.mock.calls.map(([, payload]) => payload.bounds);
    expect(frames).toHaveLength(4);
    expect(frames.map((frame) => frame.y)).toEqual([20, 20, 20, 20]);
    expect(frames.map((frame) => frame.x)).toEqual([10, 10, 10, 10]);
    expect(frames.map((frame) => frame.height)).toEqual([...frames.map((frame) => frame.height)].sort((a, b) => a - b));
    expect(frames.at(-1).height).toBe(440);
});

it('applies the final bounds directly when reduced motion is requested', async () => {
    const invoke = vi.fn(async () => {});
    const bounds = createOverlayBoundsController({
        enqueueOperation: (operation) => operation(),
        getActiveEpoch: () => 7,
        getTauriInvoker: () => invoke,
        isDisposed: () => false,
        windowRef: { matchMedia: () => ({ matches: true }) },
    });
    bounds.setCurrent({ x: 10, y: 20, width: 680, height: 320 });
    await expect(bounds.resizeNow({ x: 10, y: 20, width: 680, height: 440 }, 200)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('set_ui_overlay_bounds', {
        epoch: 7,
        bounds: { x: 10, y: 20, width: 680, height: 440 },
    });
});
