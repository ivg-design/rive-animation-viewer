import { readFileSync } from 'node:fs';
import { MEDIA_TOOLS } from '../../../mcp-server/tools/media-tools.js';
import { MEDIA_REQUEST_SCHEMAS, normalizeMediaRequest } from '../../../src/app/platform/media/request-validation.js';
import { createMediaCommands } from '../../../src/app/platform/mcp/commands/media.js';
const matrix = JSON.parse(readFileSync('tests/fixtures/media-request-schema-matrix.json', 'utf8'));
const stripAnnotations = (value) => {
    if (Array.isArray(value)) return value.map(stripAnnotations);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['description','default'].includes(key)).map(([key,item]) => [key,stripAnnotations(item)]));
};
const valid = {
    rav_media_capabilities: {}, rav_export_media: { format:'png' }, rav_record_start: { format:'apng' },
    rav_record_stop: {}, rav_media_status: {}, rav_media_cancel: {}, rav_step_frames: {},
    rav_pointer: { type:'move',x:.5,y:.5 },
};
function harness() {
    const controller=Object.fromEntries(['capabilities','exportMedia','startRecording','stopRecording','status','cancel','stepFrames','pointer'].map(name=>[name,vi.fn(()=>({ok:true}))]));
    const getController=vi.fn(()=>controller);
    return { controller,getController,commands:createMediaCommands({windowRef:{_mcpGetMediaExportController:getController}}) };
}

