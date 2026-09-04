import { readFileSync } from 'node:fs';
import { validateRecordingInteractions } from '../../../src/app/platform/media/interaction-validation.js';
import { createMediaCommands } from '../../../src/app/platform/mcp/commands/media.js';
const source = readFileSync('src-tauri/src/demo-template/js/media/interaction-schedule.js', 'utf8');
const api = new Function(source + ';return RavMediaInteractions;')();
const set = (at, path, value, kind = 'number', extra = {}) => ({ at_seconds: at, type: 'vm-set', descriptor: { path, kind, ...extra }, value });

function renderer() {
    const accessors = readFileSync('src-tauri/src/demo-template/js/vm/accessors.js', 'utf8');
    const bootstrap = readFileSync('src-tauri/src/demo-template/js/core/bootstrap.js', 'utf8').replace(/^\s*init\(\);/, '');
    const rootValue = { value: 0 }, nestedValue = { value: '' }, listValue = { value: false }, globalValue = { value: 0 };
    const enumValue = { value: 'One', values: ['One','Two'] };
    const rootImage = { value: null }, fire = vi.fn(), remember = vi.fn(), pointer = vi.fn(), image = { unref: vi.fn() };
    function vm(props = {}, nested = {}, lists = {}) {
        return Object.assign(Object.fromEntries(['number','string','boolean','enum','color','image','trigger'].map(kind => [kind, name => props[kind + ':' + name]])), {
            viewModel: name => nested[name], list: name => lists[name],
        });
    }
    const root = vm({ 'number:x':rootValue, 'enum:choice':enumValue, 'image:photo':rootImage, 'trigger:go': { trigger:fire } },
        { child:vm({'string:text':nestedValue}) }, { rows:{instanceAt: i => i === 0 ? vm({'boolean:visible':listValue}) : null} });
    const player = { viewModelInstance:root, globalViewModelInstance:name => name === 'Shared' ? vm({'color:tint':globalValue}) : null, isPlaying:true };
    const make = new Function('riveInstance','loadedRiveRuntime','rememberRenderSurfaceImageCommand','dispatchRenderSurfacePointer','validateRenderSurfaceImageBytes','recordRenderSurfaceTriggerReceipt','readEnumValues','inspectRenderSurfaceImage',
        'var renderSurfaceSessionId="one";\n' + accessors + '\n' + bootstrap + '\n' + source + '\nreturn {prepare:prepareRenderSurfaceInteractionSchedule,replace:()=>{renderSurfaceSessionId="two"}};');
    const runtime = { decodeImage:vi.fn(async () => image) };
    const inspect = vi.fn(() => ({width:1,height:1}));
    return { ...make(player,runtime,remember,pointer, x=>new Uint8Array(x),vi.fn(),accessor=>accessor?.values || [],inspect), inspect, enumValue, rootValue,nestedValue,listValue,globalValue,rootImage,fire,remember,pointer,image,runtime };
}

