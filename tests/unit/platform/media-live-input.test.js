import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(`src-tauri/src/demo-template/js/${path}.js`, 'utf8');
const source = read('media/live-input'), pointer = read('media/recording'), interactions = read('media/interaction-schedule');
const bootstrap = read('core/bootstrap');
const setters = bootstrap.slice(bootstrap.indexOf('        function renderSurfaceCommandPayload'), bootstrap.indexOf('        function handleRenderSurfaceCommand'));
function harness({ duration, sourceSession = 'one' } = {}) {
    let now = 1000, player = { viewModelInstance: {}, isPlaying: true, play: vi.fn() }, session = sourceSession;
    const canvas = document.createElement('canvas'), seen = [], state = {};
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 });
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'mouseout']) canvas.addEventListener(type, (e) => seen.push({ type, x: e.clientX, frame: state.recording?.lastIndex, cursor: { ...state.cursor } }));
    const recording = { id: 'take', start: 1000, ready: true, lastIndex: -1, ownsClock: true,
        options: { fps: { numerator: 60, denominator: 1 }, duration_seconds: duration } };
    state.recording = recording;
    const accessors = new Map(), resolve = vi.fn((d) => accessors.get(d.path)), triggerReceipt = vi.fn();
    const emit = vi.fn(async () => {}), win = { __ravRenderSurfaceTarget: { type: 'stateMachine', name: 'SM' }, __ravRenderSurfaceEmit: emit };
    const api = new Function('window', 'els', 'getRenderSurfaceMediaState', 'performance', 'resolveControlAccessor', 'readEnumValues', 'recordRenderSurfaceTriggerReceipt', 'settleRenderSurfaceRecordingDrain',
        `var riveInstance = arguments[8], renderSurfaceSessionId = arguments[9], isRenderSurfaceMode = false;
        ${interactions}\n${setters}\n${source}\n${pointer}
        return { create: createRenderSurfaceLiveInput, send: dispatchRenderSurfacePointer,
            vm: queueRenderSurfaceLiveVmInput, progress: publishRenderSurfaceRecordingProgress,
            player(value) { riveInstance = value; }, session(value) { renderSurfaceSessionId = value; } };`
    )(win, { canvas }, () => state, { now: () => now, timeOrigin: 1700000000000 }, resolve, (a) => a.values || [], triggerReceipt, vi.fn(), player, session);
    recording.liveInput = api.create(recording);
    const frame = (index) => { recording.liveInput.run(index); recording.lastIndex = index; };
    const physical = (type, ms, x = 60, deliveredAt = Math.max(now, ms)) => { now = deliveredAt; const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 70 }); Object.defineProperty(e, 'timeStamp', { value: ms }); canvas.dispatchEvent(e); return { timestamp: ms, deliveredAt: now }; };
    return { ...api, originalPlayer: player, state, recording, canvas, seen, accessors, resolve, triggerReceipt, emit, win, frame, physical, time(ms) { now = ms; } };
}

