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
    it('uses runtime capability checks and does not discard alpha to enable acceleration', async () => {
        class Encoder { static isConfigSupported = vi.fn(async (config) => ({supported:true,config})); }
        const configure = new Function('VideoEncoder','VideoFrame',`${read('video')}; return configureMediaRecording;`)(Encoder, function(){});
        const options = {format:'h265',width:1920,height:1080,fps:{numerator:60,denominator:1},quality:80};
        expect(await configure(options)).toMatchObject({capture_codec:'hevc',encoder_config:{hardwareAcceleration:'prefer-hardware',framerate:60}});
        expect(await configure({...options,format:'webm',alpha:true})).toMatchObject({capture_codec:null});
        expect(Encoder.isConfigSupported).toHaveBeenCalledOnce();
        Encoder.isConfigSupported.mockResolvedValue({supported:false});
        expect(await configure(options)).toMatchObject({capture_transport:'png-binary'});
    });
    it('flushes every output packet before finish and closes retained frame resources', async () => {
        const frames = [], encoded = [], writes = [];
        class Frame {
            constructor(_source,options){ this.timestamp=options.timestamp;frames.push(this); }
            close=vi.fn();
        }
        class Encoder {
            constructor(callbacks){this.callbacks=callbacks;this.state='configured';this.encodeQueueSize=0;}
            configure(){}
            encode(frame){encoded.push(frame.timestamp);const data=new Uint8Array([0,0,0,1,frame.timestamp?1:5]);this.callbacks.output({byteLength:data.length,copyTo:b=>b.set(data),type:frame.timestamp?'delta':'key'});}
            async flush(){}
            close(){this.state='closed';}
        }
        const transport = {send:vi.fn(async(i,p)=>writes.push([i,p])),drain:vi.fn(async()=>{}),cancel:vi.fn()};
        const create=new Function('VideoEncoder','VideoFrame','createMediaBinaryTransport',`${read('elementary')}\n${read('video')};return createMediaVideoWriter;`)(Encoder,Frame,()=>transport);
        const fail=vi.fn(), writer=create({native_job_id:'one',capture_codec:'h264',fps:{numerator:60,denominator:1},encoder_config:{}},fail);
        await writer.warmUp({});
        expect(writes).toHaveLength(0);
        writer.frame({},0);writer.frame({},1);writer.frame({},2);
        expect(() => writer.frame({},4)).toThrow('refusing to synthesize');
        const receipt=await writer.finish(3);
        expect(receipt).toMatchObject({encoded_frames:3,repeated_frames:0});
        expect(encoded).toEqual([0,0,16667,33333]);
        expect(writes).toHaveLength(1);
        expect(transport.drain).toHaveBeenCalledOnce();
        expect(frames.every(frame=>frame.close.mock.calls.length===1)).toBe(true);
        expect(fail).not.toHaveBeenCalled();writer.dispose();
    });
});

it('counts acknowledged native packets only after successful writes', async () => {
    let finish;const fetch=vi.fn(()=>new Promise(r=>{finish=r;}));
    const pipe=new Function('fetch',`${read('transport')};return createMediaBinaryTransport;`)(fetch)('progress');
    const pending=pipe.send(0,new Uint8Array([1]));await vi.advanceTimersByTimeAsync(0);
    expect(pipe.progress()).toBe(0);finish({ok:true,json:async()=>({received_frames:1})});await pending;
    expect(pipe.progress()).toBe(1);
});
