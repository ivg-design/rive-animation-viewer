import {
    renderControlHierarchyTree,
    updateControlHierarchySelection,
} from '../../../src/app/ui/export/control-tree.js';

function hierarchy(size = 999) {
    return {
        children: [{
            children: [],
            inputs: Array.from({ length: size }, (_, index) => ({
                descriptor: { kind: 'number', name: `value${index}`, path: `rows/${index}/value` },
                kind: 'number',
                name: `value${index}`,
                path: `rows/${index}/value`,
            })),
            kind: 'vm',
            label: 'Large VM',
            path: 'rows',
        }],
        inputs: [],
        kind: 'controls',
        label: 'Controls',
        path: '__controls__',
    };
}

describe('large export control tree selection updates', () => {
    it('updates 999 selections in place without rebuilding the tree', () => {
        const treeElement = document.createElement('div');
        const currentHierarchy = hierarchy();
        renderControlHierarchyTree({
            currentHierarchy,
            documentRef: document,
            selectedKeys: new Set(),
            treeElement,
        });
        const firstRow = treeElement.querySelector('.instantiation-input-row');
        const selectedKeys = new Set(['vm:rows/*/value:number']);

        updateControlHierarchySelection({ currentHierarchy, selectedKeys, treeElement });

        expect(treeElement.querySelector('.instantiation-input-row')).toBe(firstRow);
        expect(treeElement.querySelectorAll('[data-control-key]:checked')).toHaveLength(999);
        expect(treeElement.querySelector('.instantiation-tree-badge').textContent).toBe('999/999');
    });
});