describe('timestamped live recording input', () => {
    it('holds physical and MCP mouse input until mapped frame starts, preserving clicks, exit and cursor timing', () => {
        const h = harness(); h.frame(0);
        h.physical('mousemove', 3000); h.physical('mousedown', 3000); h.physical('mouseup', 3000);
        h.time(4000); expect(h.send({ type: 'exit', x: 1, y: 1 })).toMatchObject({ queued: true, frame_index: 180 });
        expect(h.seen).toEqual([]); expect(h.state.cursor).toBeUndefined();
        h.frame(119); expect(h.seen).toEqual([]);
        h.frame(120); expect(h.seen.map(e => e.type)).toEqual(['mousemove', 'mousedown', 'mouseup']);
        expect(h.state.cursor).toEqual({ x: .25, y: .5, inside: true });
        h.frame(179); expect(h.seen).toHaveLength(3);
        h.frame(180); expect(h.seen.at(-1).type).toBe('mouseout'); expect(h.state.cursor.inside).toBe(false);
        expect(h.recording.liveInput.status()).toMatchObject({ accepted: 4, applied: 4, pending: 0 });
        expect(h.recording.liveInput.status().receipts.map(r => r.frame_index)).toEqual([120, 120, 120, 180]);
        expect(h.seen[0].cursor.x).toBe(.25);
    });
    it('normalizes IPC epoch time and rational rates, and applies each event within one frame of its original time', () => {
        const h = harness(); h.recording.options.fps = { numerator: 30000, denominator: 1001 };
        // The queue was constructed with 60 FPS; a new take owns the new rate.
        h.recording.liveInput.dispose(); h.recording.liveInput = h.create(h.recording);
        h.time(3500); const r = h.send({ type: 'move', x: .5, y: .5 }, false, 1700000000000 + 3001);
        expect(r.frame_index).toBe(60); expect(r.at_seconds).toBe(2.001);
        h.frame(60); const applied = h.recording.liveInput.status().receipts[0];
        expect(applied.applied_seconds - applied.at_seconds).toBeGreaterThanOrEqual(0);
        expect(applied.applied_seconds - applied.at_seconds).toBeLessThan(1001 / 30000);
    });
    it('uses explicit replay bypass for prepared schedules without re-enqueuing or suppressing Rive listeners', () => {
        const h = harness(); h.time(3000);
        h.send({ type: 'move', x: .7, y: .5 }, true);
        expect(h.seen).toHaveLength(1); expect(h.recording.liveInput.status().accepted).toBe(0);
        h.send({ type: 'down', x: .2, y: .3 }); h.frame(120);
        expect(h.seen.map(e => e.type)).toEqual(['mousemove', 'mousedown']);
        expect(h.recording.liveInput.status().accepted).toBe(1);
    });
    it('validates and defers scalar/global/trigger inputs, resolves current paths at application, and never drops two fires', () => {
        const h = harness(); const old = { value: 0 }, replacement = { value: 10 }, fire = { trigger: vi.fn() };
        h.accessors.set('nested/speed', old); h.accessors.set('bang', fire); h.time(2000);
        expect(h.vm('vm-set', { descriptor: { source: 'global-view-model', globalViewModelName: 'Global', path: 'nested/speed', kind: 'number' }, value: 42 })).toMatchObject({ queued: true, frame_index: 60 });
        h.vm('vm-fire', { path: 'bang', source: 'view-model', kind: 'trigger' }); h.vm('vm-fire', { path: 'bang', source: 'view-model', kind: 'trigger' });
        expect(old.value).toBe(0); expect(fire.trigger).not.toHaveBeenCalled();
        h.accessors.set('nested/speed', replacement); h.frame(60);
        expect(replacement.value).toBe(42); expect(old.value).toBe(0); expect(fire.trigger).toHaveBeenCalledTimes(2);
        expect(h.triggerReceipt).toHaveBeenCalledTimes(2);
        expect(h.resolve.mock.calls[0][0]).toMatchObject({ source: 'global-view-model', globalViewModelName: 'Global' });
        expect(() => h.vm('vm-set', { path: 'nested/speed', kind: 'number', value: NaN })).toThrow('Finite number');
        expect(() => h.vm('vm-set', { path: 'image', kind: 'image', value: null })).toThrow('prepared interaction schedule');
    });
    it('seals Stop input, drains accepted events on the last partial frame and restores immediate input on cleanup', () => {
        const h = harness(); h.time(1010); h.send({ type: 'down', x: .5, y: .5 }); h.send({ type: 'up', x: .5, y: .5 });
        expect(h.recording.liveInput.seal(1)).toBe(2); expect(() => h.send({ type: 'move', x: .5, y: .5 })).toThrow('closed');
        h.frame(1); expect(h.seen.map(e => e.type)).toEqual(['mousedown', 'mouseup']);
        const receipts = h.recording.liveInput.status().receipts;
        expect(Math.abs(receipts[0].applied_seconds - receipts[0].at_seconds)).toBeLessThan(1 / 60);
        h.recording.liveInput.dispose(); h.state.recording = null;
        h.physical('mousemove', 1020); h.send({ type: 'exit', x: .5, y: .5 });
        expect(h.seen.map(e => e.type)).toEqual(['mousedown', 'mouseup', 'mousemove', 'mouseout']);
    });
    it.each(['player', 'session', 'vm', 'target', 'recording'])('rejects stale %s before any queued effect', (change) => {
        const h = harness(); h.time(3000); h.send({ type: 'down', x: .5, y: .5 });
        if (change === 'player') h.player({ viewModelInstance: {} });
        if (change === 'session') h.session('two');
        if (change === 'vm') h.originalPlayer.viewModelInstance = {};
        if (change === 'target') h.win.__ravRenderSurfaceTarget.name = 'Other';
        if (change === 'recording') h.state.recording = {};
        expect(() => h.frame(120)).toThrow('source changed'); expect(h.seen).toEqual([]);
        h.recording.liveInput.dispose(); expect(h.recording.liveInput.status().pending).toBe(0);
    });
    it('fails rather than silently dropping a bounded backlog, and does not apply a missing control', () => {
        const h = harness(); h.time(3000);
        for (let i = 0; i < 16384; i++) h.send({ type: 'move', x: .5, y: .5 });
        expect(() => h.send({ type: 'up', x: .5, y: .5 })).toThrow('backlog'); expect(h.recording.stopped).toBe(true);
        expect(h.recording.liveInput.status()).toMatchObject({ accepted: 16384, applied: 0 });
        const missing = harness(); missing.time(2000); missing.vm('vm-set', { path: 'gone', kind: 'number', value: 1 });
        expect(() => missing.frame(60)).toThrow('unavailable'); expect(missing.recording.liveInput.status().error).toContain('gone');
    });
    it('suppresses physical input during duration drain, without turning a completed take into a failure', () => {
        const h = harness({ duration: 2 }); h.time(2999); h.send({ type: 'up', x: .5, y: .5 });
        h.physical('mousemove', 3000); expect(h.recording.error).toBeUndefined();
        h.frame(120); expect(h.recording.liveInput.status()).toMatchObject({ accepted: 1, applied: 1 });
        expect(h.seen).toHaveLength(1);
    });
    it('publishes sustained lag through existing progress, clears it after catch-up, and creates no recurring scheduler', () => {
        const h = harness(); h.frame(0); h.time(2000); h.progress(h.recording);
        expect(h.emit.mock.calls.at(-1)[1].capture_clock.sustained_lag).toBe(false);
        h.time(3000); h.progress(h.recording);
        expect(h.emit.mock.calls.at(-1)[1].capture_clock).toMatchObject({ sustained_lag: true, input_timing: 'timestamped' });
        const count = h.emit.mock.calls.length; h.time(3100); h.progress(h.recording); expect(h.emit).toHaveBeenCalledTimes(count);
        h.recording.lastIndex = 120; h.progress(h.recording); expect(h.emit.mock.calls.at(-1)[1].capture_clock.sustained_lag).toBe(false);
        expect(source).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    });
});