describe('typed recording interaction contract', () => {
    it('uses null for omitted/unlimited duration and accepts schedules beyond 300s', () => {
        expect(validateRecordingInteractions({}).duration_seconds).toBeNull();
        expect(validateRecordingInteractions({ duration_seconds:null, interactions:[set(3601,'x',2)] }).interactions).toHaveLength(1);
        expect(validateRecordingInteractions({ duration_seconds:4000 }).duration_seconds).toBe(4000);
    });
    it('validates before asking the controller to start, even without MCP schema enforcement', () => {
        const startRecording=vi.fn();const commands=createMediaCommands({windowRef:{_mcpGetMediaExportController:()=>({startRecording})}});
        expect(()=>commands.rav_record_start({ format:'apng', interactions:[set(1,'x','wrong')] })).toThrow('number');
        expect(startRecording).not.toHaveBeenCalled();
        commands.rav_record_start({format:'apng'});
        expect(startRecording).toHaveBeenCalledWith({format:'apng',duration_seconds:null,interactions:[]});
    });
    it('validates each scalar kind, global descriptors, images, pointer, and exclusive stop', () => {
        for (const [kind,value] of [['number',2],['boolean',false],['string','text'],['enum','Red'],['color',-1]]) {
            const result=api.validate([set(0,'nested.rows.0.value',value,kind)])[0];
            expect(result.descriptor.path).toBe('nested/rows/0/value');
            expect(result.value).toBe(kind==='color'?4294967295:value);
        }
        expect(()=>api.validate([set(1,'x',1)],1)).toThrow('before');
        expect(()=>api.validate([set(0,'x',1,'number',{source:'global-view-model'})])).toThrow('name');
        expect(()=>api.validate([{at_seconds:0,type:'pointer',event:'move',x:2,y:0}])).toThrow('0–1');
        expect(()=>api.validate([{at_seconds:0,type:'vm-set',descriptor:{path:'photo',kind:'image'},bytes:[256]}])).toThrow('byte');
        expect(()=>api.validate([{...set(0,'x',2),unexpected:true}])).toThrow('unknown');
        expect(()=>api.validate([set(0,'x',NaN)])).toThrow('number');
    });
    it('sorts stably, applies frame-zero once, catches up without replay, and reports lateness', () => {
        const apply=vi.fn();const clock=api.create([set(.5,'x',1),set(0,'x',2),set(.5,'x',3)],{apply});
        expect(clock.run(0,0).map(r=>r.index)).toEqual([1]);clock.run(0,0);
        expect(clock.run(.7,7).map(r=>r.index)).toEqual([0,2]);
        expect(apply.mock.calls.map(c=>c[0].value)).toEqual([2,1,3]);
        expect(clock.status().receipts[1].lateness_seconds).toBeCloseTo(.2);
        expect(()=>clock.run(.6,6)).toThrow('monotonic');
    });
    it('stops applying after cancel, source change, first failure or duration boundary', () => {
        const apply=vi.fn();const clock=api.create([set(1,'x',1)],{apply,duration_seconds:2});clock.run(2,20);expect(apply).not.toHaveBeenCalled();clock.cancel();clock.run(3,30);
        const stale=api.create([set(0,'x',1)],{apply,isCurrent:()=>false});expect(()=>stale.run(0,0)).toThrow('source changed');
        const failure=api.create([set(0,'x',1),set(0,'x',2)],{apply:()=>{throw new Error('gone')}});
        expect(()=>failure.run(0,0)).toThrow('gone');expect(()=>failure.run(1,1)).toThrow('gone');expect(failure.status().applied).toBe(0);
    });
    it('routes root, nested, global, list, trigger, and pointer through existing renderer accessors', async () => {
        const h=renderer();const schedule=await h.prepare([set(0,'x',4),set(0,'child/text','new','string'),set(0,'rows/0/visible',true,'boolean'),
            set(0,'tint',-1,'color',{source:'global-view-model',globalViewModelName:'Shared'}),
            {at_seconds:0,type:'vm-trigger',descriptor:{path:'go'}},{at_seconds:0,type:'pointer',event:'down',x:.25,y:.5,buttons:1}]);
        schedule.run(0,0);
        expect([h.rootValue.value,h.nestedValue.value,h.listValue.value,h.globalValue.value]).toEqual([4,'new',true,4294967295]);
        expect(h.fire).toHaveBeenCalledTimes(1);expect(h.pointer).toHaveBeenCalledWith({type:'down',x:.25,y:.5,id:0,buttons:1});
        h.replace();expect(()=>schedule.run(1,1)).toThrow('source');schedule.dispose();
    });
    it('prepares image bytes, assigns synchronously, releases only after draw, then clears', async () => {
        const h=renderer();const descriptor={path:'photo',kind:'image'};
        const schedule=await h.prepare([{at_seconds:0,type:'vm-set',descriptor,bytes:[1,2,3],label:'test'},{at_seconds:1,type:'vm-set',descriptor,value:null}]);
        expect(h.runtime.decodeImage).toHaveBeenCalledOnce();expect(h.rootImage.value).toBeNull();
        schedule.run(0,0);expect(h.rootImage.value).toBe(h.image);expect(h.image.unref).not.toHaveBeenCalled();
        schedule.afterFrame();expect(h.image.unref).toHaveBeenCalledOnce();expect(h.remember).toHaveBeenCalledOnce();
        schedule.run(1,1);expect(h.rootImage.value).toBeNull();schedule.afterFrame();schedule.dispose();expect(h.image.unref).toHaveBeenCalledOnce();
    });
    it('rejects unavailable enum choices and out-of-range list targets at execution', async () => {
        const h=renderer();const good=await h.prepare([set(0,'choice','Two','enum')]);good.run(0,0);expect(h.enumValue.value).toBe('Two');
        const bad=await h.prepare([set(0,'choice','Missing','enum')]);expect(()=>bad.run(0,0)).toThrow('choice');
        const list=await h.prepare([set(0,'rows/4/visible',true,'boolean')]);expect(()=>list.run(0,0)).toThrow('unavailable');
    });
    it('releases images if the source changes while decode is pending', async () => {
        const h=renderer();let resolveDecode;h.runtime.decodeImage.mockImplementation(()=>new Promise(resolve=>{resolveDecode=resolve}));
        const pending=h.prepare([{at_seconds:0,type:'vm-set',descriptor:{path:'photo',kind:'image'},bytes:[1]}]);
        h.replace();resolveDecode(h.image);await expect(pending).rejects.toThrow('source changed');expect(h.image.unref).toHaveBeenCalledOnce();
    });
    it('checks the complete decoded image budget before any decode, including boundary equality', async () => {
        const h=renderer();const op={at_seconds:0,type:'vm-set',descriptor:{path:'photo',kind:'image'},bytes:[1]};
        h.inspect.mockReturnValue({width:8192,height:8192}); // Exactly 256 MiB RGBA.
        const atLimit=await h.prepare([op]);atLimit.dispose();expect(h.runtime.decodeImage).toHaveBeenCalledOnce();
        h.runtime.decodeImage.mockClear();h.inspect.mockReset().mockReturnValueOnce({width:8192,height:8192}).mockReturnValue({width:1,height:1});
        await expect(h.prepare([op,op])).rejects.toThrow('256 MiB');expect(h.runtime.decodeImage).not.toHaveBeenCalled();
    });
    it('rejects unknown/nonpositive/fractional dimensions before decoding any scheduled image', async () => {
        const h=renderer();const op={at_seconds:0,type:'vm-set',descriptor:{path:'photo',kind:'image'},bytes:[1]};
        for (const width of [null,0,-1,1.5,NaN,Infinity]) {
            h.inspect.mockReturnValue({width,height:1});await expect(h.prepare([op])).rejects.toThrow('dimensions');
        }
        h.inspect.mockReset().mockReturnValueOnce({width:1,height:1}).mockReturnValue({width:null,height:null});
        await expect(h.prepare([op,op])).rejects.toThrow('dimensions');expect(h.runtime.decodeImage).not.toHaveBeenCalled();
    });
    it('checks the aggregate encoded budget before any decode without large real allocations', async () => {
        // Isolate preparation from the already separately-tested byte-array validator.
        // Compact test doubles supply encoded lengths to exercise the aggregate pass.
        const normalized=[{bytes:{length:16777216}},{bytes:{length:16777216}},{bytes:{length:1}}];
        const decode=vi.fn();const inspect=vi.fn(()=>({width:1,height:1}));
        const prepare=new Function('riveInstance','renderSurfaceSessionId','loadedRiveRuntime','validateRenderSurfaceImageBytes','inspectRenderSurfaceImage',
            source+'; RavMediaInteractions={validate:()=>arguments[5]}; return prepareRenderSurfaceInteractionSchedule;')({},'one',{decodeImage:decode},x=>x,inspect,normalized);
        await expect(prepare([])).rejects.toThrow('32 MiB');expect(decode).not.toHaveBeenCalled();expect(inspect).toHaveBeenCalledTimes(2);
    });
    it('releases prepared images when cancelled before they are due', async () => {
        const h=renderer();const schedule=await h.prepare([{at_seconds:5,type:'vm-set',descriptor:{path:'photo',kind:'image'},bytes:[1]}]);
        schedule.dispose();schedule.dispose();schedule.run(5,50);expect(h.image.unref).toHaveBeenCalledOnce();expect(h.rootImage.value).toBeNull();
    });
});

