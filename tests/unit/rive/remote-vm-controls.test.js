import { createVmControlsController } from '../../../src/app/rive/vm-controls.js';

function createElements() {
    document.body.innerHTML = `
        <div id="main-grid"></div>
        <span id="vm-controls-count"></span>
        <p id="vm-controls-empty"></p>
        <div id="vm-controls-tree"></div>
    `;
    return {
        mainGrid: document.getElementById('main-grid'),
        vmControlsCount: document.getElementById('vm-controls-count'),
        vmControlsEmpty: document.getElementById('vm-controls-empty'),
        vmControlsTree: document.getElementById('vm-controls-tree'),
    };
}

function canonicalState({
    enabled = false,
    inputName = 'enabled',
    revision = 1,
    sessionId = null,
    topologyRevision = 1,
} = {}) {
    return {
        revision,
        sessionId,
        stateRevision: revision,
        topologyRevision,
        controlsHierarchy: {
            children: [{
                children: [],
                inputs: [{
                    descriptor: {
                        kind: 'boolean',
                        name: inputName,
                        path: inputName,
                        source: 'view-model',
                    },
                    kind: 'boolean',
                    value: enabled,
                }],
                kind: 'vm',
                label: 'MainVM',
                path: '<root>',
            }],
            inputs: [],
            kind: 'controls',
            label: 'Controls',
            path: '<controls>',
        },
    };
}

