import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildCenteredCanvasScrollOffsets } from '../../../src/app/core/canvas-sizing.js';

const workspaceCss = readFileSync(
    path.join(process.cwd(), 'styles', '03-workspace.css'),
    'utf8',
);

function createFixedCanvasLayout({
    containerWidth,
    containerHeight,
    canvasWidth,
    canvasHeight,
}) {
    document.head.innerHTML = `<style>${workspaceCss}</style>`;
    document.body.innerHTML = `
        <div id="canvas-container" class="canvas-drop-target canvas-container-fixed-size">
            <canvas id="rive-canvas" class="rive-canvas-fixed-size"></canvas>
        </div>
    `;

    const container = document.getElementById('canvas-container');
    const canvas = document.getElementById('rive-canvas');
    Object.defineProperties(container, {
        clientWidth: { configurable: true, value: containerWidth },
        clientHeight: { configurable: true, value: containerHeight },
    });
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    return {
        canvas,
        canvasStyle: getComputedStyle(canvas),
        container,
        containerStyle: getComputedStyle(container),
        offsets: buildCenteredCanvasScrollOffsets({
            containerWidth,
            containerHeight,
            contentWidth: canvasWidth,
            contentHeight: canvasHeight,
        }),
    };
}

describe('fixed canvas layout', () => {
    it('centers a smaller canvas through positive-space flex auto margins', () => {
        const layout = createFixedCanvasLayout({
            containerWidth: 1200,
            containerHeight: 1000,
            canvasWidth: 1000,
            canvasHeight: 934,
        });

        expect(layout.containerStyle.display).toBe('flex');
        expect(layout.containerStyle.overflow).toBe('auto');
        expect(layout.containerStyle.justifyContent).toBe('flex-start');
        expect(layout.containerStyle.alignItems).toBe('flex-start');
        expect(layout.canvasStyle.marginTop).toBe('auto');
        expect(layout.canvasStyle.marginRight).toBe('auto');
        expect(layout.canvasStyle.marginBottom).toBe('auto');
        expect(layout.canvasStyle.marginLeft).toBe('auto');
        expect(layout.offsets).toEqual({ left: 0, top: 0 });
    });

    it('keeps a larger canvas scroll-origin-safe while JS selects its centered viewport', () => {
        const layout = createFixedCanvasLayout({
            containerWidth: 900,
            containerHeight: 600,
            canvasWidth: 1600,
            canvasHeight: 900,
        });

        expect(layout.containerStyle.overflow).toBe('auto');
        expect(layout.containerStyle.justifyContent).toBe('flex-start');
        expect(layout.containerStyle.alignItems).toBe('flex-start');
        expect(layout.canvasStyle.marginTop).toBe('auto');
        expect(layout.canvasStyle.marginLeft).toBe('auto');
        expect(layout.offsets).toEqual({ left: 350, top: 150 });
        expect(layout.offsets.left).toBeLessThanOrEqual(1600 - 900);
        expect(layout.offsets.top).toBeLessThanOrEqual(900 - 600);
    });
});
