import { setupPropertiesPanelViewport } from '../../../src/app/ui/layout/properties-panel-viewport.js';

describe('ui/properties-panel-viewport', () => {
    function createViewport() {
        document.body.innerHTML = '<div id="vm-controls-panel"><select><option>image.webp</option></select></div>';
        const viewport = document.getElementById('vm-controls-panel');
        Object.defineProperty(viewport, 'scrollLeft', {
            configurable: true,
            writable: true,
            value: 0,
        });
        return viewport;
    }

    function createAdversarialViewport() {
        document.body.innerHTML = `
            <aside class="panel properties-panel">
                <div id="vm-controls-panel" class="properties-panel-body">
                    <div class="vm-controls-tree">
                        <details class="vm-section" open>
                            <summary class="vm-section-header"><span>A very long root ViewModel label</span></summary>
                            <div class="vm-section-body" data-depth="0">
                                <div class="vm-control-row"><span class="vm-control-label">A very long root image property</span><div class="vm-control-input vm-image-control"><select><option>root.webp</option></select><input class="vm-image-file-input" type="file"></div></div>
                                <details class="vm-section" open><summary class="vm-section-header"><span>A very long nested ViewModel label</span></summary><div class="vm-section-body" data-depth="1"><div class="vm-child-nodes"><div class="vm-control-row"><span class="vm-control-label">A very long nested image property</span><div class="vm-control-input vm-image-control"><select><option>nested.webp</option></select><input class="vm-image-file-input" type="file"></div></div><details class="vm-section" open><summary class="vm-section-header"><span>A very long deeply nested ViewModel label</span></summary><div class="vm-section-body" data-depth="2"><div class="vm-control-row"><span class="vm-control-label">A very long deeply nested image property</span><div class="vm-control-input vm-image-control"><select><option>deep.webp</option></select><input class="vm-image-file-input" type="file"></div></div></div></details></div></div></details>
                            </div>
                        </details>
                    </div>
                </div>
            </aside>
        `;
        const viewport = document.getElementById('vm-controls-panel');
        Object.defineProperties(viewport, {
            clientWidth: { configurable: true, value: 302 },
            scrollLeft: { configurable: true, writable: true, value: 0 },
            scrollWidth: { configurable: true, value: 302 },
        });
        return viewport;
    }

    it('resets focus-induced horizontal scrolling without affecting vertical scroll', () => {
        const viewport = createViewport();
        viewport.scrollTop = 144;
        const frameCallbacks = [];
        const cancelAnimationFrameFn = vi.fn();
        const dispose = setupPropertiesPanelViewport({
            cancelAnimationFrameFn,
            elements: { vmControlsPanel: viewport },
            requestAnimationFrameFn: (callback) => {
                frameCallbacks.push(callback);
                return frameCallbacks.length;
            },
        });

        viewport.scrollLeft = 56;
        viewport.querySelector('select').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(viewport.scrollLeft).toBe(0);
        expect(viewport.scrollTop).toBe(144);

        // WebKit may apply its focus-scroll after the focus event.
        viewport.scrollLeft = 56;
        frameCallbacks.shift()();
        expect(viewport.scrollLeft).toBe(0);

        viewport.scrollLeft = 56;
        viewport.dispatchEvent(new Event('scroll'));
        expect(viewport.scrollLeft).toBe(0);

        viewport.querySelector('select').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        dispose();
        expect(cancelAnimationFrameFn).toHaveBeenCalledTimes(1);
        viewport.scrollLeft = 56;
        viewport.dispatchEvent(new Event('scroll'));
        expect(viewport.scrollLeft).toBe(56);
    });

    it('is a harmless no-op when the properties viewport is absent', () => {
        expect(setupPropertiesPanelViewport({ elements: {} })).toBeTypeOf('function');
    });

    it('holds a narrow, deeply nested image-control tree at the left edge through focus and changes', () => {
        const viewport = createAdversarialViewport();
        const frameCallbacks = [];
        setupPropertiesPanelViewport({
            elements: { vmControlsPanel: viewport },
            requestAnimationFrameFn: (callback) => {
                frameCallbacks.push(callback);
                return frameCallbacks.length;
            },
        });

        expect(viewport.scrollWidth).toBe(viewport.clientWidth);
        expect(viewport.querySelectorAll('.vm-image-file-input')).toHaveLength(3);
        expect(viewport.querySelectorAll('.vm-image-asset-select')).toHaveLength(0);

        for (const select of viewport.querySelectorAll('select')) {
            viewport.scrollLeft = 62;
            select.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
            expect(viewport.scrollLeft).toBe(0);

            viewport.scrollLeft = 62;
            frameCallbacks.shift()();
            expect(viewport.scrollLeft).toBe(0);

            viewport.scrollLeft = 62;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            expect(viewport.scrollLeft).toBe(0);
            frameCallbacks.shift()();
            expect(viewport.scrollLeft).toBe(0);
        }
    });
});
