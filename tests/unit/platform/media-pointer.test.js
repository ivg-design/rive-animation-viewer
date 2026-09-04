import { readFileSync } from 'node:fs';
const source = readFileSync('src-tauri/src/demo-template/js/media/recording.js', 'utf8');
describe('agentic mouse interaction', () => {
    it('delivers the mouse events Rive Web actually listens to, with the same cursor coordinates', () => {
        const canvas = document.createElement('canvas'), state = {}, seen = [];
        canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 });
        for (const name of ['mousedown', 'mousemove', 'mouseup', 'mouseout']) {
            canvas.addEventListener(name, (event) => seen.push([event.type, event.clientX, event.clientY, event.buttons]));
        }
        const send = new Function('isRenderSurfaceMode', 'els', 'getRenderSurfaceMediaState',
            `${source}; return dispatchRenderSurfacePointer;`)(false, { canvas }, () => state);
        send({ type: 'down', x: .25, y: .5 });
        send({ type: 'move', x: .5, y: .75, buttons: 1 });
        send({ type: 'up', x: .5, y: .75 });
        send({ type: 'exit', x: 1, y: 1 });
        expect(seen).toEqual([['mousedown', 60, 70, 1], ['mousemove', 110, 95, 1], ['mouseup', 110, 95, 0], ['mouseout', 210, 120, 0]]);
        expect(state.cursor).toEqual({ x: 1, y: 1, inside: false });
        expect(() => send({ type: 'move', x: NaN, y: 0 })).toThrow('normalized');
        expect(() => send({ type: 'down', x: .5, y: .5, id: 2 })).toThrow('multi-touch');
    });
});
