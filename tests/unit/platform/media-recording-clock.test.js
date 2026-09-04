import { readFileSync } from 'node:fs';
const source = readFileSync('src-tauri/src/demo-template/js/media/recording-clock.js', 'utf8');
function harness() {
    let now = 0, accepting = true;
    const frames = [], advances = [], scheduled = [], timers = [];
    const recording = { ownsClock: true, ready: true, start: 0, lastIndex: -1,
        options: { fps: { numerator: 60, denominator: 1 } },
        video: { canAccept: () => accepting }, schedule: { run: (time, index) => scheduled.push([time,index]) } };
    const state = { recording }, emit = vi.fn();
    const pump = new Function('getRenderSurfaceMediaState','performance','riveInstance',
        'renderSurfaceAdvanceFrame','recordRenderSurfaceMediaFrame','setTimeout','window',
        `${source}; return pumpRenderSurfaceRecording;`)(()=>state,{now:()=>now},{isPlaying:true},
        (_player,dt)=>advances.push(dt),(index)=>{frames.push(index);recording.lastIndex=index;},
        (callback)=>{timers.push(callback);return timers.length;},{__ravRenderSurfaceEmit:emit});
    return { recording, frames, advances, scheduled, emit, pump, time: value=>{now=value;},
        accept: value=>{accepting=value;}, drain: ()=>{while(timers.length)timers.shift()();} };
}
describe('recording owns the simulation clock', () => {
    it('renders all 60 frames across irregular or visibility-throttled wake-ups with exact scheduled times', () => {
        const h=harness();h.recording.options.duration_seconds=1;h.pump();
        for(const time of [33,72,141,158,301,530,792,1001]) {h.time(time);h.pump();h.drain();}
        expect(h.frames).toEqual(Array.from({length:60},(_,i)=>i));
        expect(h.advances[0]).toBe(0);
        expect(h.advances.slice(1).every(dt=>dt===1/60)).toBe(true);
        expect(h.scheduled).toEqual(h.frames.map(i=>[i/60,i]));
        expect(h.emit).toHaveBeenCalledOnce();
    });
    it('waits for encoder capacity without advancing simulation or skipping a frame', () => {
        const h=harness();h.pump();h.time(50);h.accept(false);h.pump();
        expect(h.frames).toEqual([0]);expect(h.scheduled).toEqual([[0,0]]);
        h.accept(true);h.drain();expect(h.frames).toEqual([0,1,2,3]);
    });
    it('seals manual stop once and captures the final interval without holding prior pixels', () => {
        const h=harness();h.pump();h.time(108);h.recording.stopAt=.108;h.pump();h.drain();
        expect(h.frames).toEqual([0,1,2,3,4,5,6]);expect(h.recording.stopped).toBe(true);
        expect(h.emit).not.toHaveBeenCalled();h.time(300);h.pump();expect(h.frames).toHaveLength(7);
    });
    it('does not claim an old presentation clock or an absent capture', () => {
        const h=harness();h.recording.ownsClock=false;expect(h.pump()).toBe(false);expect(h.frames).toEqual([]);
    });
});