it('reorders delayed DOM delivery by recording frame while preserving same-frame click order', () => {
    const h = harness(); h.time(4000);
    h.send({ type: 'exit', x: 1, y: 1 });
    h.physical('mousedown', 3000); h.physical('mouseup', 3000);
    h.frame(120); expect(h.seen.map(e => e.type)).toEqual(['mousedown', 'mouseup']);
    h.frame(180); expect(h.seen.map(e => e.type)).toEqual(['mousedown', 'mouseup', 'mouseout']);
});

it('retains an unusually late click on the next frame and reports its lateness without aborting', () => {
    const h = harness(); h.frame(180); h.time(5000);
    expect(h.send({ type: 'down', x: .5, y: .5 }, false, 2000)).toMatchObject({ queued: true, frame_index: 181, late: true });
    expect(h.recording.stopped).not.toBe(true); h.frame(181);
    expect(h.recording.liveInput.status()).toMatchObject({ accepted: 1, applied: 1, late_inputs: 1, max_late_ms: 2016.6666666666665 });
    expect(h.seen.map(e => e.type)).toEqual(['mousedown']);
});

it.each(['physical', 'vm'])('keeps normal %s delivery delay inside the input-latency window', (kind) => {
    const h = harness(); h.frame(1); // At wall 118 ms, the 100 ms window permits only frame one.
    if (kind === 'physical') { expect(h.physical('mousedown', 1116, 60, 1118)).toEqual({ timestamp: 1116, deliveredAt: 1118 }); }
    else { h.accessors.set('speed', { value: 0 }); h.time(1140); h.vm('vm-set', { path: 'speed', kind: 'number', value: 42 }, 1120); }
    const expected = kind === 'physical' ? 7 : 8;
    h.frame(expected - 1); expect(h.recording.liveInput.status().applied).toBe(0);
    h.frame(expected); expect(h.recording.liveInput.status()).toMatchObject({ accepted: 1, applied: 1, late_inputs: 0 });
    expect(h.recording.stopped).not.toBe(true);
});

it('retains a finite-tail DOM event by its original timestamp despite delayed delivery, like MCP', () => {
    const h = harness({ duration: .1 }); expect(h.physical('mousedown', 1099, 60, 1101)).toEqual({ timestamp: 1099, deliveredAt: 1101 });
    expect(h.recording.liveInput.status()).toMatchObject({ accepted: 1, pending: 1 });
    expect(h.send({ type: 'up', x: .5, y: .5 }, false, 1099)).toMatchObject({ queued: true, frame_index: 6 });
    h.physical('mousemove', 1101); expect(h.recording.liveInput.status().accepted).toBe(2);
    expect(h.recording.error).toBeUndefined(); h.frame(6);
    expect(h.seen.map(e => e.type)).toEqual(['mousedown', 'mouseup']);
    expect(h.recording.liveInput.status().receipts.map(r => r.frame_index)).toEqual([6, 6]);
});