describe('child-authoritative ViewModel controls', () => {
    it('renders canonical child values, sends mutations without writing the hidden parent, and reconciles by revision', () => {
        const elements = createElements();
        let state = canonicalState();
        const mutations = [];
        const intervals = vi.fn();
        document.addEventListener('rav:vm-control-mutated', (event) => mutations.push(event.detail), { once: true });
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn(), showError: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
            setIntervalFn: intervals,
        });

        controller.renderVmInputControls();
        const checkbox = elements.vmControlsTree.querySelector('input[type="checkbox"]');
        expect(elements.vmControlsCount.textContent).toBe('1');
        expect(checkbox.checked).toBe(false);
        expect(intervals).not.toHaveBeenCalled();

        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(mutations).toEqual([expect.objectContaining({ kind: 'boolean', value: true })]);

        state = canonicalState({ enabled: true, revision: 2 });
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));
        expect(checkbox.checked).toBe(true);
        controller.stopVmControlSync();
    });

    it('rolls an optimistic control back when the child rejects the command', () => {
        const elements = createElements();
        const showError = vi.fn();
        const state = canonicalState({ enabled: false });
        const controller = createVmControlsController({
            callbacks: { showError },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });
        controller.renderVmInputControls();
        const checkbox = elements.vmControlsTree.querySelector('input[type="checkbox"]');
        checkbox.checked = true;
        document.dispatchEvent(new CustomEvent('rav:render-surface-command-result', {
            detail: { applied: false, commandType: 'vm-set', status: 'rejected' },
        }));
        expect(checkbox.checked).toBe(false);
        expect(showError).toHaveBeenCalledWith(expect.stringContaining('rejected'));
        controller.stopVmControlSync();
    });

    it('disables remote controls through fatal recovery until replacement authority activates', () => {
        const elements = createElements();
        const showError = vi.fn();
        const mutations = [];
        let authority = { canAcceptCommands: true };
        const state = canonicalState({ enabled: false });
        const onMutation = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', onMutation);
        const controller = createVmControlsController({
            callbacks: { showError },
            documentRef: document,
            elements,
            getRenderSurfaceAuthority: () => authority,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });

        controller.renderVmInputControls();
        const checkbox = elements.vmControlsTree.querySelector('input[type="checkbox"]');
        expect(checkbox.disabled).toBe(false);

        authority = { canAcceptCommands: false, recoveryState: 'recovering' };
        document.dispatchEvent(new CustomEvent('rav:render-surface-authority-change', { detail: authority }));
        expect(checkbox.disabled).toBe(true);

        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(mutations).toEqual([]);
        expect(showError).toHaveBeenCalledWith(expect.stringContaining('recovering'));

        authority = { canAcceptCommands: true, recoveryState: 'idle' };
        document.dispatchEvent(new CustomEvent('rav:render-surface-authority-change', { detail: authority }));
        expect(checkbox.disabled).toBe(false);
        expect(checkbox.checked).toBe(false);

        controller.stopVmControlSync();
        document.removeEventListener('rav:vm-control-mutated', onMutation);
    });

    it('keeps authoritative image transport enabled without a decoder in the parent and gates it during recovery', () => {
        const elements = createElements();
        let authority = { canAcceptCommands: true };
        const state = {
            revision: 1,
            sessionId: 'image-session',
            stateRevision: 1,
            topologyRevision: 1,
            controlsHierarchy: {
                children: [{
                    children: [],
                    inputs: [{
                        descriptor: {
                            kind: 'image',
                            name: 'avatar',
                            path: 'avatar',
                            source: 'view-model',
                        },
                        kind: 'image',
                        value: null,
                    }],
                    kind: 'vm',
                    label: 'MainVM',
                    path: '<root>',
                }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '<controls>',
            },
        };
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getEmbeddedImageAssets: () => [{
                bytes: new Uint8Array([1, 2, 3]),
                name: 'Embedded avatar',
            }],
            getLoadedRuntime: () => null,
            getRenderSurfaceAuthority: () => authority,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });

        controller.renderVmInputControls();
        const select = elements.vmControlsTree.querySelector('.vm-image-asset-select');
        const fileInput = elements.vmControlsTree.querySelector('.vm-image-file-input');
        expect(select.disabled).toBe(false);
        expect(fileInput.disabled).toBe(false);
        expect(select.querySelector('option[value="embedded:0"]').disabled).toBe(false);
        expect(select.querySelector('option[value="__open__"]').disabled).toBe(false);

        authority = { canAcceptCommands: false, recoveryState: 'recovering' };
        document.dispatchEvent(new CustomEvent('rav:render-surface-authority-change', { detail: authority }));
        expect(select.disabled).toBe(true);
        expect(fileInput.disabled).toBe(true);

        authority = { canAcceptCommands: true, recoveryState: 'idle' };
        document.dispatchEvent(new CustomEvent('rav:render-surface-authority-change', { detail: authority }));
        expect(select.disabled).toBe(false);
        expect(fileInput.disabled).toBe(false);
        expect(select.querySelector('option[value="embedded:0"]').disabled).toBe(false);
        expect(select.querySelector('option[value="__open__"]').disabled).toBe(false);
        controller.stopVmControlSync();
    });

    it('clears image selector metadata when the canonical child sends an acknowledged clear delta', () => {
        const elements = createElements();
        let state = {
            revision: 1,
            sessionId: 'image-clear-session',
            stateRevision: 1,
            topologyRevision: 1,
            controlsHierarchy: {
                children: [{
                    children: [],
                    inputs: [{
                        descriptor: { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' },
                        kind: 'image',
                        metadata: { kind: 'embedded', key: 'asset-a', label: 'A' },
                        present: true,
                    }],
                    kind: 'vm',
                    label: 'MainVM',
                    path: '<root>',
                }],
                inputs: [], kind: 'controls', label: 'Controls', path: '<controls>',
            },
        };
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getEmbeddedImageAssets: () => [{ key: 'asset-a', name: 'A', bytes: new Uint8Array([1]) }],
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });

        controller.renderVmInputControls();
        const select = elements.vmControlsTree.querySelector('.vm-image-asset-select');
        expect(select.value).toBe('embedded:0');

        state = {
            ...state,
            controlChanges: [{ key: 'vm:avatar:image', kind: 'image', metadata: null, present: false }],
            revision: 2,
            stateRevision: 2,
        };
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));

        expect(select.value).toBe('');
        controller.stopVmControlSync();
    });

    it('reconciles a same-topology value delta without emitting a mutation event', () => {
        const elements = createElements();
        const mutations = [];
        const onMutation = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', onMutation);
        let state = canonicalState({ enabled: false, revision: 1, topologyRevision: 1 });
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });
        controller.renderVmInputControls();
        const checkbox = elements.vmControlsTree.querySelector('input[type="checkbox"]');

        state = {
            ...state,
            controlChanges: [{ key: 'vm:enabled:boolean', kind: 'boolean', value: true }],
            revision: 2,
            stateRevision: 2,
        };
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));

        expect(checkbox.checked).toBe(true);
        expect(mutations).toEqual([]);
        controller.stopVmControlSync();
        document.removeEventListener('rav:vm-control-mutated', onMutation);
    });

    it('defers enum canonical updates while the native select is focused', () => {
        const elements = createElements();
        const enumState = (value, revision) => ({
            revision,
            sessionId: 'enum-session',
            stateRevision: revision,
            topologyRevision: 1,
            controlsHierarchy: {
                children: [{
                    children: [],
                    inputs: [{
                        descriptor: {
                            kind: 'enum', name: 'mode', path: 'mode', source: 'view-model',
                        },
                        kind: 'enum',
                        value,
                        values: ['line', 'bar'],
                    }],
                    kind: 'vm',
                    label: 'MainVM',
                    path: '<root>',
                }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '<controls>',
            },
        });
        let state = enumState('line', 1);
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });

        controller.renderVmInputControls();
        const select = elements.vmControlsTree.querySelector('select');
        select.focus();
        state = enumState('bar', 2);
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));

        expect(document.activeElement).toBe(select);
        expect(select.value).toBe('line');

        select.blur();
        state = enumState('bar', 3);
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));
        expect(select.value).toBe('bar');
        controller.stopVmControlSync();
    });

    it('accepts an enum canonical ACK after the native select trailing click', () => {
        const elements = createElements();
        const enumState = (value, revision) => ({
            revision,
            sessionId: 'enum-ack-session',
            stateRevision: revision,
            topologyRevision: 1,
            controlsHierarchy: {
                children: [{
                    children: [],
                    inputs: [{
                        descriptor: {
                            kind: 'enum', name: 'mode', path: 'mode', source: 'view-model',
                        },
                        kind: 'enum',
                        value,
                        values: ['line', 'bar'],
                    }],
                    kind: 'vm',
                    label: 'MainVM',
                    path: '<root>',
                }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '<controls>',
            },
        });
        let state = enumState('line', 1);
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });
        controller.renderVmInputControls();
        const select = elements.vmControlsTree.querySelector('select');

        select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        select.value = 'bar';
        select.dispatchEvent(new Event('change'));
        select.dispatchEvent(new Event('click', { bubbles: true }));
        state = enumState('line', 2);
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));

        expect(select.value).toBe('line');
        controller.stopVmControlSync();
    });

    it('defers a remote topology rebuild until an enum popup interaction ends', () => {
        const elements = createElements();
        const enumState = ({ name, revision, topologyRevision, value }) => ({
            revision,
            sessionId: 'enum-session',
            stateRevision: revision,
            topologyRevision,
            controlsHierarchy: {
                children: [{
                    children: [],
                    inputs: [{
                        descriptor: {
                            kind: 'enum', name, path: name, source: 'view-model',
                        },
                        kind: 'enum',
                        value,
                        values: ['line', 'bar'],
                    }],
                    kind: 'vm',
                    label: 'MainVM',
                    path: '<root>',
                }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '<controls>',
            },
        });
        let state = enumState({ name: 'mode', revision: 1, topologyRevision: 1, value: 'line' });
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });

        controller.renderVmInputControls();
        const select = elements.vmControlsTree.querySelector('select');
        select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        state = enumState({ name: 'nextMode', revision: 2, topologyRevision: 2, value: 'bar' });
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));

        expect(select.isConnected).toBe(true);
        expect(elements.vmControlsTree.querySelector('[title="mode"]')).not.toBeNull();
        expect(elements.vmControlsTree.querySelector('[title="nextMode"]')).toBeNull();

        select.dispatchEvent(new Event('blur'));
        expect(elements.vmControlsTree.querySelector('[title="mode"]')).toBeNull();
        expect(elements.vmControlsTree.querySelector('[title="nextMode"]')).not.toBeNull();
        controller.stopVmControlSync();
    });

    it('accepts lower revisions from a replacement session and rerenders equal-revision topology', () => {
        const elements = createElements();
        let state = canonicalState({
            enabled: false,
            revision: 40,
            sessionId: 'session-old',
            topologyRevision: 7,
        });
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });
        controller.renderVmInputControls();
        expect(elements.vmControlsTree.querySelector('[title="enabled"]')).not.toBeNull();

        state = canonicalState({
            enabled: true,
            inputName: 'visible',
            revision: 1,
            sessionId: 'session-new',
            topologyRevision: 7,
        });
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));

        expect(elements.vmControlsTree.querySelector('[title="enabled"]')).toBeNull();
        const replacementRow = elements.vmControlsTree
            .querySelector('[title="visible"]')
            ?.closest('.vm-control-row');
        expect(replacementRow?.querySelector('input[type="checkbox"]')?.checked).toBe(true);
        expect(elements.vmControlsCount.textContent).toBe('1');
        expect(controller.getVmSyncDiagnostics()).toEqual(expect.objectContaining({
            stateRevision: 1,
            topologyRevision: 7,
        }));
        controller.stopVmControlSync();
    });

    it('accepts a topology-only canonical advance within the active session', () => {
        const elements = createElements();
        let state = canonicalState({
            inputName: 'enabled',
            revision: 5,
            sessionId: 'session-active',
            topologyRevision: 1,
        });
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });

        controller.renderVmInputControls();
        expect(elements.vmControlsTree.querySelector('[title="enabled"]')).not.toBeNull();

        state = canonicalState({
            inputName: 'visible',
            revision: 5,
            sessionId: 'session-active',
            topologyRevision: 2,
        });
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));

        expect(elements.vmControlsTree.querySelector('[title="enabled"]')).toBeNull();
        expect(elements.vmControlsTree.querySelector('[title="visible"]')).not.toBeNull();
        expect(controller.getVmSyncDiagnostics()).toEqual(expect.objectContaining({
            stateRevision: 5,
            topologyRevision: 2,
        }));
        controller.stopVmControlSync();
    });

    it('reconciles mixed values across topology grow/shrink and ignores stale revisions without mutations', () => {
        const elements = createElements();
        const mutations = [];
        const onMutation = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', onMutation);
        const input = (kind, name, value, extra = {}) => ({
            descriptor: { kind, name, path: name, source: 'view-model', ...extra },
            kind,
            value,
            ...extra,
        });
        const baseInputs = [
            input('boolean', 'enabled', false),
            input('number', 'speed', 12),
            input('string', 'title', 'before'),
            input('color', 'accent', 0xff336699),
            input('enum', 'mode', 'line', { values: ['bar', 'line', 'area'] }),
        ];
        const makeState = (inputs, revision, topologyRevision = revision) => ({
            revision,
            stateRevision: revision,
            topologyRevision,
            controlsHierarchy: {
                children: [{ children: [], inputs, kind: 'vm', label: 'MainVM', path: '<root>' }],
                inputs: [],
                kind: 'controls',
                label: 'Controls',
                path: '<controls>',
            },
        });
        let state = makeState(baseInputs, 1);
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });

        controller.renderVmInputControls();
        expect(elements.vmControlsCount.textContent).toBe('5');
        const row = (path) => elements.vmControlsTree.querySelector(`[title="${path}"]`)?.closest('.vm-control-row');
        expect(row('enabled').querySelector('input').checked).toBe(false);
        expect(row('speed').querySelector('input').value).toBe('12');
        expect(row('title').querySelector('textarea').value).toBe('before');
        expect(row('accent').querySelector('input[type="color"]').value).toBe('#336699');
        expect(row('mode').querySelector('select').value).toBe('line');

        const grownInputs = [...baseInputs, input('number', 'count', 3)];
        state = makeState(grownInputs, 2, 2);
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));
        expect(elements.vmControlsCount.textContent).toBe('6');

        state = makeState([
            input('boolean', 'enabled', true),
            input('number', 'speed', 24),
            input('string', 'title', 'after'),
            input('color', 'accent', 0xffcc8844),
            input('enum', 'mode', 'area', { values: ['bar', 'line', 'area'] }),
        ], 3, 3);
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));
        expect(elements.vmControlsCount.textContent).toBe('5');
        expect(row('enabled').querySelector('input').checked).toBe(true);
        expect(row('speed').querySelector('input').value).toBe('24');
        expect(row('title').querySelector('textarea').value).toBe('after');
        expect(row('accent').querySelector('input[type="color"]').value).toBe('#cc8844');
        expect(row('mode').querySelector('select').value).toBe('area');

        const stale = makeState(baseInputs, 2, 2);
        state = stale;
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: stale }));
        expect(elements.vmControlsCount.textContent).toBe('5');
        expect(row('speed').querySelector('input').value).toBe('24');
        expect(mutations).toEqual([]);

        controller.stopVmControlSync();
        document.removeEventListener('rav:vm-control-mutated', onMutation);
    });

    it('preserves expanded root, nested, and list-instance branches across an acknowledged trigger rerender', () => {
        const elements = createElements();
        const input = (kind, name, path, extra = {}) => ({
            descriptor: { kind, name, path, source: 'view-model' },
            kind,
            ...extra,
        });
        const hierarchy = () => ({
            children: [{
                children: [{
                    children: [],
                    inputs: [input('boolean', 'enabled', 'settings/enabled', { value: true })],
                    kind: 'vm', label: 'Settings', path: 'settings',
                }, {
                    children: [{
                        children: [{
                            children: [],
                            inputs: [input('number', 'speed', 'rows/0/nested/speed', { value: 3 })],
                            kind: 'vm', label: 'Nested', path: 'rows/0/nested',
                        }],
                        inputs: [input('number', 'value', 'rows/0/value', { value: 1 })],
                        kind: 'instance', label: 'Row 1', path: 'rows/0',
                    }],
                    inputs: [],
                    kind: 'list', label: 'rows [1]', path: 'rows',
                }],
                inputs: [input('trigger', 'Fire', 'Fire')],
                kind: 'vm', label: 'Root VM', path: '<root>',
            }],
            inputs: [], kind: 'controls', label: 'Controls', path: '<controls>',
        });
        const makeState = (revision, topologyRevision, extra = {}) => ({
            revision,
            sessionId: 'trigger-file-session',
            stateRevision: revision,
            topologyRevision,
            controlsHierarchy: hierarchy(),
            ...extra,
        });
        let state = makeState(1, 1);
        const mutations = [];
        const onMutation = (event) => mutations.push(event.detail);
        document.addEventListener('rav:vm-control-mutated', onMutation);
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });
        const section = (key) => Array.from(elements.vmControlsTree.querySelectorAll('details.vm-section'))
            .find((candidate) => candidate.dataset.vmDisclosureKey === key);

        controller.renderVmInputControls();
        section('vm:<root>').open = true;
        section('vm:settings').open = true;
        section('list:rows').open = true;
        section('instance:rows/0').open = true;
        section('vm:rows/0/nested').open = true;

        elements.vmControlsTree.querySelector('[title="Fire"]')?.closest('.vm-control-row')
            ?.querySelector('button')?.click();
        expect(mutations).toEqual([expect.objectContaining({ action: 'fire', kind: 'trigger' })]);

        // Some runtimes increment topologyRevision with a full canonical
        // response after a trigger even though the actual tree is compatible.
        state = makeState(2, 2, {
            controlChanges: [{ key: 'vm:Fire:trigger', kind: 'trigger', receipt: 1 }],
        });
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));

        expect(section('vm:<root>').open).toBe(true);
        expect(section('vm:settings').open).toBe(true);
        expect(section('list:rows').open).toBe(true);
        expect(section('instance:rows/0').open).toBe(true);
        expect(section('vm:rows/0/nested').open).toBe(true);
        controller.stopVmControlSync();
        document.removeEventListener('rav:vm-control-mutated', onMutation);
    });

    it('does not leak disclosure state to an incompatible topology or replacement file session', () => {
        const elements = createElements();
        const hierarchy = ({ includeExtra = false } = {}) => ({
            children: [{
                children: [{
                    children: [{
                        children: [],
                        inputs: [{
                            descriptor: { kind: 'number', name: 'value', path: 'rows/0/value', source: 'view-model' },
                            kind: 'number', value: 1,
                        }],
                        kind: 'instance', label: 'Row 1', path: 'rows/0',
                    }],
                    inputs: includeExtra ? [{
                        descriptor: { kind: 'boolean', name: 'extra', path: 'extra', source: 'view-model' },
                        kind: 'boolean', value: false,
                    }] : [],
                    kind: 'list', label: 'rows [1]', path: 'rows',
                }],
                inputs: [],
                kind: 'vm', label: 'Root VM', path: '<root>',
            }],
            inputs: [], kind: 'controls', label: 'Controls', path: '<controls>',
        });
        const makeState = ({ sessionId, revision, topologyRevision, includeExtra = false }) => ({
            revision,
            sessionId,
            stateRevision: revision,
            topologyRevision,
            controlsHierarchy: hierarchy({ includeExtra }),
        });
        let state = makeState({ sessionId: 'file-a', revision: 1, topologyRevision: 1 });
        const controller = createVmControlsController({
            callbacks: { initLucideIcons: vi.fn() },
            documentRef: document,
            elements,
            getRenderSurfaceCanonicalState: () => state,
            isAuthoritativeChildMode: true,
        });
        const section = (key) => Array.from(elements.vmControlsTree.querySelectorAll('details.vm-section'))
            .find((candidate) => candidate.dataset.vmDisclosureKey === key);

        controller.renderVmInputControls();
        section('list:rows').open = true;
        section('instance:rows/0').open = true;

        state = makeState({
            sessionId: 'file-a', revision: 2, topologyRevision: 2, includeExtra: true,
        });
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));
        expect(section('list:rows').open).toBe(false);
        expect(section('instance:rows/0').open).toBe(false);

        section('list:rows').open = true;
        section('instance:rows/0').open = true;
        state = makeState({
            sessionId: 'file-b', revision: 1, topologyRevision: 1, includeExtra: true,
        });
        document.dispatchEvent(new CustomEvent('rav:render-surface-state', { detail: state }));
        expect(section('list:rows').open).toBe(false);
        expect(section('instance:rows/0').open).toBe(false);
        controller.stopVmControlSync();
    });
});
