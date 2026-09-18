import { readFileSync } from 'node:fs';
const read = (name) => readFileSync(`src-tauri/src/demo-template/js/media/stream/${name}.js`, 'utf8');
const elementary = new Function(`${read('elementary')};return { config:mediaAnnexBConfig, packet:mediaAnnexBPacket, pack:mediaStreamPacket };`)();

describe('native video packet boundary', () => {
    it('converts HEVC configuration and length-prefixed slices into decodable Annex B', () => {
        const config = new Uint8Array(31); config[0] = 1; config[21] = 3; config[22] = 1;
        config.set([32, 0, 1, 0, 3, 64, 1, 12], 23);
        const parsed = elementary.config(config.buffer, 'hevc');
        const key = elementary.packet(new Uint8Array([0,0,0,2,38,1]), parsed, true);
        expect([...key]).toEqual([0,0,0,1,64,1,12,0,0,0,1,38,1]);
        expect([...elementary.packet(new Uint8Array([0,0,0,2,38,1]), parsed, false)]).toEqual([0,0,0,1,38,1]);
        expect(() => elementary.packet(new Uint8Array([0,0,0,12,38,1]), parsed, true)).toThrow('Truncated');
        expect(() => elementary.config(new Uint8Array([1]), 'hevc')).toThrow('Invalid');
    });
    it('accepts verified Annex B and frames packet lengths without retaining prior jobs', () => {
        const bytes = new Uint8Array([0,0,1,4]);
        expect(elementary.packet(bytes, null, true)).toBe(bytes);
        expect(() => elementary.packet(new Uint8Array([4,5,6]), null, true)).toThrow('Annex B');
        const body = elementary.pack([bytes, new Uint8Array([9,8])]);
        expect([...body]).toEqual([2,0,0,0,4,0,0,0,0,0,1,4,2,0,0,0,9,8]);
    });
    it('serializes disk uploads and propagates low disk errors without continuing to write', async () => {
        let done;
        const fetch = vi.fn(() => new Promise((resolve) => { done = resolve; }));
        const create = new Function('fetch', `${read('transport')};return createMediaBinaryTransport;`)(fetch);
        const pipe = create('job'), a = pipe.send(0, new Uint8Array([1])), b = pipe.send(1, new Uint8Array([2]));
        const checkedA = expect(a).rejects.toThrow('disk reserve'), checkedB = expect(b).rejects.toThrow('disk reserve');
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledOnce();
        done({ok:false,text:async()=> 'Low disk reserve'});
        await checkedA; await checkedB;
        await expect(pipe.drain()).rejects.toThrow('disk reserve');
        expect(fetch).toHaveBeenCalledOnce();
    });
});

describe('hardware-preferred capture', () => {
    it('uses runtime capability checks, requires the capture worker, and does not discard alpha to enable acceleration', async () => {
        class Encoder { static isConfigSupported = vi.fn(async (config) => ({supported:true,config})); }
        const build = (supported) => new Function('VideoEncoder','VideoFrame','mediaCapturePipelineSupported',`${read('video')}; return configureMediaRecording;`)(Encoder, function(){}, () => supported);
        const configure = build(true);
        const options = {format:'h265',width:1920,height:1080,fps:{numerator:60,denominator:1},quality:80};
        expect(await configure(options)).toMatchObject({capture_codec:'hevc',encoder_config:{hardwareAcceleration:'prefer-hardware',framerate:60}});
        expect(await configure({...options,format:'webm',alpha:true})).toMatchObject({capture_codec:null});
        expect(Encoder.isConfigSupported).toHaveBeenCalledOnce();
        Encoder.isConfigSupported.mockResolvedValue({supported:false});
        expect(await configure(options)).toMatchObject({capture_transport:'png-binary'});
        Encoder.isConfigSupported.mockResolvedValue({supported:true});
        expect(await build(false)(options)).toMatchObject({capture_codec:null,capture_transport:'png-binary'});
    });
});

it('counts acknowledged native packets only after successful writes', async () => {
    let finish;const fetch=vi.fn(()=>new Promise(r=>{finish=r;}));
    const progress=vi.fn();
    const pipe=new Function('fetch',`${read('transport')};return createMediaBinaryTransport;`)(fetch)('progress',progress);
    const pending=pipe.send(0,new Uint8Array([1]));await vi.advanceTimersByTimeAsync(0);
    expect(pipe.progress()).toBe(0);expect(progress).not.toHaveBeenCalled();
    finish({ok:true,json:async()=>({received_frames:1})});await pending;
    expect(pipe.progress()).toBe(1);expect(progress).toHaveBeenCalledOnce();
});