it('does not move an exact-frame interaction one frame late after JSON float round trips', () => {
    const apply=vi.fn();const clock=api.create([set(.11666666666666668,'x',1)],{apply});
    expect(clock.run(7/60,7)).toMatchObject([{frame_index:7,lateness_seconds:0}]);
    clock.run(8/60,8);expect(apply).toHaveBeenCalledOnce();
});

it('releases a decoded image arriving after preparation was cancelled and does not decode subsequent images', async () => {
    const h = renderer(); let resolve, current = true;
    h.runtime.decodeImage.mockImplementation(() => new Promise(done => {resolve=done;}));
    const op = {at_seconds:0,type:'vm-set',descriptor:{path:'photo',kind:'image'},bytes:[1]};
    const pending=h.prepare([op,{...op,at_seconds:1}],{},()=>current);
    const rejected=expect(pending).rejects.toThrow('source changed');
    current=false;resolve(h.image);await rejected;
    expect(h.image.unref).toHaveBeenCalledTimes(1);
    expect(h.runtime.decodeImage).toHaveBeenCalledTimes(1);
    expect(h.rootImage.value).toBeNull();
});

it('cancel releases prepared images immediately, then releases the pending image once it arrives', async () => {
    const h=renderer();let done,cancel,current=true;const late={unref:vi.fn()};
    h.runtime.decodeImage.mockResolvedValueOnce(h.image).mockImplementationOnce(()=>new Promise(r=>{done=r;}));
    const op={at_seconds:0,type:'vm-set',descriptor:{path:'photo',kind:'image'},bytes:[1]};
    const pending=h.prepare([op,{...op,at_seconds:1}],{},()=>current,dispose=>{cancel=dispose;});
    const rejected=expect(pending).rejects.toThrow('source changed');await vi.advanceTimersByTimeAsync(0);
    current=false;cancel();expect(h.image.unref).toHaveBeenCalledTimes(1);
    done(late);await rejected;expect(h.image.unref).toHaveBeenCalledTimes(1);expect(late.unref).toHaveBeenCalledTimes(1);
});