describe('raw media schema enforcement', () => {
    it('matches every canonical JSON constraint and its generated JS without importing server data at runtime', () => {
        expect(MEDIA_TOOLS).toEqual(JSON.parse(readFileSync('mcp-server/tools/media-tools.json','utf8')));
        expect(Object.keys(MEDIA_REQUEST_SCHEMAS).sort()).toEqual(MEDIA_TOOLS.map(t=>t.name).sort());
        for (const tool of MEDIA_TOOLS) expect(MEDIA_REQUEST_SCHEMAS[tool.name]).toEqual(stripAnnotations(tool.inputSchema));
        const source=readFileSync('src/app/platform/media/request-validation.js','utf8');
        expect(source).not.toMatch(/import[^;]*(?:mcp-server|node:|assert\s*\{|with\s*\{)/);
    });
    it('keeps host interaction validation byte-identical to the renderer without cross-root imports', () => {
        const renderer=readFileSync('src-tauri/src/demo-template/js/media/interaction-schedule.js','utf8');
        const host=readFileSync('src/app/platform/media/interaction-validation.js','utf8');
        const source=renderer.split('var RavMediaInteractions = (function () {')[1].split('    function create(input, options)')[0];
        expect(host.split('const contract = (function () {')[1].split('    return { validate, duration };')[0]).toBe(source);
        expect(host).not.toMatch(/^import /m);
    });
    it('only uses the schema keywords implemented by the mini-validator', () => {
        const supported=new Set(['type','properties','required','additionalProperties','minimum','maximum','exclusiveMinimum','minLength','maxLength','pattern','oneOf','allOf','not','if','then','else','items','minItems','maxItems','const','enum']);
        function visit(schema) {
            for (const [key,value] of Object.entries(schema)) {
                expect(supported.has(key),`Unsupported keyword ${key}`).toBe(true);
                if (key==='properties') Object.values(value).forEach(visit);
                if (['oneOf','allOf'].includes(key)) value.forEach(visit);
                if (['items','not','if','then','else'].includes(key)) visit(value);
            }
        }
        Object.values(MEDIA_REQUEST_SCHEMAS).forEach(visit);
    });
    it.each(Object.keys(valid))('%s rejects unknown top-level arguments before controller lookup', (tool) => {
        const h=harness();expect(()=>h.commands[tool]({...valid[tool],accidental_option:true})).toThrow('unknown property');
        expect(h.getController).not.toHaveBeenCalled();
    });
    it.each(Object.keys(valid))('%s rejects non-object requests and preserves valid dispatch', (tool) => {
        const h=harness();
        for (const value of [null,[],false,1,'{}']) expect(()=>h.commands[tool](value)).toThrow('object');
        expect(h.getController).not.toHaveBeenCalled();expect(h.commands[tool](valid[tool])).toEqual({ok:true});
        expect(h.getController).toHaveBeenCalledOnce();
    });
    it('does not infer a missing format, accepts omitted args only when optional, and does not coerce identifiers', () => {
        expect(()=>normalizeMediaRequest('rav_export_media')).toThrow('format');
        expect(()=>normalizeMediaRequest('rav_record_start')).toThrow('format');
        for (const tool of ['rav_media_capabilities','rav_record_stop','rav_media_status','rav_media_cancel','rav_step_frames']) expect(normalizeMediaRequest(tool)).toEqual({});
        for (const tool of ['rav_media_status','rav_media_cancel']) expect(()=>normalizeMediaRequest(tool,{job_id:1})).toThrow('string');
        expect(()=>normalizeMediaRequest('toString',{})).toThrow('Unknown media tool');
    });
    const invalidCommon = [
        {width:'320'}, {height:180.5}, {scale:'1'}, {scale:0}, {scale:9}, {fps:'30'}, {fps:NaN}, {fps:Infinity},
        {fps:{numerator:'30000',denominator:1001}}, {fps:{numerator:30,denominator:0}}, {fps:{numerator:30,denominator:1,extra:1}},
        {alpha:'true'}, {cursor:1}, {overwrite:'false'}, {quality:80.5}, {quality:101}, {background:'#fff'}, {output_path:123},
        {gif_preset:'typo'}, {gif:{quality:'80'}}, {gif:{repeat:32768}}, {gif:{max_bytes:'10'}}, {gif:{encoder:'unknown'}}, {gif:{unknown:1}},
    ];
    for (const tool of ['rav_record_start','rav_export_media']) {
        it.each(invalidCommon)(`${tool} rejects coercion/range/unknown input %j`, (bad) => {
            const h=harness();expect(()=>h.commands[tool]({format:'gif',...bad})).toThrow();expect(h.getController).not.toHaveBeenCalled();
        });
    }
    it('retains rational FPS, explicit false/zero, and all valid existing encoding options', () => {
        const args={format:'gif',width:320,height:180,scale:.5,fps:{numerator:30000,denominator:1001},quality:80,alpha:false,cursor:false,overwrite:false,background:'#aAbBcC',start_seconds:0,end_seconds:1,gif_preset:'custom',gif:{encoder:'ffmpeg',quality:80,repeat:0,max_bytes:1000,size_policy:'quality_only'}};
        expect(normalizeMediaRequest('rav_export_media',args)).toBe(args);
        expect(args.gif.quality).toBe(80); // Equal dual quality is accepted without rewriting raw input.
    });
    it('preserves unlimited duration and applies agreed typed schedule normalization only after schema validation', () => {
        const args={format:'apng',interactions:[{at_seconds:3601,type:'vm-set',descriptor:{path:'nested.tint',kind:'color'},value:-1}]};
        const normalized=normalizeMediaRequest('rav_record_start',args);
        expect(normalized.duration_seconds).toBeNull();expect(normalized.interactions[0].value).toBe(4294967295);
        expect(normalized.interactions[0].descriptor.path).toBe('nested/tint');expect(args.interactions[0].value).toBe(-1);
        expect(normalizeMediaRequest('rav_record_start',{format:'apng',duration_seconds:4000}).duration_seconds).toBe(4000);
        for (const duration_seconds of ['3',0,-1,Infinity]) expect(()=>normalizeMediaRequest('rav_record_start',{format:'apng',duration_seconds})).toThrow();
    });
    it('rejects sparse arrays and prototype/inherited fields rather than leaking them to capture', () => {
        expect(()=>normalizeMediaRequest('rav_pointer',Object.create({type:'move',x:.5,y:.5}))).toThrow('object');
        expect(()=>normalizeMediaRequest('rav_record_stop',JSON.parse('{"__proto__":{}}'))).toThrow('unknown');
        expect(()=>normalizeMediaRequest('rav_record_start',{format:'apng',interactions:Array(1)})).toThrow('missing array');
    });
    it('checks complete nested/global image and pointer shapes at the handler boundary', () => {
        const h=harness();const descriptor={source:'global-view-model',globalViewModelName:'Shared',path:'rows/0/photo',kind:'image'};
        const op={at_seconds:0,type:'vm-set',descriptor,bytes:[0,255],label:'test'};
        const send=(operation)=>h.commands.rav_record_start({format:'apng',interactions:[operation]});
        expect(send(op)).toEqual({ok:true});h.getController.mockClear();
        for (const bad of [{...op,bytes:[256]},{...op,value:null},{...op,descriptor:{...descriptor,globalViewModelName:undefined}},
            {...op,descriptor:{...descriptor,unknown:true}},{at_seconds:0,type:'pointer',event:'down',x:'0.5',y:0}]) expect(()=>send(bad)).toThrow();
        expect(h.getController).not.toHaveBeenCalled();
    });
    it.each(matrix)('matrix: $id matches canonical static shape/normalization expectation', (row) => {
        const h=harness();const invoke=()=>h.commands[row.tool](row.args);
        if (row.normalize_valid) expect(invoke()).toEqual({ok:true});
        else {expect(invoke).toThrow();expect(h.getController).not.toHaveBeenCalled();}
    });
    it('pins matrix size and preserves the distinction between schema and runtime rejection', () => {
        expect(matrix).toHaveLength(267);
        expect(matrix.find(row=>row.id==='invalid-odd-video').schema_valid).toBe(true);
        expect(matrix.find(row=>row.id==='scheduled-invalid-at-end')).toMatchObject({schema_valid:true,normalize_valid:false});
    });
});
