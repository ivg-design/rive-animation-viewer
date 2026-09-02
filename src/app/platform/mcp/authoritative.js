const TAURI_MARKERS = ['__TAURI__', '__TAURI_INTERNALS__'];

function isTauriWindow(windowRef) {
    return TAURI_MARKERS.some((key) => Boolean(windowRef?.[key]));
}

function readController(windowRef, injectedController, getController) {
    if (typeof getController === 'function') {
        const controller = getController();
        if (controller) return controller;
    }
    if (typeof injectedController === 'function') {
        const controller = injectedController();
        if (controller) return controller;
    }
    if (injectedController) return injectedController;
    if (typeof windowRef?._mcpGetRenderSurfaceController === 'function') {
        return windowRef._mcpGetRenderSurfaceController();
    }
    return windowRef?._mcpRenderSurfaceController || null;
}

export function getAuthoritativeRenderSurface({ getRenderSurfaceController, windowRef = globalThis.window, renderSurfaceController } = {}) {
    const controller = readController(windowRef, renderSurfaceController, getRenderSurfaceController);
    if (!controller || typeof controller.requestCommand !== 'function') return null;
    const state = typeof controller.getState === 'function' ? controller.getState() : {};
    const canonicalState = typeof controller.getCanonicalState === 'function'
        ? controller.getCanonicalState()
        : state.canonicalState;
    // A staged-but-not-active surface must never become an MCP authority.
    if (!state?.activeSessionId || !state?.isLoaded || state.canAcceptCommands === false || !canonicalState) return null;
    return { controller, canonicalState, state };
}

export function assertAuthoritativeRenderSurface(options = {}) {
    const adapter = getAuthoritativeRenderSurface(options);
    if (adapter) return adapter;
    if (isTauriWindow(options.windowRef)) {
        throw new Error('Visible render surface canonical controller is unavailable; command not applied.');
    }
    return null;
}

function normalizeAuthoritativeResult(adapter, result) {
    const canonicalState = result?.canonicalState
        || (typeof adapter.controller.getCanonicalState === 'function'
            ? adapter.controller.getCanonicalState()
            : adapter.canonicalState);
    const status = result?.status || (result?.applied ? 'applied' : 'rejected');
    return {
        ...result,
        applied: result?.applied === true && status === 'applied',
        canonicalState,
        status,
    };
}

export async function requestAuthoritativeCommand(adapter, type, payload = {}, options = {}) {
    const result = await adapter.controller.requestCommand(type, payload, options);
    return normalizeAuthoritativeResult(adapter, result);
}

export async function requestAuthoritativeImageCommand(adapter, payload = {}, options = {}) {
    const result = typeof adapter.controller.requestImageCommand === 'function'
        ? await adapter.controller.requestImageCommand(payload, options)
        : await adapter.controller.requestCommand('vm-image-set', payload, options);
    return normalizeAuthoritativeResult(adapter, result);
}

export function canonicalInputs(canonicalState) {
    const inputs = [];
    function walk(node) {
        if (!node || typeof node !== 'object') return;
        (node.inputs || []).forEach((input) => {
            if (input && typeof input === 'object' && input.path) inputs.push(input);
        });
        (node.children || []).forEach(walk);
    }
    walk(canonicalState?.controlsHierarchy);
    return inputs;
}

function isGlobalInput(input) {
    const source = input?.source || input?.descriptor?.source;
    const name = input?.globalViewModelName || input?.descriptor?.globalViewModelName;
    return source === 'global-view-model' && typeof name === 'string';
}

function globalGroup(canonicalState) {
    const hierarchy = canonicalState?.controlsHierarchy;
    if (hierarchy?.kind === 'global-view-models') return hierarchy;
    return (hierarchy?.children || []).find((child) => child?.kind === 'global-view-models') || null;
}

export function canonicalVmSnapshot(canonicalState) {
    const inputs = canonicalInputs(canonicalState).filter((input) => !isGlobalInput(input));
    const paths = inputs.map((input) => input.path);
    const hierarchy = canonicalState?.controlsHierarchy || null;
    const hasGlobalGroup = Boolean(globalGroup(canonicalState));
    const tree = hasGlobalGroup
        ? { ...hierarchy, children: (hierarchy.children || []).filter((child) => child?.kind !== 'global-view-models') }
        : hierarchy;
    return {
        tree,
        paths,
        inputs,
        hasRoot: Boolean(tree),
        ...(tree ? {} : { message: 'No ViewModel instance is currently bound' }),
    };
}

export function canonicalGlobalVmSnapshot(canonicalState) {
    const group = globalGroup(canonicalState);
    const globalViewModels = (group?.children || []).map((tree) => {
        const name = tree.globalViewModelName || tree.label || '';
        const inputs = [];
        const walk = (node) => {
            (node?.inputs || []).forEach((input) => {
                const inputName = input?.globalViewModelName || input?.descriptor?.globalViewModelName;
                if (isGlobalInput(input) && inputName === name) inputs.push(input);
            });
            (node?.children || []).forEach(walk);
        };
        walk(tree);
        return { name, tree, paths: inputs.map((input) => input.path), inputs, hasRoot: Boolean(tree) };
    });
    return {
        count: globalViewModels.length,
        names: globalViewModels.map((entry) => entry.name),
        globalViewModels,
        ...(globalViewModels.length ? {} : { message: 'No global ViewModels are available' }),
    };
}

export function canonicalControlSnapshot(canonicalState) {
    return canonicalInputs(canonicalState)
        .filter((input) => input.kind !== 'trigger' && input.kind !== 'image')
        .map((input) => ({
            descriptor: {
                kind: input.kind,
                name: input.name,
                path: input.path,
                source: input.source || input.descriptor?.source || 'view-model',
                stateMachineName: input.stateMachineName || input.descriptor?.stateMachineName || null,
                globalViewModelName: input.globalViewModelName || input.descriptor?.globalViewModelName || null,
            },
            kind: input.kind,
            value: input.value,
        }));
}

export function findCanonicalInput(canonicalState, path, predicate = () => true) {
    return canonicalInputs(canonicalState).find((input) => !isGlobalInput(input) && input.path === path && predicate(input)) || null;
}

export function findCanonicalGlobalInput(canonicalState, globalViewModelName, path, predicate = () => true) {
    return canonicalInputs(canonicalState).find((input) => (
        isGlobalInput(input)
        && (input.globalViewModelName || input.descriptor?.globalViewModelName) === globalViewModelName
        && input.path === path
        && predicate(input)
    )) || null;
}

export function countCanonicalInputs(canonicalState) {
    return canonicalInputs(canonicalState).filter((input) => !isGlobalInput(input)).length;
}