it('samples adjacent move positions on each frame with matching cursor, without inventing accepted events', () => {
    const h = harness(); h.time(3000); h.send({ type: 'move', x: 0, y: .5 });
    h.time(5000); h.send({ type: 'move', x: 1, y: .5 });
    h.frame(120); h.frame(180);
    expect(h.state.cursor).toMatchObject({ x: .5, y: .5, inside: true });
    expect(h.seen.at(-1).cursor.x).toBe(.5);
    expect(h.recording.liveInput.status()).toMatchObject({ accepted: 2, applied: 1, pending: 1, interpolated_moves: 1 });
    h.frame(240); expect(h.state.cursor.x).toBe(1);
    expect(h.recording.liveInput.status()).toMatchObject({ accepted: 2, applied: 2, pending: 0 });
});

it.each(['down', 'up', 'exit'])('never interpolates over the %s barrier or invents clicks', type => {
    const h = harness(); h.time(3000); h.send({ type: 'move', x: 0, y: .5 });
    h.time(3500); h.send({ type, x: .2, y: .5 });
    h.time(5000); h.send({ type: 'move', x: 1, y: .5 });
    h.frame(120); h.frame(130); expect(h.seen).toHaveLength(1); expect(h.state.cursor.x).toBe(0);
    h.frame(150); h.frame(180); expect(h.seen).toHaveLength(2);
    expect(h.recording.liveInput.status()).toMatchObject({ accepted: 3, applied: 2, interpolated_moves: 0 });
});

it('preserves same-frame moves and never extrapolates beyond the final real sample', () => {
    const h = harness(); h.time(3005); h.send({ type: 'move', x: .2, y: .5 });
    h.time(3010); h.send({ type: 'move', x: .4, y: .5 }); h.frame(121);
    expect(h.seen).toHaveLength(2); expect(h.state.cursor.x).toBe(.4);
    h.frame(180); expect(h.seen).toHaveLength(2);
    expect(h.recording.liveInput.status()).toMatchObject({ accepted: 2, applied: 2, interpolated_moves: 0 });
});

it.each(['buttons', 'identical', 'vm', 'trigger'])('never synthesizes motion over a %s boundary', boundary => {
    const h = harness(); h.time(3000); h.send({ type: 'move', x: .2, y: .5 });
    if (boundary === 'vm' || boundary === 'trigger') {
        h.accessors.set('speed', boundary === 'vm' ? { value: 0 } : { trigger: vi.fn() }); h.time(3500);
        h.vm(boundary === 'vm' ? 'vm-set' : 'vm-fire', { path: 'speed', kind: boundary === 'vm' ? 'number' : 'trigger', value: 1 });
    }
    h.time(5000); h.send({ type: 'move', x: boundary === 'identical' ? .2 : .8, y: .5,
        ...(boundary === 'buttons' ? { buttons: 1 } : {}) });
    h.frame(120); h.frame(140);
    expect(h.seen).toHaveLength(1); expect(h.recording.liveInput.status().interpolated_moves).toBe(0);
    if (boundary === 'vm' || boundary === 'trigger') { h.frame(150); h.frame(180); expect(h.seen).toHaveLength(1); }
});

it('interpolates accepted Stop tail samples, then clears pending samples on disposal', () => {
    const h = harness(); h.time(3000); h.send({ type: 'move', x: 0, y: .5 });
    h.time(5000); h.send({ type: 'move', x: 1, y: .5 }); expect(h.recording.liveInput.seal(241)).toBe(241);
    h.frame(120); h.frame(180); expect(h.state.cursor.x).toBe(.5);
    h.recording.liveInput.dispose(); h.frame(200); expect(h.seen).toHaveLength(2);
});

it('rejects a different pointer identity before it enters interpolation or real input receipts', () => {
    const h = harness(); h.time(3000); h.send({ type: 'move', x: .2, y: .5 }); h.time(5000);
    expect(() => h.send({ type: 'move', x: .8, y: .5, id: 1 })).toThrow('pointer id 0');
    h.frame(120); h.frame(180); expect(h.seen).toHaveLength(1);
    expect(h.recording.liveInput.status()).toMatchObject({ accepted: 1, applied: 1, interpolated_moves: 0 });
});
