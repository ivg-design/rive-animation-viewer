import { controlSnapshotKeyForDescriptor } from '../../rive/vm-controls.js';

export function collectNodeInputKeys(node, keys = new Set()) {
    if (!node) {
        return keys;
    }
    (node.inputs || []).forEach((input) => {
        const key = controlSnapshotKeyForDescriptor(input?.descriptor);
        if (key) keys.add(key);
    });
    (node.children || []).forEach((child) => collectNodeInputKeys(child, keys));
    return keys;
}

export function sanitizeSelection(selection, availableKeys) {
    const nextSelection = new Set();
    if (!(selection instanceof Set)) {
        return nextSelection;
    }
    selection.forEach((key) => {
        if (availableKeys.has(key)) nextSelection.add(key);
    });
    return nextSelection;
}

function countSelectedKeys(node, selectedKeys) {
    const keys = collectNodeInputKeys(node);
    let selected = 0;
    keys.forEach((key) => {
        if (selectedKeys.has(key)) selected += 1;
    });
    return { selected, total: keys.size };
}

function getTreeNodeKey(node, parentKey = '') {
    const ownKey = [node?.kind || 'node', node?.path || '', node?.label || ''].join(':');
    return parentKey ? `${parentKey}>${ownKey}` : ownKey;
}

function createInputRow({ depth, documentRef, input, onSelectionChange, selectedKeys }) {
    const row = documentRef.createElement('label');
    row.className = 'instantiation-input-row';
    row.style.setProperty('--tree-depth', String(depth));
    const checkbox = documentRef.createElement('input');
    checkbox.type = 'checkbox';
    const key = controlSnapshotKeyForDescriptor(input?.descriptor);
    checkbox.checked = Boolean(key && selectedKeys?.has(key));
    checkbox.disabled = !key;
    checkbox.addEventListener('change', () => {
        if (!key) return;
        const nextSelection = new Set(selectedKeys);
        if (checkbox.checked) nextSelection.add(key);
        else nextSelection.delete(key);
        onSelectionChange(nextSelection);
    });

    const text = documentRef.createElement('div');
    text.className = 'instantiation-input-text';
    const title = documentRef.createElement('span');
    title.className = 'instantiation-input-title';
    title.textContent = `${input.name} (${input.kind})`;
    const meta = documentRef.createElement('span');
    meta.className = 'instantiation-input-meta';
    meta.textContent = input.source === 'state-machine' ? `${input.stateMachineName} / ${input.name}` : input.path;
    text.append(title, meta);
    row.append(checkbox, text);
    return row;
}

function createTreeNode({
    depth = 0,
    documentRef,
    expandedBranchKeys,
    node,
    onSelectionChange,
    parentKey = '',
    selectedKeys,
}) {
    const nodeKey = getTreeNodeKey(node, parentKey);
    const wrapper = documentRef.createElement('div');
    wrapper.className = 'instantiation-tree-node';
    wrapper.style.setProperty('--tree-depth', String(depth));
    const counts = countSelectedKeys(node, selectedKeys);
    const branchKeys = collectNodeInputKeys(node);

    const details = documentRef.createElement('details');
    details.className = 'instantiation-tree-branch';
    details.open = expandedBranchKeys.has(nodeKey) ? true : depth < 1;
    if (details.open) expandedBranchKeys.add(nodeKey);
    details.addEventListener('toggle', () => {
        if (details.open) expandedBranchKeys.add(nodeKey);
        else expandedBranchKeys.delete(nodeKey);
    });

    const summary = documentRef.createElement('summary');
    summary.className = 'instantiation-tree-summary';
    const checkbox = documentRef.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = counts.total > 0 && counts.selected === counts.total;
    checkbox.indeterminate = counts.selected > 0 && counts.selected < counts.total;
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => {
        const nextSelection = new Set(selectedKeys);
        branchKeys.forEach((key) => {
            if (checkbox.checked) nextSelection.add(key);
            else nextSelection.delete(key);
        });
        onSelectionChange(nextSelection);
    });

    const label = documentRef.createElement('span');
    label.className = 'instantiation-tree-label';
    label.textContent = node.label;
    const badge = documentRef.createElement('span');
    badge.className = 'instantiation-tree-badge';
    badge.textContent = counts.total ? `${counts.selected}/${counts.total}` : '0';
    summary.append(checkbox, label, badge);
    details.appendChild(summary);

    const body = documentRef.createElement('div');
    body.className = 'instantiation-tree-body';
    (node.inputs || []).forEach((input) => {
        body.appendChild(createInputRow({ depth: depth + 1, documentRef, input, onSelectionChange, selectedKeys }));
    });
    (node.children || []).forEach((child) => {
        body.appendChild(createTreeNode({
            depth: depth + 1,
            documentRef,
            expandedBranchKeys,
            node: child,
            onSelectionChange,
            parentKey: nodeKey,
            selectedKeys,
        }));
    });

    if (!node.inputs?.length && !node.children?.length) {
        const empty = documentRef.createElement('p');
        empty.className = 'instantiation-tree-empty';
        empty.textContent = 'No controls in this branch.';
        body.appendChild(empty);
    }

    details.appendChild(body);
    wrapper.appendChild(details);
    return wrapper;
}

export function renderControlHierarchyTree({
    currentHierarchy,
    documentRef = globalThis.document,
    expandedBranchKeys = new Set(),
    onSelectionChange = () => {},
    selectedKeys = new Set(),
    treeElement,
} = {}) {
    if (!treeElement) {
        return;
    }
    treeElement.innerHTML = '';
    if (!currentHierarchy?.children?.length) {
        const empty = documentRef.createElement('p');
        empty.className = 'instantiation-tree-empty';
        empty.textContent = 'No bound ViewModel or state machine controls are available.';
        treeElement.appendChild(empty);
        return;
    }
    currentHierarchy.children.forEach((node) => {
        treeElement.appendChild(createTreeNode({
            documentRef,
            expandedBranchKeys,
            node,
            onSelectionChange,
            selectedKeys,
        }));
    });
}
