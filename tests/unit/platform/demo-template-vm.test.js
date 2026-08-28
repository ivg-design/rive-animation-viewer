import { readFileSync } from 'node:fs';
import path from 'node:path';

const templateRoot = path.resolve(process.cwd(), 'src-tauri/src/demo-template/js');
const readTemplateSource = (relativePath) => readFileSync(path.join(templateRoot, relativePath), 'utf8')
    .replace(/\r\n?/g, '\n');
const accessorsSource = readTemplateSource('vm/accessors.js');
const resetContractSource = readTemplateSource('vm/reset-contract.js');
const imageValidationSource = readTemplateSource('vm/image/validation.js');
const imageResetSource = readTemplateSource('vm/image-reset.js');
const canonicalStateSource = readTemplateSource('vm/canonical-state.js');
const canonicalPublicationSource = readTemplateSource('vm/canonical-publication.js');
const hierarchySource = readTemplateSource('vm/hierarchy.js');
const topologyWatchSource = readTemplateSource('vm/topology-watch.js');
const timelineStateSource = readTemplateSource('vm/timeline-state.js');
const preambleSource = readTemplateSource('core/preamble.js');
const firstFrameSource = readTemplateSource('core/load/first-frame.js');
const riveLoaderSource = readTemplateSource('core/rive-loader.js');
const editorConfigSource = readTemplateSource('core/editor-config.js');
const controlsRenderSource = readTemplateSource('vm/controls-render.js');
const syncSource = readTemplateSource('vm/sync.js');
const bootstrapSource = readTemplateSource('core/bootstrap.js');
const renderSurfaceBridgeSource = readTemplateSource('core/render-surface-bridge.js');
const renderSurfaceLoadDiagnosticsSource = readTemplateSource('vm/image/load-diagnostics.js');
const overlayStyles = readFileSync(path.resolve(process.cwd(), 'src-tauri/src/demo-template/css/overlays.css'), 'utf8');

describe('render surface pointer relay', () => {
    it('reports passive pointerdown without consuming the Rive interaction', () => {
        expect(renderSurfaceBridgeSource).toContain("emitToMain('render-surface:pointerdown'");
        expect(renderSurfaceBridgeSource).toContain('{ capture: true, passive: true }');
        const relay = renderSurfaceBridgeSource.slice(
            renderSurfaceBridgeSource.indexOf("document.addEventListener('pointerdown'"),
            renderSurfaceBridgeSource.indexOf("reportBridgeProbe(eventApi.listen"),
        );
        expect(relay).not.toContain('preventDefault');
        expect(relay).not.toContain('stopPropagation');
    });
});

function validPngBytes(tag = 0, width = 1, height = 1) {
    return [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
        (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
        tag & 0xff,
    ];
}

function createDemoVmHarness(riveInstance, {
    controlSelectionKeys = null,
    controlSnapshot = [],
    deferCanonicalUntilActivation = false,
    imageRuntime = null,
    renderSurfaceMode = false,
    vmHierarchy = null,
} = {}) {
    delete window.__ravRenderSurfaceCanonical;
    window.__ravRenderSurfaceTarget = {};
    if (deferCanonicalUntilActivation) window.__ravRenderSurfaceDefersCanonical = true;
    else delete window.__ravRenderSurfaceDefersCanonical;
    const emitted = [];
    window.__ravRenderSurfaceEmit = (event, payload) => emitted.push({ event, payload });
    const build = new Function('riveInstance', 'CONTROL_SELECTION_KEYS', 'CONTROL_SNAPSHOT', 'VM_HIERARCHY', 'IS_RENDER_SURFACE_MODE', 'IMAGE_RUNTIME', `
        const CONFIG = { artboardName: null, viewModelInstanceName: null };
        const isRenderSurfaceMode = IS_RENDER_SURFACE_MODE;
        const VM_CONTROL_SYNC_INTERVAL_MS = 120;
        const VM_TOPOLOGY_SYNC_INTERVAL_MS = 1000;
        const VM_CONTROL_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color', 'image', 'trigger']);
        let vmControlBindings = [];
        let vmControlSyncTimer = null;
        let vmListTopologySignature = null;
        let pendingControlSnapshot = new Map();
        let renderSurfaceImageSnapshot = new Map();
        let renderSurfaceAdvanceRevision = 0;
        let loadedRiveRuntime = IMAGE_RUNTIME;
        let topologyRenderCount = 0;
        let renderedHierarchy = null;
        function controlSnapshotKeyForDescriptor(descriptor) {
            if (!descriptor) return null;
            if (descriptor.source === 'state-machine') {
                return 'sm:' + (descriptor.stateMachineName || '') + ':' + (descriptor.name || '') + ':' + (descriptor.kind || '');
            }
            return 'vm:' + (descriptor.path || '') + ':' + (descriptor.kind || '');
        }
        function controlSelectionKeyForDescriptor(descriptor) {
            if (!descriptor) return null;
            if (descriptor.source === 'state-machine') return controlSnapshotKeyForDescriptor(descriptor);
            return normalizeControlSelectionKey(controlSnapshotKeyForDescriptor(descriptor));
        }
        function normalizeControlSelectionKey(key) {
            if (typeof key !== 'string') return null;
            const trimmed = key.trim();
            if (!trimmed.startsWith('vm:')) return trimmed || null;
            const kindSeparator = trimmed.lastIndexOf(':');
            if (kindSeparator <= 3) return trimmed || null;
            const path = trimmed.slice(3, kindSeparator)
                .split('/')
                .map((segment) => /^(0|[1-9]\\d*)$/.test(segment) ? '*' : segment)
                .join('/');
            return 'vm:' + path + ':' + trimmed.slice(kindSeparator + 1);
        }
        function countHierarchyInputs(node) {
            if (!node) return 0;
            let total = Array.isArray(node.inputs) ? node.inputs.length : 0;
            (node.children || []).forEach((child) => {
                total += countHierarchyInputs(child);
            });
            return total;
        }
        const ALLOWED_CONTROL_KEYS = new Set(
            (CONTROL_SELECTION_KEYS || CONTROL_SNAPSHOT
                .map((entry) => controlSelectionKeyForDescriptor(entry?.descriptor || entry)))
                .map((key) => normalizeControlSelectionKey(key))
                .filter(Boolean)
        );
        ${accessorsSource}
        ${imageValidationSource}
        ${imageResetSource}
        ${hierarchySource}
        ${topologyWatchSource}
        ${timelineStateSource}
        ${canonicalStateSource}
        ${canonicalPublicationSource}
        function renderVmControls() {
            topologyRenderCount += 1;
            const rootVm = resolveVmRootInstance();
            vmListTopologySignature = buildVmListTopologySignature(rootVm);
            renderedHierarchy = filterHierarchyNode(buildVmHierarchy(rootVm));
        }
        ${syncSource}
        return {
            applyControlSnapshot,
            applyRenderSurfaceImageCommand,
            bindViewModelInstanceByKey,
            buildVmHierarchy,
            captureRenderSurfacePlayback,
            captureRenderSurfaceCommandCanonicalDelta,
            captureChangedRenderSurfaceControls,
            filterHierarchyNode,
            formatVmListItemLabel,
            getRenderSurfaceObserverDiagnostics,
            initializeTopology: () => {
                vmListTopologySignature = buildVmListTopologySignature(resolveVmRootInstance());
                return vmListTopologySignature;
            },
            invalidateRenderSurfaceCanonicalBindingsForReset,
            retryPendingControlSnapshot,
            syncVmControlTopology,
            pendingCount: () => pendingControlSnapshot.size,
            observeRenderSurfaceControlBudget: (budget) => observeRenderSurfaceControlBudget(getRenderSurfaceBridgeState(), budget),
            publishRenderSurfaceCanonicalState,
            recordRenderSurfaceTimelinePlay,
            recordRenderSurfaceTimelineAdvance,
            recordRenderSurfaceTimelineStop,
            recordRenderSurfaceTriggerReceipt,
            readAcknowledgedRenderSurfaceImagePresence,
            readAcknowledgedRenderSurfaceImageMetadata,
            advanceRenderer: () => { renderSurfaceAdvanceRevision += 1; },
            waitForRenderSurfaceImagePresentation,
            restoreRenderSurfaceImageSnapshot,
            scheduleRenderSurfaceCanonicalRefresh,
            scheduleRenderSurfaceInitialCanonicalState,
            setRenderSurfaceTarget: setRenderSurfacePlaybackTarget,
            renderedHierarchy: () => renderedHierarchy,
            topologyRenderCount: () => topologyRenderCount,
        };
    `);
    return { ...build(riveInstance, controlSelectionKeys, controlSnapshot, vmHierarchy, renderSurfaceMode, imageRuntime), emitted };
}

async function withImmediateAnimationFrames(task) {
    const previousRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
        queueMicrotask(callback);
        return 1;
    };
    try {
        return await task();
    } finally {
        if (typeof previousRaf === 'function') window.requestAnimationFrame = previousRaf;
        else delete window.requestAnimationFrame;
    }
}

async function withRendererAdvance(harness, task) {
    const previousRaf = window.requestAnimationFrame;
    const frames = [];
    window.requestAnimationFrame = (callback) => {
        frames.push(callback);
        return frames.length;
    };
    try {
        const pending = task();
        let settled = false;
        let rejected = null;
        let result;
        pending.then((value) => { settled = true; result = value; }, (error) => { settled = true; rejected = error; });
        for (let cycle = 0; cycle < 64 && !settled; cycle += 1) {
            await Promise.resolve();
            if (!frames.length) continue;
            frames.shift()();
            harness.advanceRenderer();
        }
        if (!settled) throw new Error('Image task did not settle after renderer advances.');
        if (rejected) throw rejected;
        return result;
    } finally {
        if (typeof previousRaf === 'function') window.requestAnimationFrame = previousRaf;
        else delete window.requestAnimationFrame;
    }
}

async function settleImageTaskWithRendererAdvance({ advanceRenderer, frames, task }) {
    const pending = task();
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.length).toBeGreaterThan(0);
    frames.shift()();
    await Promise.resolve();
    advanceRenderer();
    expect(frames.length).toBeGreaterThan(0);
    frames.shift()();
    await Promise.resolve();
    expect(frames.length).toBeGreaterThan(0);
    frames.shift()();
    return pending;
}

function createEmbeddedImageAssetHarness() {
    const start = preambleSource.indexOf('        let loadedRiveRuntime');
    const end = preambleSource.indexOf('        /* ── DOM references', start);
    const source = preambleSource.slice(start, end);
    return new Function(`${source}; return {
        composeEmbeddedImageAssetLoader,
        getEmbeddedImageAssets,
        resetEmbeddedImageAssets,
    };`)();
}

function createHierarchyInput(path, kind = 'string') {
    const name = path.split('/').pop();
    return {
        descriptor: { kind, name, path },
        kind,
        name,
        path,
    };
}

function createExportHierarchy(rowCount) {
    return {
        children: [{
            children: Array.from({ length: rowCount }, (_, index) => ({
                children: [],
                inputs: [createHierarchyInput(`rows/${index}/playerName`)],
                kind: 'instance',
                label: `Row ${index + 1}`,
                path: `rows/${index}`,
            })),
            inputs: [],
            kind: 'list',
            label: `rows [${rowCount}]`,
            path: 'rows',
        }],
        inputs: [
            createHierarchyInput('scrollScale', 'number'),
            createHierarchyInput('featureRank', 'number'),
            createHierarchyInput('playerCount', 'number'),
            createHierarchyInput('showPlayer', 'trigger'),
            createHierarchyInput('focusIndex', 'number'),
        ],
        kind: 'vm',
        label: 'LeaderboardVM',
        path: '<root>',
    };
}

function stripHierarchyDescriptors(node) {
    return {
        ...node,
        children: (node.children || []).map(stripHierarchyDescriptors),
        inputs: (node.inputs || []).map(({ descriptor: _descriptor, ...input }) => input),
    };
}

describe('exported demo ViewModel snapshot runtime', () => {
    it.each([
        ['named', 'Board', 'Board', false],
        ['runtime list index', 0, 0, false],
        ['auto', '__rav_auto_bound__', null, true],
    ])('uses the same child reset contract for %s instance selection', (
        _label,
        instanceKey,
        expectedKey,
        expectedAutoBind,
    ) => {
        const helpers = new Function(`${resetContractSource}; return { buildRenderSurfaceResetContract };`)();
        const reset = helpers.buildRenderSurfaceResetContract({
            animations: 'Timeline',
            artboard: 'Main',
            autoBind: true,
            viewModelInstanceName: instanceKey,
        });

        expect(reset.params).toEqual(expect.objectContaining({
            animations: 'Timeline',
            artboard: 'Main',
            autoBind: expectedAutoBind,
            viewModelInstanceName: expectedKey,
        }));
        expect(reset.target.vmInstanceKey).toBe(expectedKey);
    });

    it.each([
        ['an explicit timeline', { animations: 'Timeline', autoplay: true }, 'Timeline'],
        ['an explicit state machine', { stateMachines: 'Machine', autoplay: true }, 'Machine'],
        ['multiple targets', { animations: ['Intro', 'Loop'], stateMachines: 'Machine', autoplay: true }, ['Intro', 'Loop', 'Machine']],
        ['the runtime-selected target', { autoplay: true }, undefined],
    ])('restarts %s in place after reset', (_label, params, expectedPlayTarget) => {
        const helpers = new Function(`${resetContractSource}; return { restartRenderSurfacePlaybackAfterReset };`)();
        const runtime = { play: vi.fn(), startRendering: vi.fn() };

        expect(helpers.restartRenderSurfacePlaybackAfterReset(runtime, params)).toEqual({
            names: expectedPlayTarget === undefined
                ? []
                : (Array.isArray(expectedPlayTarget) ? expectedPlayTarget : [expectedPlayTarget]),
            restarted: true,
        });
        expect(runtime.startRendering).toHaveBeenCalledTimes(1);
        expect(runtime.play).not.toHaveBeenCalled();
    });

    it('falls back to replaying the exact reset target when startRendering is unavailable', () => {
        const helpers = new Function(`${resetContractSource}; return { restartRenderSurfacePlaybackAfterReset };`)();
        const runtime = { play: vi.fn() };

        expect(helpers.restartRenderSurfacePlaybackAfterReset(runtime, {
            animations: 'Timeline',
            autoplay: true,
        })).toEqual({ names: ['Timeline'], restarted: true });
        expect(runtime.play).toHaveBeenCalledWith('Timeline');
    });

    it('does not restart playback when the reset contract disables autoplay', () => {
        const helpers = new Function(`${resetContractSource}; return { restartRenderSurfacePlaybackAfterReset };`)();
        const runtime = { play: vi.fn(), startRendering: vi.fn() };

        expect(helpers.restartRenderSurfacePlaybackAfterReset(runtime, {
            animations: 'Timeline',
            autoplay: false,
        })).toEqual({ names: [], restarted: false });
        expect(runtime.play).not.toHaveBeenCalled();
    });

    it('keeps image commands in the authoritative child through reset acknowledgement', () => {
        expect(preambleSource).toContain('let renderSurfaceImageSnapshot = new Map();');
        expect(imageResetSource).toContain('rememberRenderSurfaceImageCommand(imageDescriptor);');
        expect(imageResetSource).toContain('restoreRenderSurfaceImageSnapshot({ pruneFailures: false })');
        expect(imageResetSource).toContain('restoreRenderSurfaceImageSnapshot({ pruneFailures: true })');
        expect(bootstrapSource).toContain('settleRenderSurfaceResetAfterPresentation(pendingRenderSurfaceReset);');
        expect(riveLoaderSource).not.toContain('settleRenderSurfaceResetAfterLoad');
        expect(riveLoaderSource).toContain('var resetTransactionPending = isRenderSurfaceMode && Boolean(pendingRenderSurfaceReset);');
        expect(riveLoaderSource.indexOf('if (!resetTransactionPending) {\n                        applyControlSnapshot(currentControlSnapshot);'))
            .toBeGreaterThan(0);
        expect(imageResetSource).toContain('function settleRenderSurfaceResetAfterPresentation');
        const presentationStart = imageResetSource.indexOf('function settleRenderSurfaceResetAfterPresentation');
        expect(imageResetSource.indexOf('applyControlSnapshot(resetSnapshot);', presentationStart))
            .toBeLessThan(imageResetSource.indexOf('return restoreRenderSurfaceImageSnapshot({ pruneFailures: false });', presentationStart));
        expect(imageResetSource.indexOf('return restoreRenderSurfaceImageSnapshot({ pruneFailures: false });', presentationStart))
            .toBeLessThan(imageResetSource.indexOf('restartRenderSurfacePlaybackAfterReset(', presentationStart));
        expect(imageResetSource.indexOf('restartRenderSurfacePlaybackAfterReset(', presentationStart))
            .toBeLessThan(imageResetSource.indexOf('pendingReset.resolve({'));
        expect(bootstrapSource).toContain('return applyRenderSurfaceImageCommand(imageDescriptor, true);');
    });

    it('replays child-owned image set and clear state before a reset can acknowledge', async () => {
        const avatar = { value: null };
        const decodedImages = [];
        const imageFrames = [];
        const helpers = new Function('resolveLiveAccessor', 'loadedRiveRuntime', 'riveInstance', 'window', 'publishRenderSurfaceCanonicalState', 'pendingControlSnapshot', `
            let renderSurfaceImageSnapshot = new Map();
            let renderSurfaceAdvanceRevision = 0;
            ${imageValidationSource}
            ${imageResetSource}
            return {
                applyRenderSurfaceImageCommand,
                advanceRenderer: () => { renderSurfaceAdvanceRevision += 1; },
                restoreRenderSurfaceImageSnapshot,
                settleRenderSurfaceResetAfterPresentation,
            };
        `)(
            (path, kind) => path === 'avatar' && kind === 'image' ? avatar : null,
            {
                decodeImage: vi.fn(async (bytes) => {
                    const image = { bytes: Array.from(bytes), unref: vi.fn() };
                    decodedImages.push(image);
                    return image;
                }),
            },
            { startRendering: vi.fn() },
            {
                requestAnimationFrame: (callback) => { imageFrames.push(callback); return imageFrames.length; },
                clearTimeout: vi.fn(),
                setTimeout: () => 1,
            },
            vi.fn(),
            new Map(),
        );

        const imageBytes = validPngBytes(1);
        await settleImageTaskWithRendererAdvance({
            advanceRenderer: helpers.advanceRenderer,
            frames: imageFrames,
            task: () => helpers.applyRenderSurfaceImageCommand({ path: 'avatar', value: imageBytes }, true),
        });
        expect(avatar.value).toBe(decodedImages[0]);
        avatar.value = null; // The runtime reset has recreated the accessor value.
        await settleImageTaskWithRendererAdvance({
            advanceRenderer: helpers.advanceRenderer,
            frames: imageFrames,
            task: () => helpers.restoreRenderSurfaceImageSnapshot(),
        });
        expect(avatar.value).toBe(decodedImages[1]);
        expect(decodedImages[1].bytes).toEqual(imageBytes);

        await settleImageTaskWithRendererAdvance({
            advanceRenderer: helpers.advanceRenderer,
            frames: imageFrames,
            task: () => helpers.applyRenderSurfaceImageCommand({ action: 'clear-image', path: 'avatar', value: null }, true),
        });
        avatar.value = { stale: true };
        await settleImageTaskWithRendererAdvance({
            advanceRenderer: helpers.advanceRenderer,
            frames: imageFrames,
            task: () => helpers.restoreRenderSurfaceImageSnapshot(),
        });
        expect(avatar.value).toBeNull();
    });

    it('prunes a missing list image and still restores later valid journal entries', async () => {
        const rows = [{
            image: (name) => name === 'avatar' ? { value: null } : null,
            properties: [{ name: 'avatar' }],
        }];
        const hero = { value: null };
        const root = {
            list: (name) => name === 'rows' ? {
                get length() { return rows.length; },
                instanceAt: (index) => rows[index] || null,
            } : null,
            image: (name) => name === 'hero' ? hero : null,
            properties: [{ name: 'rows' }, { name: 'hero' }],
        };
        const runtime = {
            decodeImage: vi.fn(async (bytes) => ({ bytes: [...bytes], unref: vi.fn() })),
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
            imageRuntime: runtime,
            renderSurfaceMode: true,
        });
        const staleDescriptor = { kind: 'image', name: 'avatar', path: 'rows/0/avatar', source: 'view-model' };
        const validDescriptor = { kind: 'image', name: 'hero', path: 'hero', source: 'view-model' };

        const staleBytes = validPngBytes(1);
        const validBytes = validPngBytes(2);
        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({ ...staleDescriptor, value: staleBytes }, true));
        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({ ...validDescriptor, value: validBytes }, true));
        rows.length = 0;
        await withRendererAdvance(harness, () => harness.restoreRenderSurfaceImageSnapshot());

        expect(hero.value.bytes).toEqual(validBytes);
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(staleDescriptor)).toBeNull();
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(validDescriptor)).toBe(true);
    });

    it('prunes decode and apply failures while continuing to restore later images', async () => {
        let rejectApply = false;
        let badApplyValue = null;
        const images = {
            badDecode: { value: null },
            badApply: {
                set value(next) {
                    if (rejectApply) throw new Error('image apply failed');
                    badApplyValue = next;
                },
                get value() { return badApplyValue; },
            },
            good: { value: null },
        };
        const root = {
            image: (name) => images[name] || null,
            properties: Object.keys(images).map((name) => ({ name })),
        };
        const decodeImage = vi.fn()
            .mockResolvedValueOnce({ bytes: [1], unref: vi.fn() })
            .mockResolvedValueOnce({ bytes: [2], unref: vi.fn() })
            .mockResolvedValueOnce({ bytes: [3], unref: vi.fn() })
            .mockRejectedValueOnce(new Error('image decode failed'))
            .mockResolvedValueOnce({ bytes: [2], unref: vi.fn() })
            .mockResolvedValueOnce({ bytes: [3], unref: vi.fn() });
        const descriptors = Object.keys(images).map((name) => ({
            kind: 'image',
            name,
            path: name,
            source: 'view-model',
        }));
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
            imageRuntime: { decodeImage },
            renderSurfaceMode: true,
        });

        for (const [index, descriptor] of descriptors.entries()) {
            await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
                ...descriptor,
                value: validPngBytes(index + 1),
            }, true));
        }
        rejectApply = true;
        images.badDecode.value = null;
        badApplyValue = null;
        images.good.value = null;
        await withRendererAdvance(harness, () => harness.restoreRenderSurfaceImageSnapshot());

        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptors[0])).toBeNull();
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptors[1])).toBeNull();
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptors[2])).toBe(true);
        expect(images.good.value.bytes).toEqual([3]);
        expect(decodeImage).toHaveBeenCalledTimes(6);
    });

    it('settles an in-place reset from the child presentation barrier without waiting for onLoad', async () => {
        const presentationFrames = [];
        const published = vi.fn(() => ({ stateRevision: 42 }));
        const appliedSnapshots = [];
        const restoredValues = { enabled: false };
        const retries = vi.fn(() => 0);
        const resolved = vi.fn();
        const runtime = { play: vi.fn(), startRendering: vi.fn() };
        const helpers = new Function('window', 'publishRenderSurfaceCanonicalState', 'applyControlSnapshot', 'retryPendingControlSnapshot', 'riveInstance', `
            let currentControlSnapshot = [];
            let pendingControlSnapshot = new Map();
            let pendingRenderSurfaceReset = null;
            let renderSurfaceImageSnapshot = new Map();
            let renderSurfaceAdvanceRevision = 0;
            ${resetContractSource}
            ${imageValidationSource}
            ${imageResetSource}
            return {
                pending: () => pendingRenderSurfaceReset,
                setPending: (pending) => { pendingRenderSurfaceReset = pending; },
                settleRenderSurfaceResetAfterPresentation,
            };
        `)(
            {
                requestAnimationFrame: (callback) => {
                    presentationFrames.push(callback);
                    return presentationFrames.length;
                },
                setTimeout: (callback) => callback(),
            },
            published,
            (snapshot) => {
                appliedSnapshots.push(snapshot);
                restoredValues.enabled = snapshot[0]?.value;
            },
            retries,
            runtime,
        );
        const resetSnapshot = [{ descriptor: { kind: 'boolean', path: 'enabled' }, kind: 'boolean', value: true }];
        const pendingReset = {
            params: { animations: 'Timeline', autoplay: true },
            resolve: resolved,
            snapshot: resetSnapshot,
        };
        helpers.setPending(pendingReset);

        helpers.settleRenderSurfaceResetAfterPresentation(pendingReset);
        helpers.settleRenderSurfaceResetAfterPresentation(pendingReset);
        // The image restoration chain deliberately crosses several promise
        // boundaries; drain them without relying on host timers.
        for (let microtask = 0; microtask < 6; microtask += 1) {
            await Promise.resolve();
        }
        expect(appliedSnapshots).toEqual([resetSnapshot]);
        expect(restoredValues.enabled).toBe(true);
        expect(runtime.startRendering).toHaveBeenCalledTimes(1);
        expect(runtime.play).not.toHaveBeenCalled();
        expect(presentationFrames).toHaveLength(1);
        expect(resolved).not.toHaveBeenCalled();

        presentationFrames.shift()();
        expect(presentationFrames).toHaveLength(1);
        presentationFrames.shift()();
        for (let microtask = 0; microtask < 12; microtask += 1) await Promise.resolve();

        expect(retries).toHaveBeenCalledTimes(1);
        expect(published).not.toHaveBeenCalled();
        expect(resolved).toHaveBeenCalledWith(expect.objectContaining({
            pending: 0,
            playbackRestart: { names: ['Timeline'], restarted: true },
            presentationFrames: 2,
            reset: true,
            restored: 1,
        }));
        expect(renderSurfaceBridgeSource).toContain("commandType === 'reset'");
        expect(renderSurfaceBridgeSource).toContain("scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true)");
    });

    it('rejects reset restoration with unresolved runtime-list rows and clears their stale snapshot', async () => {
        const presentationFrames = [];
        const rejected = vi.fn();
        const runtime = { play: vi.fn(), startRendering: vi.fn() };
        const helpers = new Function('window', 'riveInstance', `
            let currentControlSnapshot = [];
            let pendingControlSnapshot = new Map();
            let pendingRenderSurfaceReset = null;
            let renderSurfaceImageSnapshot = new Map();
            let renderSurfaceAdvanceRevision = 0;
            let runtimeRowAvailable = false;
            let staleValueApplied = false;
            function applyControlSnapshot(snapshot) {
                pendingControlSnapshot.set('vm:rows/0/title:string', snapshot[0]);
                return 0;
            }
            function retryPendingControlSnapshot() {
                if (runtimeRowAvailable && pendingControlSnapshot.has('vm:rows/0/title:string')) {
                    staleValueApplied = true;
                    pendingControlSnapshot.delete('vm:rows/0/title:string');
                    return 1;
                }
                return 0;
            }
            ${resetContractSource}
            ${imageValidationSource}
            ${imageResetSource}
            return {
                pendingCount: () => pendingControlSnapshot.size,
                retry: retryPendingControlSnapshot,
                setPending: (pending) => { pendingRenderSurfaceReset = pending; },
                setRuntimeRowAvailable: (value) => { runtimeRowAvailable = value; },
                settleRenderSurfaceResetAfterPresentation,
                staleValueApplied: () => staleValueApplied,
            };
        `)(
            {
                requestAnimationFrame: (callback) => {
                    presentationFrames.push(callback);
                    return presentationFrames.length;
                },
                setTimeout: (callback) => callback(),
            },
            runtime,
        );
        const pendingReset = {
            params: { animations: 'Timeline', autoplay: true },
            reject: rejected,
            resolve: vi.fn(),
            snapshot: [{ descriptor: { kind: 'string', path: 'rows/0/title' }, kind: 'string', value: 'old row' }],
        };
        helpers.setPending(pendingReset);

        helpers.settleRenderSurfaceResetAfterPresentation(pendingReset);
        for (let microtask = 0; microtask < 6; microtask += 1) await Promise.resolve();
        presentationFrames.shift()();
        presentationFrames.shift()();
        for (let microtask = 0; microtask < 6; microtask += 1) await Promise.resolve();

        expect(rejected).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Playback reset could not restore 1 control value.',
        }));
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        expect(helpers.pendingCount()).toBe(0);

        helpers.setRuntimeRowAvailable(true);
        expect(helpers.retry()).toBe(0);
        expect(helpers.staleValueApplied()).toBe(false);
    });

    it('restores a runtime-generated list image that appears after reset starts advancing', async () => {
        const presentationFrames = [];
        const rows = [];
        const decoded = [];
        const createRow = () => {
            const imageAccessor = { value: null };
            return {
                image: (name) => name === 'avatar' ? imageAccessor : null,
                imageAccessor,
                properties: [{ name: 'avatar' }],
            };
        };
        const runtime = {
            decodeImage: vi.fn(async (bytes) => {
                const image = { bytes: [...bytes], unref: vi.fn() };
                decoded.push(image);
                return image;
            }),
            startRendering: vi.fn(() => {
                if (!rows.length) rows.push(createRow());
            }),
        };
        const helpers = new Function('window', 'resolveLiveAccessor', 'loadedRiveRuntime', 'riveInstance', `
            let currentControlSnapshot = [];
            let pendingControlSnapshot = new Map();
            let pendingRenderSurfaceReset = null;
            let renderSurfaceImageSnapshot = new Map();
            let renderSurfaceAdvanceRevision = 0;
            function applyControlSnapshot() { return 0; }
            function retryPendingControlSnapshot() { return 0; }
            ${resetContractSource}
            ${imageValidationSource}
            ${imageResetSource}
            return {
                applyRenderSurfaceImageCommand,
                advanceRenderer: () => { renderSurfaceAdvanceRevision += 1; },
                readAcknowledgedRenderSurfaceImagePresence,
                setPending: (pending) => { pendingRenderSurfaceReset = pending; },
                settleRenderSurfaceResetAfterPresentation,
            };
        `)(
            {
                requestAnimationFrame: (callback) => {
                    presentationFrames.push(callback);
                    return presentationFrames.length;
                },
                clearTimeout: vi.fn(),
                setTimeout: () => 1,
            },
            (path, kind) => kind === 'image' && path === 'rows/0/avatar'
                ? rows[0]?.imageAccessor || null
                : null,
            runtime,
            runtime,
        );
        const descriptor = {
            kind: 'image',
            name: 'avatar',
            path: 'rows/0/avatar',
            source: 'view-model',
        };

        rows.push(createRow());
        const listImageBytes = validPngBytes(4);
        const initialImageApply = helpers.applyRenderSurfaceImageCommand({ ...descriptor, value: listImageBytes }, true);
        await Promise.resolve();
        presentationFrames.shift()();
        await Promise.resolve();
        helpers.advanceRenderer();
        presentationFrames.shift()();
        await Promise.resolve();
        presentationFrames.shift()();
        await initialImageApply;
        rows.length = 0;

        const pendingReset = {
            params: { animations: 'Timeline', autoplay: true },
            reject: vi.fn(),
            resolve: vi.fn(),
            snapshot: [],
        };
        helpers.setPending(pendingReset);
        helpers.settleRenderSurfaceResetAfterPresentation(pendingReset);
        // Reset restoration first crosses its two-frame barrier; only then
        // does playback restart create the runtime-generated row.
        await vi.waitFor(() => expect(presentationFrames.length).toBeGreaterThan(0));
        presentationFrames.shift()();
        await Promise.resolve();
        await vi.waitFor(() => expect(presentationFrames.length).toBeGreaterThan(0));
        presentationFrames.shift()();
        await vi.waitFor(() => expect(runtime.startRendering).toHaveBeenCalledTimes(3));

        expect(rows).toHaveLength(1);
        expect(rows[0].imageAccessor.value?.bytes).toEqual(listImageBytes);
        expect(helpers.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBe(true);

        // The list-image retry must observe a real renderer advance and then
        // cross its post-advance compositor frame before reset can resolve.
        for (let frame = 0; frame < 3; frame += 1) {
            await vi.waitFor(() => expect(presentationFrames.length).toBeGreaterThan(0));
            presentationFrames.shift()();
            if (frame === 0) helpers.advanceRenderer();
            await Promise.resolve();
        }
        for (let microtask = 0; microtask < 8; microtask += 1) await Promise.resolve();

        expect(pendingReset.reject).not.toHaveBeenCalled();
        expect(pendingReset.resolve).toHaveBeenCalledWith(expect.objectContaining({ reset: true }));
        expect(rows[0].imageAccessor.value.bytes).toEqual(listImageBytes);
        expect(decoded).toHaveLength(2);
    });

    it.each([
        ['a named instance', 'Board'],
        ['runtime-list index zero', 0],
    ])('rebinds %s immediately after reset before starting snapshot restoration', async (_label, instanceKey) => {
        const resetStart = bootstrapSource.indexOf('        function resetRenderSurfaceAndWait');
        const resetEnd = bootstrapSource.indexOf('        function handleRenderSurfaceCommand', resetStart);
        const settle = vi.fn();
        const bindViewModelInstanceByKey = vi.fn(() => true);
        const order = [];
        const resetPlaybackChips = vi.fn(() => order.push('fps-reset'));
        const timeouts = [];
        const runtime = { reset: vi.fn(() => order.push('runtime-reset')) };
        const helpers = new Function('riveInstance', 'window', 'settleRenderSurfaceResetAfterPresentation', 'bindViewModelInstanceByKey', 'resetPlaybackChips', `
            let pendingRenderSurfaceReset = null;
            let currentControlSnapshot = [];
            ${bootstrapSource.slice(resetStart, resetEnd)}
            return {
                pending: () => pendingRenderSurfaceReset,
                resetRenderSurfaceAndWait,
            };
        `)(
            runtime,
            {
                clearTimeout: vi.fn(),
                setTimeout: (callback, delay) => {
                    timeouts.push({ callback, delay });
                    return timeouts.length;
                },
            },
            settle,
            bindViewModelInstanceByKey,
            resetPlaybackChips,
        );
        const params = { artboard: 'Main', autoplay: true, viewModelInstanceName: instanceKey };
        const snapshot = [{ descriptor: { kind: 'number', path: 'value' }, kind: 'number', value: 7 }];
        const reset = helpers.resetRenderSurfaceAndWait(params, snapshot);

        expect(resetPlaybackChips).toHaveBeenCalledOnce();
        expect(order).toEqual(['fps-reset', 'runtime-reset']);
        expect(runtime.reset).toHaveBeenCalledWith(params);
        expect(bindViewModelInstanceByKey).toHaveBeenCalledWith(runtime, instanceKey);
        expect(settle).toHaveBeenCalledWith(helpers.pending());
        expect(helpers.pending()).toEqual(expect.objectContaining({
            binding: { applied: true, key: instanceKey, requested: true },
            params,
            presentationScheduled: false,
            snapshot,
        }));
        expect(timeouts).toHaveLength(1);

        helpers.pending().resolve({ reset: true });
        await expect(reset).resolves.toEqual({ reset: true });
    });

    it('keeps the render-surface bridge dormant for normal exports and uses existing control resolvers', () => {
        expect(preambleSource).toContain("get('renderSurface') === '1'");
        expect(renderSurfaceBridgeSource).toContain("events.listen('render-surface:command'");
        expect(renderSurfaceBridgeSource).toContain("emitToMain('render-surface:ready'");
        expect(renderSurfaceBridgeSource).toContain('events.emit(eventName, eventPayload)');
        expect(renderSurfaceBridgeSource).toContain('if (parentReadyAcknowledged) return;');
        expect(bootstrapSource).toContain('resolveLiveAccessor(vmDescriptor.path, vmKind)');
        expect(bootstrapSource).toContain('resolveStateMachineInputAccessor(smDescriptor.stateMachineName, smDescriptor.name, smKind)');
        expect(bootstrapSource).toContain("type === 'snapshot'");
        expect(overlayStyles).toContain('body.render-surface-mode #canvas-container');
        expect(riveLoaderSource).toContain('if (!isRenderSurfaceMode) renderVmControls();');
    });

    it('applies scalar values from both nested MCP and flat UI command payloads', () => {
        const helperStart = bootstrapSource.indexOf('        function setRenderSurfaceAccessorValue');
        const helperEnd = bootstrapSource.indexOf('        function resetRenderSurfaceAndWait', helperStart);
        const helpers = new Function(`${bootstrapSource.slice(helperStart, helperEnd)}; return {
            renderSurfaceImageCommand,
            renderSurfaceCommandValue,
            setRenderSurfaceAccessorValue,
        };`)();
        const accessor = { value: false };

        const nestedDescriptor = { kind: 'boolean', path: 'enabled' };
        helpers.setRenderSurfaceAccessorValue(
            accessor,
            'boolean',
            helpers.renderSurfaceCommandValue({ descriptor: nestedDescriptor, value: true }, nestedDescriptor),
        );
        expect(accessor.value).toBe(true);

        const flatDescriptor = { kind: 'number', path: 'speed', value: 7 };
        helpers.setRenderSurfaceAccessorValue(
            accessor,
            'number',
            helpers.renderSurfaceCommandValue(flatDescriptor, flatDescriptor),
        );
        expect(accessor.value).toBe(7);

        expect(helpers.renderSurfaceImageCommand({
            action: 'set-image',
            descriptor: { kind: 'image', path: 'avatar' },
            value: [1, 2, 3],
        })).toEqual({ action: 'set-image', kind: 'image', path: 'avatar', value: [1, 2, 3] });

        expect(bootstrapSource).toContain(
            'setRenderSurfaceAccessorValue(vmAccessor, vmKind, renderSurfaceCommandValue(payload, vmDescriptor));',
        );
        expect(bootstrapSource).toContain(
            'setRenderSurfaceAccessorValue(smAccessor, smKind, renderSurfaceCommandValue(payload, smDescriptor));',
        );
    });

    it('acknowledges a matching ready handshake once without an ACK feedback loop', async () => {
        const listeners = new Map();
        const emitted = [];
        const scheduled = [];
        const windowRef = {
            __TAURI__: {
                event: {
                    emit: vi.fn(async (event, payload) => emitted.push({ event, payload, transport: 'emit' })),
                    emitTo: vi.fn(async (_target, event, payload) => emitted.push({ event, payload, transport: 'emitTo' })),
                    listen: vi.fn((event, handler) => {
                        listeners.set(event, handler);
                        return Promise.resolve(() => listeners.delete(event));
                    }),
                },
            },
            clearTimeout: vi.fn(),
            fetch: vi.fn(async () => ({ ok: true })),
            setTimeout: vi.fn((callback, delay) => {
                scheduled.push({ callback, delay });
                return scheduled.length;
            }),
        };
        const setupBridge = new Function(
            'window',
            'renderSurfaceSessionId',
            'handleRenderSurfaceCommand',
            'publishRenderSurfaceCanonicalState',
            `${renderSurfaceBridgeSource}; return setupRenderSurfaceBridge;`,
        )(windowRef, 'session-1', () => ({}), () => ({}));

        setupBridge();
        const load = listeners.get('render-surface:load');
        expect(load).toEqual(expect.any(Function));
        load({ payload: { sessionId: 'session-1' } });
        await Promise.resolve();
        load({ payload: { sessionId: 'session-1' } });
        await Promise.resolve();

        const readyReceipts = emitted.filter(({ event }) => event === 'render-surface:ready');
        expect(readyReceipts).toHaveLength(1);
        expect(readyReceipts[0].payload).toMatchObject({ handshake: 'acknowledged', sessionId: 'session-1' });
        expect(windowRef.clearTimeout).toHaveBeenCalledTimes(scheduled.length);
    });

    it('sends a native startup receipt when emitTo resolves but its delivery is dropped', async () => {
        const scheduled = [];
        const startupReceipts = [];
        const windowRef = {
            __TAURI__: {
                event: {
                    emit: vi.fn(async () => true),
                    emitTo: vi.fn(async () => true),
                    listen: vi.fn(async () => () => {}),
                },
            },
            btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
            clearTimeout: vi.fn(),
            fetch: vi.fn(async (path) => {
                if (path.startsWith('/__rav-render-surface-startup-receipt?')) {
                    const query = new URL(path, 'https://rav.local').searchParams;
                    const encoded = query.get('payload').replace(/-/g, '+').replace(/_/g, '/');
                    startupReceipts.push({
                        event: query.get('event'),
                        payload: JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
                    });
                }
                return { ok: true };
            }),
            setTimeout: vi.fn((callback, delay) => {
                scheduled.push({ callback, delay });
                return scheduled.length;
            }),
        };
        const setupBridge = new Function(
            'window',
            'renderSurfaceSessionId',
            'handleRenderSurfaceCommand',
            `${renderSurfaceBridgeSource}; return setupRenderSurfaceBridge;`,
        )(windowRef, 'dropped-ipc', () => ({}));

        setupBridge();
        scheduled.find(({ delay }) => delay === 0).callback();
        await Promise.resolve();
        await Promise.resolve();

        expect(windowRef.__TAURI__.event.emitTo).toHaveBeenCalledWith(
            'main',
            'render-surface:ready',
            expect.objectContaining({ attempt: 0, sessionId: 'dropped-ipc' }),
        );
        expect(startupReceipts).toContainEqual({
            event: 'ready',
            payload: expect.objectContaining({
                attempt: 0,
                handshake: 'pending',
                sessionId: 'dropped-ipc',
            }),
        });
    });

    it('ACKs an applied heavy-state mutation before the bounded parent deadline without a full scan', async () => {
        const listeners = new Map();
        const emitted = [];
        let parentOutcome = 'pending';
        const parentDeadline = setTimeout(() => { parentOutcome = 'timeout'; }, 3_000);
        const commandDelta = {
            controlChanges: [{ key: 'vm:rows/15/highlighted:boolean', kind: 'boolean', value: true }],
            revision: 2,
            stateRevision: 2,
            stateType: 'delta',
            topologyRevision: 1,
        };
        const windowRef = {
            __TAURI__: {
                event: {
                    emit: vi.fn(async (event, payload) => emitted.push({ event, payload })),
                    emitTo: vi.fn(async (_target, event, payload) => {
                        emitted.push({ event, payload });
                        if (event === 'render-surface:ack') {
                            clearTimeout(parentDeadline);
                            parentOutcome = payload.status;
                        }
                    }),
                    listen: vi.fn((event, handler) => {
                        listeners.set(event, handler);
                        return Promise.resolve(() => listeners.delete(event));
                    }),
                },
            },
            clearTimeout,
            fetch: vi.fn(async () => ({ ok: true })),
            setTimeout,
        };
        const handleCommand = vi.fn(() => ({
            descriptor: { kind: 'boolean', path: 'rows/15/highlighted', source: 'view-model' },
            value: true,
        }));
        const captureCommandDelta = vi.fn(() => commandDelta);
        const fullCanonicalScan = vi.fn(() => {
            throw new Error('the command ACK must not enter the 999-binding observer scan');
        });
        const setupBridge = new Function(
            'window',
            'renderSurfaceSessionId',
            'handleRenderSurfaceCommand',
            'captureRenderSurfaceCommandCanonicalDelta',
            'publishRenderSurfaceCanonicalState',
            `${renderSurfaceBridgeSource}; return setupRenderSurfaceBridge;`,
        )(windowRef, 'heavy-session', handleCommand, captureCommandDelta, fullCanonicalScan);

        setupBridge();
        listeners.get('render-surface:command')({ payload: {
            commandId: 'heavy-session:1',
            payload: {
                descriptor: { kind: 'boolean', path: 'rows/15/highlighted', source: 'view-model' },
                value: true,
            },
            protocolVersion: 2,
            revision: 1,
            sessionId: 'heavy-session',
            type: 'vm-set',
        } });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(handleCommand).toHaveBeenCalledOnce();
        expect(captureCommandDelta).toHaveBeenCalledOnce();
        expect(fullCanonicalScan).not.toHaveBeenCalled();
        expect(emitted).toContainEqual(expect.objectContaining({
            event: 'render-surface:ack',
            payload: expect.objectContaining({
                applied: true,
                canonicalDelta: commandDelta,
                commandId: 'heavy-session:1',
                status: 'applied',
            }),
        }));

        await vi.advanceTimersByTimeAsync(3_001);
        expect(parentOutcome).toBe('applied');
    });

    it('ACKs activation and reset commands without canonical scans, then schedules topology after each transported receipt', async () => {
        const listeners = new Map();
        const order = [];
        const windowRef = {
            __TAURI__: {
                event: {
                    emit: vi.fn(async () => true),
                    emitTo: vi.fn(async (_target, event, payload) => {
                        if (event === 'render-surface:ack') order.push(`ack:${payload.commandId}`);
                    }),
                    listen: vi.fn((event, handler) => {
                        listeners.set(event, handler);
                        return Promise.resolve(() => listeners.delete(event));
                    }),
                },
            },
            clearTimeout,
            fetch: vi.fn(async () => ({ ok: true })),
            setTimeout,
        };
        const handleCommand = vi.fn((command) => ({ handled: command.type }));
        const captureCommandDelta = vi.fn(() => null);
        const scheduleInitial = vi.fn(() => order.push('schedule:initial'));
        const scheduleRefresh = vi.fn(() => order.push('schedule:reset'));
        const setupBridge = new Function(
            'window',
            'renderSurfaceSessionId',
            'handleRenderSurfaceCommand',
            'captureRenderSurfaceCommandCanonicalDelta',
            'scheduleRenderSurfaceInitialCanonicalState',
            'scheduleRenderSurfaceCanonicalRefresh',
            `${renderSurfaceBridgeSource}; return setupRenderSurfaceBridge;`,
        )(
            windowRef,
            'activation-heavy',
            handleCommand,
            captureCommandDelta,
            scheduleInitial,
            scheduleRefresh,
        );
        setupBridge();
        const commandListener = listeners.get('render-surface:command');
        ['snapshot', 'presentation', 'activate-callbacks', 'prepare-frame', 'reset'].forEach((type, index) => {
            commandListener({ payload: {
                commandId: `activation-heavy:${index + 1}`,
                payload: {},
                protocolVersion: 2,
                revision: index + 1,
                sessionId: 'activation-heavy',
                type,
            } });
        });
        for (let microtask = 0; microtask < 100; microtask += 1) await Promise.resolve();

        expect(handleCommand).toHaveBeenCalledTimes(5);
        expect(captureCommandDelta).toHaveBeenCalledTimes(5);
        expect(order).toEqual([
            'ack:activation-heavy:1',
            'ack:activation-heavy:2',
            'ack:activation-heavy:3',
            'ack:activation-heavy:4',
            'schedule:initial',
            'ack:activation-heavy:5',
            'schedule:reset',
        ]);
        expect(scheduleInitial).toHaveBeenCalledOnce();
        expect(scheduleRefresh).toHaveBeenCalledWith('reset-first-frame', true);
        expect(renderSurfaceBridgeSource).not.toContain('|| publishRenderSurfaceCanonicalState');
    });

    it('continues the serialized bridge after a timed-out image command so scalar, play, and reset commands execute', async () => {
        const listeners = new Map();
        const acknowledgements = [];
        const handled = [];
        const windowRef = {
            __TAURI__: {
                event: {
                    emit: vi.fn(async () => true),
                    emitTo: vi.fn(async (_target, event, payload) => {
                        if (event === 'render-surface:ack') acknowledgements.push(payload);
                        return true;
                    }),
                    listen: vi.fn((event, handler) => {
                        listeners.set(event, handler);
                        return Promise.resolve(() => listeners.delete(event));
                    }),
                },
            },
            clearTimeout,
            fetch: vi.fn(async () => ({ ok: true })),
            setTimeout,
        };
        const handleCommand = vi.fn((command) => {
            handled.push(command.type);
            if (command.type === 'vm-image-set') {
                return new Promise((_resolve, reject) => {
                    windowRef.setTimeout(() => reject(new Error(
                        'Image presentation timed out before the Rive renderer advanced.',
                    )), 2_000);
                });
            }
            return { handled: command.type };
        });
        const scheduleRefresh = vi.fn();
        const setupBridge = new Function(
            'window',
            'renderSurfaceSessionId',
            'handleRenderSurfaceCommand',
            'captureRenderSurfaceCommandCanonicalDelta',
            'scheduleRenderSurfaceInitialCanonicalState',
            'scheduleRenderSurfaceCanonicalRefresh',
            `${renderSurfaceBridgeSource}; return setupRenderSurfaceBridge;`,
        )(
            windowRef,
            'recoverable-image-timeout',
            handleCommand,
            () => null,
            () => {},
            scheduleRefresh,
        );
        setupBridge();
        const commandListener = listeners.get('render-surface:command');
        ['vm-image-set', 'vm-set', 'play', 'reset'].forEach((type, index) => {
            commandListener({ payload: {
                commandId: `recoverable-image-timeout:${index + 1}`,
                payload: {},
                protocolVersion: 2,
                revision: index + 1,
                sessionId: 'recoverable-image-timeout',
                type,
            } });
        });

        for (let microtask = 0; microtask < 6; microtask += 1) await Promise.resolve();
        expect(handled).toEqual(['vm-image-set']);
        await vi.advanceTimersByTimeAsync(2_000);
        for (let microtask = 0; microtask < 30; microtask += 1) await Promise.resolve();

        expect(handled).toEqual(['vm-image-set', 'vm-set', 'play', 'reset']);
        expect(acknowledgements.map(({ applied, commandId, recoverable, status }) => ({
            applied, commandId, recoverable, status,
        }))).toEqual([
            {
                applied: false,
                commandId: 'recoverable-image-timeout:1',
                recoverable: true,
                status: 'rejected',
            },
            {
                applied: true,
                commandId: 'recoverable-image-timeout:2',
                recoverable: undefined,
                status: 'applied',
            },
            {
                applied: true,
                commandId: 'recoverable-image-timeout:3',
                recoverable: undefined,
                status: 'applied',
            },
            {
                applied: true,
                commandId: 'recoverable-image-timeout:4',
                recoverable: undefined,
                status: 'applied',
            },
        ]);
        expect(acknowledgements[0].message).toBe(
            'Image presentation timed out before the Rive renderer advanced.',
        );
        expect(scheduleRefresh).toHaveBeenCalledWith('reset-first-frame', true);
    });

    it('executes the distinctive applied editor callback from exported config', () => {
        const build = new Function(`${editorConfigSource}; return { resolveStandaloneEditorConfig, invokeStandaloneEditorCallback };`);
        const helpers = build();
        const applied = helpers.resolveStandaloneEditorConfig(
            '({ marker: "applied-editor", onLoad: function () { this.markerSeen = true; } })',
            'editor',
        );
        const instance = {};
        helpers.invokeStandaloneEditorCallback(applied.onLoad, instance, []);
        expect(applied.marker).toBe('applied-editor');
        expect(instance.markerSeen).toBe(true);
        const onError = vi.fn();
        helpers.invokeStandaloneEditorCallback(() => {
            throw new Error('callback failed');
        }, instance, [], onError);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'callback failed' }));
        expect(riveLoaderSource).toContain('reportAppliedEditorCallbackError');
        expect(riveLoaderSource).toContain('invokeRenderSurfaceAwareEditorCallback(appliedEditorConfig.onAdvance, Array.prototype.slice.call(arguments), reportAppliedEditorCallbackError)');
    });

    it('defers all applied editor callbacks in staged children until the parent activates callback ownership', () => {
        expect(preambleSource).toContain('let renderSurfaceUserCallbacksActive = !isRenderSurfaceMode;');
        expect(editorConfigSource).toContain('function activateRenderSurfaceUserCallbacks()');
        expect(riveLoaderSource).toContain('{ deferUntilActivation: true }');
        expect(editorConfigSource).toContain('if (!isRenderSurfaceMode || renderSurfaceUserCallbacksActive)');
        expect(bootstrapSource).toContain("if (type === 'activate-callbacks')");
        expect(bootstrapSource).toContain("if (type === 'prepare-frame')");
        expect(firstFrameSource).toContain('function waitForRenderSurfacePresentationFrames(frameCount)');
        expect(bootstrapSource).toContain('return waitForRenderSurfacePresentationFrames(2);');
        expect(bootstrapSource).toContain('activateRenderSurfaceUserCallbacks()');
        expect(editorConfigSource.indexOf('pendingRenderSurfaceOnLoad = null'))
            .toBeLessThan(editorConfigSource.indexOf('pendingOnLoad.callback'));

        const gateStart = editorConfigSource.indexOf('function invokeRenderSurfaceAwareEditorCallback');
        const gateSource = editorConfigSource.slice(gateStart);
        const callbacks = [];
        const gate = new Function('record', `
            var isRenderSurfaceMode = true;
            var renderSurfaceUserCallbacksActive = false;
            var pendingRenderSurfaceOnLoad = null;
            var riveInstance = { id: 'candidate' };
            function invokeStandaloneEditorCallback(callback, instance, args, reportError) {
                try { if (typeof callback === 'function') callback.apply(instance, args); }
                catch (error) { reportError(error); }
            }
            ${gateSource}
            return { activateRenderSurfaceUserCallbacks, invokeRenderSurfaceAwareEditorCallback };
        `)((value) => callbacks.push(value));
        const reportError = vi.fn();
        const onLoad = function (value) { callbacks.push(`load:${this.id}:${value}`); };
        const onAdvance = () => callbacks.push('advance');

        gate.invokeRenderSurfaceAwareEditorCallback(onLoad, ['ready'], reportError, { deferUntilActivation: true });
        gate.invokeRenderSurfaceAwareEditorCallback(onAdvance, [], reportError);
        expect(callbacks).toEqual([]);
        expect(gate.activateRenderSurfaceUserCallbacks()).toBe(true);
        expect(callbacks).toEqual(['load:candidate:ready']);
        expect(gate.activateRenderSurfaceUserCallbacks()).toBe(false);
        gate.invokeRenderSurfaceAwareEditorCallback(onAdvance, [], reportError);
        expect(callbacks).toEqual(['load:candidate:ready', 'advance']);
    });

    it('waits for two child presentation opportunities before prepare-frame can ACK', async () => {
        const helperStart = firstFrameSource.indexOf('function waitForRenderSurfacePresentationFrames(frameCount)');
        const helperEnd = firstFrameSource.length;
        expect(helperStart).toBeGreaterThan(-1);
        expect(helperEnd).toBeGreaterThan(helperStart);
        const frames = [];
        const timers = [];
        const waitForFrames = new Function('window', `${firstFrameSource.slice(helperStart, helperEnd)}; return waitForRenderSurfacePresentationFrames;`)({
            requestAnimationFrame: (callback) => frames.push(callback),
            setTimeout: (callback) => { timers.push(callback); return timers.length; },
            clearTimeout: vi.fn(),
        });
        let settled = false;
        const pending = waitForFrames(2).then((result) => { settled = true; return result; });
        expect(frames).toHaveLength(1);
        expect(timers).toHaveLength(1);
        frames.shift()();
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(frames).toHaveLength(1);
        expect(timers).toHaveLength(2);
        frames.shift()();
        await expect(pending).resolves.toEqual({ frames: 2, presented: true });
    });

    it('bounds both prepare-frame opportunities when an offscreen WebView starves rAF', async () => {
        const helperStart = firstFrameSource.indexOf('function waitForRenderSurfacePresentationFrames(frameCount)');
        const helperEnd = firstFrameSource.length;
        const frames = [];
        const timers = [];
        const cancelledFrames = [];
        const waitForFrames = new Function('window', `${firstFrameSource.slice(helperStart, helperEnd)}; return waitForRenderSurfacePresentationFrames;`)({
            cancelAnimationFrame: (frameId) => cancelledFrames.push(frameId),
            clearTimeout: vi.fn(),
            requestAnimationFrame: (callback) => {
                frames.push(callback);
                return frames.length;
            },
            setTimeout: (callback, delay) => {
                timers.push({ callback, delay });
                return timers.length;
            },
        });

        let settled = false;
        const pending = waitForFrames(2).then((result) => { settled = true; return result; });
        expect(frames).toHaveLength(1);
        expect(timers).toEqual([{ callback: expect.any(Function), delay: 250 }]);

        timers.shift().callback();
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(frames).toHaveLength(2);
        expect(timers).toEqual([{ callback: expect.any(Function), delay: 250 }]);

        timers.shift().callback();
        await expect(pending).resolves.toEqual({
            frames: 2,
            presented: true,
            timerFallbacks: 2,
        });
        expect(cancelledFrames).toEqual([1, 2]);

        // Starved rAF callbacks can arrive after native activation. They must
        // remain inert rather than counting extra opportunities or ACKing twice.
        frames.forEach((callback) => callback());
        expect(cancelledFrames).toEqual([1, 2]);
    });

    it('does not acknowledge an image mutation or release its decode until that exact mutation has presented', async () => {
        const frames = [];
        const previousRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
        try {
            const imageOne = { unref: vi.fn() };
            const imageTwo = { unref: vi.fn() };
            const accessors = { image1: { value: null }, image2: { value: null } };
            const root = {
                image: (name) => accessors[name] || null,
                properties: [{ name: 'image1' }, { name: 'image2' }],
            };
            const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
                imageRuntime: { decodeImage: vi.fn().mockResolvedValueOnce(imageOne).mockResolvedValueOnce(imageTwo) },
                renderSurfaceMode: true,
            });
            let firstAcknowledged = false;
            const first = harness.applyRenderSurfaceImageCommand({
                action: 'set-image', kind: 'image', path: 'image1', source: 'view-model', value: validPngBytes(1),
            }, true).then(() => { firstAcknowledged = true; });

            await Promise.resolve();
            await Promise.resolve();
            expect(accessors.image1.value).toBe(imageOne);
            expect(firstAcknowledged).toBe(false);
            expect(imageOne.unref).not.toHaveBeenCalled();
            expect(frames).toHaveLength(1);
            frames.shift()();
            await Promise.resolve();
            expect(firstAcknowledged).toBe(false);
            harness.advanceRenderer();
            expect(frames).toHaveLength(1);
            frames.shift()();
            await Promise.resolve();
            expect(frames).toHaveLength(1);
            frames.shift()();
            await first;
            expect(firstAcknowledged).toBe(true);
            expect(imageOne.unref).toHaveBeenCalledOnce();

            let secondAcknowledged = false;
            const second = harness.applyRenderSurfaceImageCommand({
                action: 'set-image', kind: 'image', path: 'image2', source: 'view-model', value: validPngBytes(2),
            }, true).then(() => { secondAcknowledged = true; });
            await Promise.resolve();
            await Promise.resolve();
            expect(accessors.image1.value).toBe(imageOne);
            expect(accessors.image2.value).toBe(imageTwo);
            expect(secondAcknowledged).toBe(false);
            frames.shift()();
            await Promise.resolve();
            harness.advanceRenderer();
            frames.shift()();
            await Promise.resolve();
            frames.shift()();
            await second;
            expect(secondAcknowledged).toBe(true);
            expect(imageTwo.unref).toHaveBeenCalledOnce();
        } finally {
            if (typeof previousRaf === 'function') window.requestAnimationFrame = previousRaf;
            else delete window.requestAnimationFrame;
        }
    });

    it('rejects a stalled image presentation before the parent deadline and stops scheduling frame work', async () => {
        const frames = [];
        const previousRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
        try {
            const image = { unref: vi.fn() };
            const accessor = { value: null };
            const root = {
                image: (name) => name === 'avatar' ? accessor : null,
                properties: [{ name: 'avatar' }],
            };
            const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
                imageRuntime: { decodeImage: vi.fn().mockResolvedValue(image) },
                renderSurfaceMode: true,
            });
            const pending = harness.applyRenderSurfaceImageCommand({
                action: 'set-image', kind: 'image', path: 'avatar', source: 'view-model', value: validPngBytes(7),
            }, true);

            const outcome = pending.then(
                (value) => ({ status: 'resolved', value }),
                (error) => ({ status: 'rejected', error }),
            );
            for (let microtask = 0; microtask < 6; microtask += 1) await Promise.resolve();
            expect(frames).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1_999);
            await expect(Promise.race([outcome.then(() => 'settled'), Promise.resolve('pending')]))
                .resolves.toBe('pending');

            await vi.advanceTimersByTimeAsync(1);
            const result = await outcome;
            expect(result.status).toBe('rejected');
            expect(result.error).toEqual(expect.objectContaining({
                message: 'Image presentation timed out before the Rive renderer advanced.',
            }));
            expect(image.unref).toHaveBeenCalledOnce();
            expect(accessor.value).toBe(image);
            expect(harness.readAcknowledgedRenderSurfaceImagePresence({
                kind: 'image', path: 'avatar', source: 'view-model',
            })).toBeNull();

            frames.shift()();
            await Promise.resolve();
            expect(frames).toHaveLength(0);
        } finally {
            if (typeof previousRaf === 'function') window.requestAnimationFrame = previousRaf;
            else delete window.requestAnimationFrame;
        }
    });

    it('captures copied embedded-image bytes while preserving the applied asset loader return', () => {
        const harness = createEmbeddedImageAssetHarness();
        const sourceBytes = new Uint8Array([1, 2, 3]);
        const expectedReturn = { handled: true };
        const receiver = { marker: 'asset-loader-this' };
        const userLoader = vi.fn(function (asset, bytes) {
            expect(this).toBe(receiver);
            expect(bytes).toBe(sourceBytes);
            return expectedReturn;
        });
        const loader = harness.composeEmbeddedImageAssetLoader(userLoader);
        const asset = {
            fileExtension: 'png',
            isImage: true,
            name: () => 'sample-raster',
            uniqueFilename: 'sample-raster-1001.png',
        };

        expect(loader.call(receiver, asset, sourceBytes)).toBe(expectedReturn);
        sourceBytes[0] = 99;
        expect(harness.getEmbeddedImageAssets()).toEqual([expect.objectContaining({
            bytes: new Uint8Array([1, 2, 3]),
            extension: 'png',
            key: 'sample-raster-1001.png',
            label: 'sample-raster',
            mimeType: 'application/octet-stream',
            name: 'sample-raster',
            uniqueFilename: 'sample-raster-1001.png',
        })]);
        expect(userLoader).toHaveBeenCalledOnce();

        harness.resetEmbeddedImageAssets();
        expect(harness.getEmbeddedImageAssets()).toEqual([]);
        expect(harness.composeEmbeddedImageAssetLoader()(asset, sourceBytes)).toBe(false);
    });

    it('keeps standalone image controls in one full-width action select with file decode and clear', () => {
        expect(controlsRenderSource).toContain("descriptor.kind === 'image'");
        expect(controlsRenderSource).toContain("getEmbeddedImageAssets()");
        expect(controlsRenderSource).toContain("openImageOption.textContent = 'Open file…'");
        expect(controlsRenderSource).toContain("clearImageOption.textContent = 'Clear'");
        expect(controlsRenderSource).toContain("assetPlaceholder.textContent = 'Select image…'");
        expect(controlsRenderSource).not.toContain('Embedded image…');
        expect(controlsRenderSource).not.toContain('browseImageButton');
        expect(controlsRenderSource).toContain('imageInput.hidden = true');
        expect(controlsRenderSource).toContain('loadedRiveRuntime.decodeImage');
        expect(controlsRenderSource).toContain('Promise.resolve().then(function ()');
        expect(controlsRenderSource).toContain('then(function (applied)');
        expect(controlsRenderSource).toContain('if (!applied) return;');
        expect(controlsRenderSource).toContain('requestId !== imageRequestSequence');
        expect(controlsRenderSource).toContain('decodedImage.unref()');
        expect(controlsRenderSource).toContain('live.value = null');
        expect(preambleSource).toContain("readEmbeddedAssetField(asset, 'uniqueFilename')");
        expect(preambleSource).toContain("return 'image/webp'");
        expect(syncSource).toContain('binding.assetSelect.disabled');
    });

    it('resets embedded assets once per outer load and composes the applied asset loader', () => {
        expect(riveLoaderSource.match(/resetEmbeddedImageAssets\(\)/g)).toHaveLength(1);
        expect(riveLoaderSource).toContain('composeEmbeddedImageAssetLoader(riveConfig.assetLoader)');
    });

    it('disables runtime auto-binding only when an explicit instance is configured', () => {
        expect(riveLoaderSource).toContain('typeof appliedEditorConfig.autoBind === \'boolean\'');
        expect(riveLoaderSource).toContain('CONFIG.viewModelInstanceName\n                        ? false');
        expect(riveLoaderSource).toContain('bindViewModelInstanceByKey(riveInstance, requestedVmInstanceKey)');
        expect(riveLoaderSource).toContain('requestedVmInstanceKey !== null');
    });

    it('preserves non-toolbar layout properties while keeping toolbar fit and alignment authoritative', () => {
        expect(riveLoaderSource).toContain('Object.assign({}, appliedEditorConfig.layout)');
        expect(riveLoaderSource).toContain('delete appliedLayoutProps.fit');
        expect(riveLoaderSource).toContain('delete appliedLayoutProps.alignment');
        expect(riveLoaderSource).toContain('}, appliedLayoutProps)');
    });

    it('applies live render-surface presentation state without reloading the animation', () => {
        expect(bootstrapSource).toContain("if (type === 'presentation')");
        expect(bootstrapSource).toContain('function applyRenderSurfacePresentation(payload)');
        expect(bootstrapSource).toContain('riveInstance.layout.copyWith(nextLayout)');
        expect(bootstrapSource).toContain('currentCanvasSizing = normalizeCanvasSizingState');
        expect(bootstrapSource).toContain('updateCanvasBackground()');
    });

    it('honors explicit timelines and announces the child contract after a first frame', () => {
        expect(riveLoaderSource).toContain('normalizeStateMachineSelection(CONFIG.animations)');
        expect(riveLoaderSource).toContain('riveConfig.animations = configuredAnimations.length === 1');
        expect(riveLoaderSource).toContain('!userSpecifiedStateMachines && !userSpecifiedAnimations');
        expect(riveLoaderSource).toContain("publishRenderSurfaceCanonicalState(true, 'load')");
        expect(riveLoaderSource).toContain('announceRenderSurfaceFirstFrame({');
        expect(riveLoaderSource).toContain('firstFrame: true');
        expect(canonicalStateSource).toContain('function captureRenderSurfaceControlsHierarchy(bridgeState)');
        expect(canonicalStateSource).toContain('controlChanges: captureChangedRenderSurfaceControls(bridgeState)');
        expect(canonicalStateSource).toContain("stateType: 'delta'");
        expect(canonicalStateSource).not.toContain('JSON.stringify');
        expect(canonicalPublicationSource).toContain("window.__ravRenderSurfaceEmit('render-surface:state', state)");
        expect(renderSurfaceLoadDiagnosticsSource).toContain('function reportRenderSurfaceLoadStage');
        expect(riveLoaderSource).toContain("reportRenderSurfaceLoadStage('begin')");
        expect(riveLoaderSource).toContain("reportRenderSurfaceLoadStage('rive-constructed')");
        expect(riveLoaderSource).toContain("reportRenderSurfaceLoadStage('rive-onload')");
        expect(riveLoaderSource).toContain("reportRenderSurfaceLoadStage('rive-onload-error', errorMsg)");
    });

    it('uses a hierarchy-free bootstrap receipt before materializing a heavyweight inspector topology', () => {
        const reads = { count: 0 };
        const accessors = Array.from({ length: 999 }, (_, index) => ({
            get value() {
                reads.count += 1;
                return index;
            },
        }));
        const root = {
            number: (name) => accessors[Number(name.replace('value', ''))] || null,
            properties: accessors.map((_, index) => ({ name: `value${index}` })),
        };
        const harness = createDemoVmHarness({
            animationNames: ['TrackMap'],
            artboard: { name: 'TrackMap' },
            isPlaying: true,
            playingAnimationNames: ['TrackMap'],
            playingStateMachineNames: [],
            stateMachineNames: [],
            viewModelInstance: root,
        }, { renderSurfaceMode: true });

        // This exact onLoad reason is the child activation contract. It must
        // be O(1): static selection + playback only, never the 999-row
        // ViewModel walk that builds an inspector hierarchy.
        const bootstrap = harness.publishRenderSurfaceCanonicalState(true, 'load');
        expect(bootstrap).toEqual(expect.objectContaining({
            artboard: 'TrackMap',
            stateType: 'bootstrap',
            topologyRevision: 0,
        }));
        expect(bootstrap).not.toHaveProperty('controlsHierarchy');
        expect(reads.count).toBe(0);

        // The detailed inspector remains eventual. It can be published only
        // after the load receipt has reached the parent/native activation
        // path, and its ordinary access costs are allowed here.
        const topology = harness.publishRenderSurfaceCanonicalState(true, 'topology-ready', true);
        expect(topology).toEqual(expect.objectContaining({
            controlsHierarchy: expect.any(Object),
            stateType: 'snapshot',
            topologyRevision: 1,
        }));
        expect(reads.count).toBe(999);
    });

    it('keeps onAdvance gated and materializes the first 999-control snapshot only in the post-activation idle task', () => {
        const frames = [];
        const idleTasks = [];
        const previousRaf = window.requestAnimationFrame;
        const previousIdle = window.requestIdleCallback;
        window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
        window.requestIdleCallback = (callback, options) => { idleTasks.push({ callback, options }); return idleTasks.length; };
        try {
            let accessorReads = 0;
            const accessors = Array.from({ length: 999 }, (_, index) => ({
                get value() { accessorReads += 1; return index; },
            }));
            const root = {
                number: (name) => accessors[Number(name.slice(1))] || null,
                properties: accessors.map((_value, index) => ({ name: `p${index}` })),
            };
            const harness = createDemoVmHarness({
                animationNames: ['Intro'],
                artboard: { name: 'Heavy' },
                isPlaying: true,
                playingAnimationNames: ['Intro'],
                playingStateMachineNames: [],
                stateMachineNames: [],
                viewModelInstance: root,
            }, { deferCanonicalUntilActivation: true, renderSurfaceMode: true });

            const bootstrap = harness.publishRenderSurfaceCanonicalState(true, 'load');
            expect(bootstrap).toEqual(expect.objectContaining({
                artboard: 'Heavy',
                stateType: 'bootstrap',
                topologyRevision: 0,
            }));
            expect(accessorReads).toBe(0);
            expect(harness.publishRenderSurfaceCanonicalState(false, 'advance')).toBeNull();
            expect(accessorReads).toBe(0);

            expect(harness.scheduleRenderSurfaceInitialCanonicalState()).toBe(true);
            expect(frames).toHaveLength(1);
            expect(idleTasks).toEqual([]);
            frames.shift()();
            expect(idleTasks).toHaveLength(1);
            expect(idleTasks[0].options).toEqual({ timeout: 1000 });
            expect(accessorReads).toBe(0);
            idleTasks.shift().callback();

            expect(accessorReads).toBe(999);
            expect(harness.emitted.map(({ payload }) => payload.reason)).toEqual(['load', 'activation']);
            expect(harness.emitted[1].payload).toEqual(expect.objectContaining({
                artboard: 'Heavy',
                controlsHierarchy: expect.any(Object),
                playback: expect.objectContaining({ name: 'Intro', type: 'animation' }),
                stateType: 'snapshot',
                topologyRevision: 1,
                vmInstance: expect.any(Object),
            }));
        } finally {
            if (typeof previousRaf === 'function') window.requestAnimationFrame = previousRaf;
            else delete window.requestAnimationFrame;
            if (typeof previousIdle === 'function') window.requestIdleCallback = previousIdle;
            else delete window.requestIdleCallback;
        }
    });

    it('starts activation after two presentation opportunities even when a static artboard does not advance', async () => {
        const onLoadStart = riveLoaderSource.indexOf('riveConfig.onLoad = function');
        const onLoadEnd = riveLoaderSource.indexOf('riveConfig.onLoadError = function', onLoadStart);
        const onLoadSource = riveLoaderSource.slice(onLoadStart, onLoadEnd);
        expect(onLoadSource).toContain("publishRenderSurfaceCanonicalState(true, 'load')");
        expect(onLoadSource).toContain('announceRenderSurfaceFirstFrame({');
        expect(onLoadSource).not.toContain("publishRenderSurfaceCanonicalState(true, 'activation', true)");

        const frames = [];
        const timers = [];
        const receipts = [];
        const scope = new Function('window', 'isRenderSurfaceMode', `
            ${firstFrameSource}
            return announceRenderSurfaceFirstFrame;
        `)({
            __ravRenderSurfaceEmit: (event, payload) => receipts.push({ event, payload }),
            requestAnimationFrame: (callback) => frames.push(callback),
            setTimeout: (callback) => { timers.push(callback); return timers.length; },
        }, true);

        expect(scope({ firstFrame: true })).toBe(true);
        expect(receipts).toEqual([]);
        frames.shift()();
        expect(receipts).toEqual([]);
        frames.shift()();
        expect(receipts).toEqual([{ event: 'render-surface:loaded', payload: { firstFrame: true } }]);
        timers.shift()();
        expect(receipts).toHaveLength(1);

        const alreadyAdvancedReceipts = [];
        const alreadyAdvancedFrames = [];
        const throttled = new Function('window', 'isRenderSurfaceMode', `
            ${firstFrameSource}
            return announceRenderSurfaceFirstFrame;
        `)({
            __ravRenderSurfaceEmit: (event, payload) => alreadyAdvancedReceipts.push({ event, payload }),
            requestAnimationFrame: (callback) => alreadyAdvancedFrames.push(callback),
            setTimeout: () => 1,
        }, true);
        expect(throttled({ firstFrame: true })).toBe(true);
        alreadyAdvancedFrames.shift()();
        alreadyAdvancedFrames.shift()();
        expect(alreadyAdvancedReceipts).toEqual([
            { event: 'render-surface:loaded', payload: { firstFrame: true } },
        ]);
        expect(riveLoaderSource).not.toContain('renderSurfaceConstructionAdvanceRevision');
        expect(renderSurfaceBridgeSource).toContain("commandType === 'prepare-frame'");
        expect(renderSurfaceBridgeSource).toContain('scheduleRenderSurfaceInitialCanonicalState()');
        expect(canonicalPublicationSource).toContain("publishRenderSurfaceCanonicalState(true, 'activation', true)");
    });

    it('derives exact timeline progress from source-animation frame duration used by supported runtimes', () => {
        const riveInstance = {
            animator: {
                animations: [{
                    animation: { duration: 120, fps: 60 },
                    instance: {},
                    name: 'Intro',
                    playing: true,
                    time: 0.5,
                }],
            },
            isPlaying: true,
            playingAnimationNames: ['Intro'],
            playingStateMachineNames: [],
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });

        expect(harness.captureRenderSurfacePlayback()).toEqual({
            currentFrame: 30,
            currentSeconds: 0.5,
            durationSeconds: 2,
            fps: 60,
            isPaused: false,
            isPlaying: true,
            name: 'Intro',
            totalFrames: 120,
            totalSeconds: 2,
            type: 'animation',
        });
    });

    it('selects the newest playing timeline wrapper when reset leaves duplicate names', () => {
        const riveInstance = {
            animator: {
                animations: [
                    {
                        animation: { duration: 60, fps: 60 },
                        name: 'Focus Fullscreen Mode',
                        playing: true,
                        time: 0,
                    },
                    {
                        animation: { duration: 60, fps: 60 },
                        name: 'Focus Fullscreen Mode',
                        playing: true,
                        time: 0.4,
                    },
                ],
            },
            isPlaying: true,
            playingAnimationNames: ['Focus Fullscreen Mode'],
            playingStateMachineNames: [],
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });

        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 24,
            currentSeconds: 0.4,
            name: 'Focus Fullscreen Mode',
            totalFrames: 60,
        }));
    });

    it('retains a child-confirmed terminal snapshot when a completed timeline wrapper is pruned', () => {
        const finished = {
            animation: { duration: 60, fps: 60 },
            name: 'Focus Fullscreen Mode',
            playing: true,
            time: 0.75,
        };
        const riveInstance = {
            animator: { animations: [finished] },
            isPlaying: true,
            playingAnimationNames: ['Focus Fullscreen Mode'],
            playingStateMachineNames: [],
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });
        harness.setRenderSurfaceTarget({ name: 'Focus Fullscreen Mode', type: 'animation' });

        expect(harness.recordRenderSurfaceTimelineAdvance()).toEqual({
            currentFrame: 45,
            currentSeconds: 0.75,
            fps: 60,
            totalFrames: 60,
            totalSeconds: 1,
        });
        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 45,
            currentSeconds: 0.75,
            totalFrames: 60,
            totalSeconds: 1,
        }));

        riveInstance.animator.animations = [];
        riveInstance.isPlaying = false;
        riveInstance.playingAnimationNames = [];
        expect(harness.recordRenderSurfaceTimelineStop({ data: ['Focus Fullscreen Mode'] })).toEqual({
            currentFrame: 60,
            currentSeconds: 1,
            fps: 60,
            totalFrames: 60,
            totalSeconds: 1,
        });
        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 60,
            currentSeconds: 1,
            isPaused: true,
            totalFrames: 60,
            totalSeconds: 1,
            type: 'animation',
        }));
    });

    it('keeps a completed direct timeline canonical when the runtime still reports its default state machine', () => {
        const finished = {
            animation: { duration: 60, fps: 60 },
            name: 'Focus Fullscreen Mode',
            playing: true,
            time: 0.4,
        };
        const riveInstance = {
            animator: { animations: [finished] },
            isPlaying: true,
            playingAnimationNames: ['Focus Fullscreen Mode'],
            playingStateMachineNames: ['TrackMapSM'],
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });
        harness.setRenderSurfaceTarget({ name: 'Focus Fullscreen Mode', type: 'animation' });
        harness.recordRenderSurfaceTimelineAdvance();

        // The direct wrapper is pruned after completion, while this runtime
        // continues to list the artboard's default state machine.
        riveInstance.animator.animations = [];
        riveInstance.isPlaying = false;
        riveInstance.playingAnimationNames = [];
        expect(harness.recordRenderSurfaceTimelineStop({ data: ['Focus Fullscreen Mode'] })).toEqual(expect.objectContaining({
            currentFrame: 60,
            totalFrames: 60,
        }));

        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 60,
            currentSeconds: 1,
            isPaused: true,
            name: 'Focus Fullscreen Mode',
            totalFrames: 60,
            totalSeconds: 1,
            type: 'animation',
        }));

        // Only a new acknowledged reset target may transition the selection
        // to the state machine and clear the timeline metrics.
        harness.setRenderSurfaceTarget({ name: 'TrackMapSM', type: 'stateMachine' });
        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: null,
            name: 'TrackMapSM',
            totalFrames: null,
            type: 'stateMachine',
        }));
    });

    it('keeps the completed target through the real terminal lifecycle even if a runtime callback overwrites the window scratch target', () => {
        const animation = {
            animation: { duration: 60, fps: 60 },
            name: 'Focus Fullscreen Mode',
            playing: true,
            time: 0.25,
        };
        const riveInstance = {
            animator: { animations: [animation] },
            isPlaying: true,
            playingAnimationNames: ['Focus Fullscreen Mode'],
            playingStateMachineNames: [],
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });
        harness.setRenderSurfaceTarget({ name: 'Focus Fullscreen Mode', type: 'animation' });
        harness.recordRenderSurfaceTimelineAdvance();

        riveInstance.animator.animations = [];
        riveInstance.isPlaying = false;
        riveInstance.playingAnimationNames = [];
        riveInstance.playingStateMachineNames = ['Focus Fullscreen Mode'];
        harness.recordRenderSurfaceTimelineStop({ data: ['Focus Fullscreen Mode'] });
        // This mirrors the observed bad lifecycle: a runtime/legacy callback
        // replaces the loose scratch global after the terminal receipt.
        window.__ravRenderSurfaceTarget = { name: 'Focus Fullscreen Mode', type: 'stateMachine' };

        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 60,
            name: 'Focus Fullscreen Mode',
            totalFrames: 60,
            type: 'animation',
        }));

        // Only the child reset contract is allowed to change canonical mode.
        harness.setRenderSurfaceTarget({ name: 'TrackMapSM', type: 'stateMachine' });
        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: null,
            name: 'TrackMapSM',
            totalFrames: null,
            type: 'stateMachine',
        }));
    });

    it('preserves the actual partial time for a paused timeline instead of marking it complete', () => {
        const paused = {
            animation: { duration: 120, fps: 60 },
            name: 'Intro',
            playing: false,
            time: 0.4,
        };
        const riveInstance = {
            animator: { animations: [paused] },
            isPlaying: false,
            playingAnimationNames: [],
            playingStateMachineNames: [],
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });
        harness.setRenderSurfaceTarget({ name: 'Intro', type: 'animation' });

        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 24,
            currentSeconds: 0.4,
            isPaused: true,
            totalFrames: 120,
            totalSeconds: 2,
        }));
        expect(harness.recordRenderSurfaceTimelineStop({ data: ['Other'] })).toBeNull();
        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 24,
            currentSeconds: 0.4,
        }));
    });

    it('clears a terminal snapshot on a child play receipt and reports the restarted wrapper', () => {
        const active = {
            animation: { duration: 60, fps: 60 },
            name: 'Focus Fullscreen Mode',
            playing: true,
            time: 0.8,
        };
        const riveInstance = {
            animator: { animations: [active] },
            isPlaying: true,
            playingAnimationNames: ['Focus Fullscreen Mode'],
            playingStateMachineNames: [],
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });
        harness.setRenderSurfaceTarget({ name: 'Focus Fullscreen Mode', type: 'animation' });
        harness.captureRenderSurfacePlayback();
        riveInstance.animator.animations = [];
        riveInstance.isPlaying = false;
        riveInstance.playingAnimationNames = [];
        harness.recordRenderSurfaceTimelineStop({ data: ['Focus Fullscreen Mode'] });
        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({ currentFrame: 60 }));

        const restarted = {
            animation: { duration: 60, fps: 60 },
            name: 'Focus Fullscreen Mode',
            playing: true,
            time: 0,
        };
        riveInstance.animator.animations = [restarted];
        riveInstance.isPlaying = true;
        riveInstance.playingAnimationNames = ['Focus Fullscreen Mode'];
        expect(harness.recordRenderSurfaceTimelinePlay({ data: ['Focus Fullscreen Mode'] })).toBe(true);
        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 0,
            currentSeconds: 0,
            totalFrames: 60,
            totalSeconds: 1,
        }));
    });

    it('restarts the reset render loop before its O(1) ACK delta captures advanced timeline time', async () => {
        const scheduledFrames = [];
        const active = {
            animation: { duration: 60, fps: 60 },
            name: 'Focus Fullscreen Mode',
            playing: true,
            time: 0,
        };
        const windowMock = {
            requestAnimationFrame: (callback) => {
                scheduledFrames.push(callback);
                return scheduledFrames.length;
            },
            setTimeout: (callback) => callback(),
        };
        const runtime = {
            artboard: { name: 'TrackMap' },
            animator: { animations: [active] },
            isPlaying: true,
            playingAnimationNames: ['Focus Fullscreen Mode'],
            playingStateMachineNames: [],
            stateMachineNames: [],
            startRendering: vi.fn(() => {
                windowMock.requestAnimationFrame(() => { active.time += 0.25; });
            }),
            viewModelInstance: { properties: [] },
        };
        const helpers = new Function('window', 'publishRenderSurfaceCanonicalState', 'riveInstance', `
            let currentControlSnapshot = [];
            let pendingControlSnapshot = new Map();
            let pendingRenderSurfaceReset = null;
            let renderSurfaceImageSnapshot = new Map();
            let renderSurfaceAdvanceRevision = 0;
            function applyControlSnapshot() { return 0; }
            function retryPendingControlSnapshot() { return 0; }
            ${resetContractSource}
            ${imageValidationSource}
            ${imageResetSource}
            return {
                setPending: (pending) => { pendingRenderSurfaceReset = pending; },
                settleRenderSurfaceResetAfterPresentation,
            };
        `)(windowMock, vi.fn(), runtime);
        const resolved = vi.fn();
        const pendingReset = {
            params: { animations: 'Focus Fullscreen Mode', autoplay: true },
            resolve: resolved,
            snapshot: [],
        };
        helpers.setPending(pendingReset);

        helpers.settleRenderSurfaceResetAfterPresentation(pendingReset);
        for (let microtask = 0; microtask < 6; microtask += 1) await Promise.resolve();
        expect(active.time).toBe(0);
        expect(scheduledFrames).toHaveLength(2);

        scheduledFrames.shift()(); // runtime draw scheduled by play()
        scheduledFrames.shift()(); // first reset presentation barrier
        expect(scheduledFrames).toHaveLength(1);
        scheduledFrames.shift()(); // second reset presentation barrier
        for (let microtask = 0; microtask < 6; microtask += 1) await Promise.resolve();

        expect(active.time).toBe(0.25);
        expect(resolved).toHaveBeenCalledWith(expect.objectContaining({
            playbackRestart: { names: ['Focus Fullscreen Mode'], restarted: true },
        }));
        const canonicalHarness = createDemoVmHarness(runtime, { renderSurfaceMode: true });
        canonicalHarness.setRenderSurfaceTarget({ name: 'Focus Fullscreen Mode', type: 'animation' });
        const resetAckDelta = canonicalHarness.captureRenderSurfaceCommandCanonicalDelta(
            { payload: {}, type: 'reset' },
            resolved.mock.calls[0][0],
        );
        expect(resetAckDelta).toEqual(expect.objectContaining({
            artboard: 'TrackMap',
            controlChanges: [],
            playback: expect.objectContaining({
                currentSeconds: 0.25,
                name: 'Focus Fullscreen Mode',
                type: 'animation',
            }),
            reason: 'command:reset',
            stateType: 'delta',
        }));
        expect(resetAckDelta).not.toHaveProperty('controlsHierarchy');
    });

    it('does not coerce missing instance metrics to zero before the valid source fallback', () => {
        const riveInstance = {
            animator: {
                animations: [{
                    animation: { duration: 90, fps: 30 },
                    instance: {},
                    name: 'Intro',
                    playing: true,
                    time: 1.25,
                }],
            },
            isPlaying: true,
            playingAnimationNames: ['Intro'],
            playingStateMachineNames: [],
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });

        expect(harness.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 38,
            currentSeconds: 1.25,
            fps: 30,
            totalFrames: 90,
            totalSeconds: 3,
        }));
    });

    it('supports explicit seconds metrics and degrades safely when animator internals are unavailable', () => {
        const proxied = createDemoVmHarness({
            animator: {
                animations: [{
                    durationSeconds: 2,
                    fps: 24,
                    name: 'Intro',
                    playing: true,
                    time: 0.25,
                }],
            },
            isPlaying: true,
            playingAnimationNames: ['Intro'],
            playingStateMachineNames: [],
        }, { renderSurfaceMode: true });
        expect(proxied.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: 6,
            totalFrames: 48,
            totalSeconds: 2,
        }));

        const unavailable = createDemoVmHarness({
            isPlaying: true,
            playingAnimationNames: ['Intro'],
            playingStateMachineNames: [],
        }, { renderSurfaceMode: true });
        expect(unavailable.captureRenderSurfacePlayback()).toEqual(expect.objectContaining({
            currentFrame: null,
            currentSeconds: null,
            fps: null,
            totalFrames: null,
            totalSeconds: null,
            type: 'animation',
        }));
    });

    it('publishes initial topology once, then emits changed scalar values as a lightweight delta', () => {
        const accessors = {
            enabled: { value: false },
            speed: { value: 1 },
            title: { value: 'before' },
            accent: { value: 0xff112233 },
            mode: { value: 'line', values: ['bar', 'line'] },
        };
        const kinds = { enabled: 'boolean', speed: 'number', title: 'string', accent: 'color', mode: 'enum' };
        const stateMachineInputs = [{ name: 'armed', value: false }, { name: 'gain', value: 2 }];
        const root = { properties: Object.keys(accessors).map((name) => ({ name })) };
        Object.entries(kinds).forEach(([name, kind]) => {
            root[kind] = (propertyName) => (propertyName === name ? accessors[name] : null);
        });
        const riveInstance = {
            isPlaying: true,
            playingStateMachineNames: ['Machine'],
            stateMachineInputs: () => stateMachineInputs,
            stateMachineNames: ['Machine'],
            viewModelInstance: root,
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });

        const initial = harness.publishRenderSurfaceCanonicalState(true, 'initial');
        expect(initial).toEqual(expect.objectContaining({
            stateRevision: 1,
            stateType: 'snapshot',
            topologyRevision: 1,
            controlsHierarchy: expect.any(Object),
        }));

        accessors.enabled.value = true;
        accessors.speed.value = 9;
        accessors.title.value = 'after';
        accessors.accent.value = 0xffabcdef;
        accessors.mode.value = 'bar';
        stateMachineInputs[0].value = true;
        stateMachineInputs[1].value = 4;
        expect(harness.observeRenderSurfaceControlBudget()).toBe(7);
        const delta = harness.publishRenderSurfaceCanonicalState(true, 'advance');

        expect(delta).toEqual(expect.objectContaining({
            stateRevision: 2,
            stateType: 'delta',
            topologyRevision: 1,
            playback: expect.objectContaining({ type: 'stateMachine' }),
        }));
        expect(delta).not.toHaveProperty('controlsHierarchy');
        expect(delta.controlChanges).toHaveLength(7);
        expect(delta.controlChanges).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'vm:enabled:boolean', value: true }),
            expect.objectContaining({ key: 'vm:speed:number', value: 9 }),
            expect.objectContaining({ key: 'vm:title:string', value: 'after' }),
            expect.objectContaining({ key: 'vm:accent:color', value: 0xffabcdef }),
            expect.objectContaining({ key: 'vm:mode:enum', value: 'bar' }),
            expect.objectContaining({ key: 'sm:Machine:armed:boolean', value: true }),
            expect.objectContaining({ key: 'sm:Machine:gain:number', value: 4 }),
        ]));
    });

    it('publishes numeric fallback keys for empty authored ViewModel instance names', () => {
        const root = { properties: [] };
        const harness = createDemoVmHarness({
            defaultViewModel: () => ({
                instanceCount: 3,
                instanceNames: ['', 'Primary', '  Preview  '],
                name: 'MixedVM',
            }),
            stateMachineNames: [],
            viewModelInstance: root,
        }, { renderSurfaceMode: true });

        expect(harness.publishRenderSurfaceCanonicalState(true, 'initial')).toEqual(expect.objectContaining({
            vmInstance: expect.objectContaining({
                availableKeys: ['0', 'Primary', 'Preview'],
            }),
        }));
    });

    it('invalidates reset-recreated scalar accessors and rebuilds bindings before observation resumes', () => {
        const frames = [];
        const idleTasks = [];
        const previousRaf = window.requestAnimationFrame;
        const previousIdle = window.requestIdleCallback;
        window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
        window.requestIdleCallback = (callback) => { idleTasks.push(callback); return idleTasks.length; };
        const originalAccessor = { value: 1 };
        let liveAccessor = originalAccessor;
        const root = {
            number: (name) => (name === 'speed' ? liveAccessor : null),
            properties: [{ name: 'speed' }],
        };
        try {
            const harness = createDemoVmHarness({
                stateMachineNames: [],
                viewModelInstance: root,
            }, { renderSurfaceMode: true });
            expect(harness.publishRenderSurfaceCanonicalState(true, 'initial')).toEqual(expect.objectContaining({
                controlsHierarchy: expect.any(Object),
                stateType: 'snapshot',
            }));

            liveAccessor = { value: 7 };
            expect(harness.invalidateRenderSurfaceCanonicalBindingsForReset()).toBe(true);
            expect(harness.observeRenderSurfaceControlBudget()).toBe(0);
            expect(harness.scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true)).toBe(true);
            frames.shift()();
            idleTasks.shift()();

            const refreshed = harness.emitted.at(-1).payload;
            expect(refreshed).toEqual(expect.objectContaining({
                reason: 'reset-first-frame',
                stateType: 'snapshot',
            }));
            expect(JSON.stringify(refreshed.controlsHierarchy)).toContain('"value":7');

            originalAccessor.value = 99;
            liveAccessor.value = 8;
            expect(harness.observeRenderSurfaceControlBudget()).toBe(1);
            expect(harness.publishRenderSurfaceCanonicalState(true, 'advance').controlChanges).toEqual([
                expect.objectContaining({ key: 'vm:speed:number', value: 8 }),
            ]);
        } finally {
            if (typeof previousRaf === 'function') window.requestAnimationFrame = previousRaf;
            else delete window.requestAnimationFrame;
            if (typeof previousIdle === 'function') window.requestIdleCallback = previousIdle;
            else delete window.requestIdleCallback;
        }
    });

    it('rebuilds topology only when a cached list grows or shrinks', () => {
        const rows = [{ properties: [] }];
        const list = { get length() { return rows.length; }, instanceAt: (index) => rows[index] || null };
        const root = { list: (name) => (name === 'rows' ? list : null), properties: [{ name: 'rows' }] };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, { renderSurfaceMode: true });

        expect(harness.publishRenderSurfaceCanonicalState(true, 'initial')).toEqual(expect.objectContaining({
            stateType: 'snapshot', topologyRevision: 1,
        }));
        expect(harness.publishRenderSurfaceCanonicalState(true, 'steady')).toEqual(expect.objectContaining({
            stateType: 'delta', topologyRevision: 1,
        }));
        rows.push({ properties: [] });
        expect(harness.publishRenderSurfaceCanonicalState(true, 'grow', true)).toEqual(expect.objectContaining({
            stateType: 'snapshot', topologyRevision: 2,
        }));
        rows.splice(0, 1);
        expect(harness.publishRenderSurfaceCanonicalState(true, 'shrink', true)).toEqual(expect.objectContaining({
            stateType: 'snapshot', topologyRevision: 3,
        }));
    });

    it('defers reactive list topology rebuilds outside the steady publication path', () => {
        const frames = [];
        const idleTasks = [];
        const previousRaf = window.requestAnimationFrame;
        const previousIdle = window.requestIdleCallback;
        window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
        window.requestIdleCallback = (callback, options) => { idleTasks.push({ callback, options }); return idleTasks.length; };
        const rows = [{ properties: [] }];
        const listeners = new Set();
        const instanceAt = vi.fn((index) => rows[index] || null);
        const list = {
            emit: () => [...listeners].forEach((listener) => listener()),
            get length() { return rows.length; },
            instanceAt,
            off: (listener) => listeners.delete(listener),
            on: (listener) => listeners.add(listener),
        };
        try {
            const root = { list: (name) => (name === 'rows' ? list : null), properties: [{ name: 'rows' }] };
            const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, { renderSurfaceMode: true });

            harness.publishRenderSurfaceCanonicalState(true, 'initial');
            const callsAfterInitial = instanceAt.mock.calls.length;
            expect(listeners.size).toBe(1);
            expect(harness.publishRenderSurfaceCanonicalState(true, 'steady').stateType).toBe('delta');
            expect(instanceAt).toHaveBeenCalledTimes(callsAfterInitial);

            rows.push({ properties: [] });
            list.emit();
            expect(frames).toHaveLength(1);
            expect(harness.publishRenderSurfaceCanonicalState(true, 'advance')).toEqual(expect.objectContaining({
                stateType: 'delta', topologyRevision: 1,
            }));
            expect(instanceAt).toHaveBeenCalledTimes(callsAfterInitial);

            frames.shift()();
            expect(idleTasks).toHaveLength(1);
            idleTasks.shift().callback();
            expect(harness.emitted.at(-1).payload).toEqual(expect.objectContaining({
                reason: 'topology-list', stateType: 'snapshot', topologyRevision: 2,
            }));
            expect(listeners.size).toBe(1);
            expect(instanceAt.mock.calls.length).toBeGreaterThan(callsAfterInitial);
        } finally {
            if (typeof previousRaf === 'function') window.requestAnimationFrame = previousRaf;
            else delete window.requestAnimationFrame;
            if (typeof previousIdle === 'function') window.requestIdleCallback = previousIdle;
            else delete window.requestIdleCallback;
        }
    });

    it('does not rebuild fallback topology when the runtime returns fresh wrappers for stable list objects', () => {
        const nativeList = { $$: { ptr: 101 } };
        let nativeRow = { $$: { ptr: 201 } };
        const root = {
            list: (name) => (name === 'rows' ? {
                _viewModelInstanceValue: nativeList,
                instanceAt: () => ({ _runtimeInstance: nativeRow, properties: [] }),
                length: 1,
            } : null),
            properties: [{ name: 'rows' }],
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, { renderSurfaceMode: true });

        expect(harness.publishRenderSurfaceCanonicalState(true, 'initial')).toEqual(expect.objectContaining({
            stateType: 'snapshot', topologyRevision: 1,
        }));
        expect(harness.publishRenderSurfaceCanonicalState(true, 'stable-wrappers', true)).toEqual(expect.objectContaining({
            stateType: 'delta', topologyRevision: 1,
        }));

        nativeRow = { $$: { ptr: 202 } };
        expect(harness.publishRenderSurfaceCanonicalState(true, 'replacement', true)).toEqual(expect.objectContaining({
            stateType: 'snapshot', topologyRevision: 2,
        }));
    });

    it('rebuilds fallback topology when a tokenless list item is replaced at the same length', () => {
        const rows = [{ properties: [{ name: 'before' }] }];
        const list = {
            get length() { return rows.length; },
            instanceAt: (index) => rows[index] || null,
        };
        const root = {
            list: (name) => (name === 'rows' ? list : null),
            properties: [{ name: 'rows' }],
        };
        const harness = createDemoVmHarness({
            stateMachineNames: [],
            viewModelInstance: root,
        }, { renderSurfaceMode: true });

        expect(harness.publishRenderSurfaceCanonicalState(true, 'initial')).toEqual(expect.objectContaining({
            stateType: 'snapshot', topologyRevision: 1,
        }));
        expect(harness.publishRenderSurfaceCanonicalState(true, 'stable', true)).toEqual(expect.objectContaining({
            stateType: 'delta', topologyRevision: 1,
        }));

        rows[0] = { properties: [{ name: 'after' }] };
        expect(harness.publishRenderSurfaceCanonicalState(true, 'same-length-replacement', true)).toEqual(expect.objectContaining({
            stateType: 'snapshot', topologyRevision: 2,
        }));
    });

    it('uses presence and monotonic receipts for image and trigger changes', () => {
        const image = { value: null };
        const trigger = { trigger: vi.fn() };
        const root = {
            image: (name) => (name === 'avatar' ? image : null),
            properties: [{ name: 'avatar' }, { name: 'refresh' }],
            trigger: (name) => (name === 'refresh' ? trigger : null),
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, { renderSurfaceMode: true });
        harness.publishRenderSurfaceCanonicalState(true, 'initial');

        image.value = { runtimeImage: true };
        harness.recordRenderSurfaceTriggerReceipt({ kind: 'trigger', path: 'refresh', source: 'view-model' });
        harness.recordRenderSurfaceTriggerReceipt({ kind: 'trigger', path: 'refresh', source: 'view-model' });
        harness.observeRenderSurfaceControlBudget();
        const delta = harness.publishRenderSurfaceCanonicalState(true, 'change');
        expect(delta.controlChanges).toEqual(expect.arrayContaining([
            { key: 'vm:avatar:image', kind: 'image', metadata: null, present: true },
            { key: 'vm:refresh:trigger', kind: 'trigger', receipt: 2 },
        ]));
    });

    it('builds an ACK delta for one applied control without rereading a 999-binding state', () => {
        let accessorReads = 0;
        const accessors = new Map(Array.from({ length: 999 }, (_, index) => [
            `control_${index}`,
            {
                get value() { accessorReads += 1; return index === 998; },
                set value(_next) {},
            },
        ]));
        const root = {
            boolean: (name) => accessors.get(name) || null,
            properties: Array.from(accessors.keys(), (name) => ({ name })),
        };
        const harness = createDemoVmHarness({
            isPlaying: true,
            playingAnimationNames: [],
            playingStateMachineNames: [],
            stateMachineNames: [],
            viewModelInstance: root,
        }, { renderSurfaceMode: true });
        harness.publishRenderSurfaceCanonicalState(true, 'initial');
        expect(accessorReads).toBe(999);
        accessorReads = 0;

        const command = {
            payload: {
                descriptor: {
                    kind: 'boolean',
                    name: 'control_998',
                    path: 'control_998',
                    source: 'view-model',
                },
                value: true,
            },
            type: 'vm-set',
        };
        const delta = harness.captureRenderSurfaceCommandCanonicalDelta(command, {
            descriptor: command.payload.descriptor,
            value: true,
        });

        expect(accessorReads).toBe(0);
        expect(delta).toEqual(expect.objectContaining({
            controlChanges: [{ key: 'vm:control_998:boolean', kind: 'boolean', value: true }],
            reason: 'command:vm-set',
            stateRevision: 2,
            stateType: 'delta',
            topologyRevision: 1,
        }));
        expect(harness.publishRenderSurfaceCanonicalState(true, 'next-observer-sweep').controlChanges)
            .toEqual([]);
        expect(accessorReads).toBe(0);
        expect(harness.observeRenderSurfaceControlBudget()).toBe(16);
        expect(accessorReads).toBe(16);
    });

    it('publishes acknowledged image presence and selection metadata when runtime image getters stay null', async () => {
        const assignedImages = [];
        const image = {
            get value() { return null; },
            set value(next) { assignedImages.push(next); },
        };
        const decoded = { unref: vi.fn() };
        const runtime = {
            decodeImage: vi.fn()
                .mockResolvedValueOnce(decoded)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ unref: vi.fn() })
                .mockResolvedValueOnce(null),
        };
        const root = {
            image: (name) => (name === 'main_im' ? image : null),
            properties: [{ name: 'main_im' }],
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
            imageRuntime: runtime,
            renderSurfaceMode: true,
        });
        const descriptor = { kind: 'image', name: 'main_im', path: 'main_im', source: 'view-model' };

        const initial = harness.publishRenderSurfaceCanonicalState(true, 'initial');
        expect(initial.controlsHierarchy.children[0].inputs[0]).toEqual(expect.objectContaining({
            metadata: null,
            present: false,
        }));

        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            ...descriptor,
            imageSelection: { kind: 'embedded', key: 'funkos_9.png', label: 'funkos_9' },
            value: validPngBytes(1),
        }, true));
        expect(assignedImages).toEqual([decoded]);
        expect(harness.publishRenderSurfaceCanonicalState(true, 'set').controlChanges).toEqual([{
            key: 'vm:main_im:image',
            kind: 'image',
            metadata: { kind: 'embedded', key: 'funkos_9.png', label: 'funkos_9' },
            present: true,
        }]);
        expect(harness.readAcknowledgedRenderSurfaceImagePresence({ ...descriptor, source: 'other-source' })).toBeNull();
        expect(harness.readAcknowledgedRenderSurfaceImageMetadata({ ...descriptor, source: 'other-source' })).toBeNull();

        await expect(harness.applyRenderSurfaceImageCommand({ ...descriptor, value: validPngBytes(9) }, true))
            .rejects.toThrow('runtime could not decode');
        expect(harness.publishRenderSurfaceCanonicalState(true, 'rejected-set').controlChanges).toEqual([]);

        await withRendererAdvance(harness, () => harness.restoreRenderSurfaceImageSnapshot());
        expect(runtime.decodeImage).toHaveBeenCalledTimes(3);
        expect(harness.publishRenderSurfaceCanonicalState(true, 'reset-replay').controlChanges).toEqual([]);

        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            ...descriptor, action: 'clear-image', value: null,
        }, true));
        expect(harness.publishRenderSurfaceCanonicalState(true, 'clear').controlChanges).toEqual([{
            key: 'vm:main_im:image',
            kind: 'image',
            metadata: null,
            present: false,
        }]);
        await expect(harness.applyRenderSurfaceImageCommand({ ...descriptor, value: validPngBytes(7) }, true))
            .rejects.toThrow('runtime could not decode');
        expect(harness.publishRenderSurfaceCanonicalState(true, 'rejected-after-clear').controlChanges).toEqual([]);
    });

    it('wakes a paused render surface for the first image slot without requiring a second mutation', async () => {
        const first = { value: null };
        const second = { value: null };
        const startRendering = vi.fn();
        const runtimeInstance = {
            isPlaying: false,
            startRendering,
            stateMachineNames: [],
            viewModelInstance: {
                image: (name) => ({ first, second }[name] || null),
                properties: [{ name: 'first' }, { name: 'second' }],
            },
        };
        const decoded = [];
        const harness = createDemoVmHarness(runtimeInstance, {
            imageRuntime: {
                decodeImage: vi.fn(async (bytes) => {
                    const image = { bytes: [...bytes], unref: vi.fn() };
                    decoded.push(image);
                    return image;
                }),
            },
            renderSurfaceMode: true,
        });

        const firstResult = await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            action: 'set-image',
            kind: 'image',
            path: 'first',
            source: 'view-model',
            imageSelection: { kind: 'embedded', key: 'source-1', label: 'Source 1' },
            value: validPngBytes(1),
        }, true));

        expect(first.value).toBe(decoded[0]);
        expect(second.value).toBeNull();
        expect(startRendering).toHaveBeenCalledTimes(1);
        expect(firstResult).toEqual(expect.objectContaining({
            imageApplied: true,
            rendering: { method: 'startRendering', restarted: true },
        }));
        expect(decoded[0].unref).toHaveBeenCalledTimes(1);

        runtimeInstance.isPlaying = true;
        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            action: 'set-image',
            kind: 'image',
            path: 'second',
            source: 'view-model',
            imageSelection: { kind: 'embedded', key: 'source-1', label: 'Source 1' },
            value: validPngBytes(2),
        }, true));
        expect(first.value).toBe(decoded[0]);
        expect(second.value).toBe(decoded[1]);
        expect(startRendering).toHaveBeenCalledTimes(1);
    });

    it('keeps two image slots independent through set-set-clear canonical publication', async () => {
        const slots = { image1: { value: null }, image2: { value: null } };
        const decoded = [];
        const root = {
            image: (name) => slots[name] || null,
            properties: [{ name: 'image1' }, { name: 'image2' }],
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
            imageRuntime: {
                decodeImage: vi.fn(async () => {
                    const image = { id: `decoded-${decoded.length + 1}`, unref: vi.fn() };
                    decoded.push(image);
                    return image;
                }),
            },
            renderSurfaceMode: true,
        });
        const descriptor = (name) => ({ kind: 'image', name, path: name, source: 'view-model' });
        const canonicalInputs = new Map();
        const byPath = (state) => {
            const fullInputs = state.controlsHierarchy?.children?.[0]?.inputs || [];
            fullInputs.forEach((input) => canonicalInputs.set(input.path, input));
            (state.controlChanges || []).forEach((change) => {
                const path = change.key?.replace(/^vm:/, '').replace(/:image$/, '');
                if (!path) return;
                canonicalInputs.set(path, { ...canonicalInputs.get(path), ...change, path });
            });
            return Object.fromEntries(canonicalInputs);
        };

        let canonical = byPath(harness.publishRenderSurfaceCanonicalState(true, 'initial'));
        expect(canonical.image1).toEqual(expect.objectContaining({ metadata: null, present: false }));
        expect(canonical.image2).toEqual(expect.objectContaining({ metadata: null, present: false }));

        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            ...descriptor('image1'),
            action: 'set-image',
            imageSelection: { kind: 'embedded', key: 'source-1', label: 'Source 1' },
            value: validPngBytes(1),
        }, true));
        canonical = byPath(harness.publishRenderSurfaceCanonicalState(true, 'slot-1-only'));
        expect(slots.image1.value).toBe(decoded[0]);
        expect(slots.image2.value).toBeNull();
        expect(canonical.image1).toEqual(expect.objectContaining({
            metadata: { kind: 'embedded', key: 'source-1', label: 'Source 1' }, present: true,
        }));
        expect(canonical.image2).toEqual(expect.objectContaining({ metadata: null, present: false }));

        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            ...descriptor('image2'),
            action: 'set-image',
            imageSelection: { kind: 'embedded', key: 'source-1', label: 'Source 1' },
            value: validPngBytes(2),
        }, true));
        canonical = byPath(harness.publishRenderSurfaceCanonicalState(true, 'both'));
        expect(canonical.image1.present).toBe(true);
        expect(canonical.image2).toEqual(expect.objectContaining({
            metadata: { kind: 'embedded', key: 'source-1', label: 'Source 1' }, present: true,
        }));

        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            ...descriptor('image1'), action: 'clear-image', value: null,
        }, true));
        canonical = byPath(harness.publishRenderSurfaceCanonicalState(true, 'slot-1-cleared'));
        expect(slots.image1.value).toBeNull();
        expect(slots.image2.value).toBe(decoded[1]);
        expect(canonical.image1).toEqual(expect.objectContaining({ metadata: null, present: false }));
        expect(canonical.image2).toEqual(expect.objectContaining({
            metadata: { kind: 'embedded', key: 'source-1', label: 'Source 1' }, present: true,
        }));
    });

    it('rejects malformed or unsafe image headers before decode and preserves prior pixels and metadata', async () => {
        const accessor = { value: null };
        const decoded = { id: 'last-good-pixels', unref: vi.fn() };
        const runtime = { decodeImage: vi.fn().mockResolvedValue(decoded) };
        const root = {
            image: (name) => (name === 'avatar' ? accessor : null),
            properties: [{ name: 'avatar' }],
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
            imageRuntime: runtime,
            renderSurfaceMode: true,
        });
        const descriptor = { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' };
        harness.publishRenderSurfaceCanonicalState(true, 'initial');

        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            ...descriptor,
            imageSelection: { kind: 'file', label: 'last-good.png' },
            value: validPngBytes(1),
        }, true));
        expect(accessor.value).toBe(decoded);
        expect(harness.publishRenderSurfaceCanonicalState(true, 'valid').controlChanges).toEqual([
            expect.objectContaining({
                key: 'vm:avatar:image',
                metadata: { kind: 'file', label: 'last-good.png' },
                present: true,
            }),
        ]);

        await expect(harness.applyRenderSurfaceImageCommand({
            ...descriptor,
            imageSelection: { kind: 'file', label: 'dimension-bomb.png' },
            value: validPngBytes(2, 16_385, 1),
        }, true)).rejects.toThrow('dimensions 16385×1 exceed the safe substitution limit');
        await expect(harness.applyRenderSurfaceImageCommand({
            ...descriptor,
            imageSelection: { kind: 'file', label: 'malformed.jpg' },
            value: [0xff, 0xd8, 0xff],
        }, true)).rejects.toThrow('JPEG image header is malformed');

        expect(runtime.decodeImage).toHaveBeenCalledOnce();
        expect(accessor.value).toBe(decoded);
        expect(harness.readAcknowledgedRenderSurfaceImageMetadata(descriptor)).toEqual({
            kind: 'file',
            label: 'last-good.png',
        });
        expect(harness.publishRenderSurfaceCanonicalState(true, 'invalid-rollback').controlChanges).toEqual([]);
    });

    it('rejects an invalid first image selection without creating canonical image state', async () => {
        const accessor = { value: null };
        const runtime = { decodeImage: vi.fn() };
        const root = {
            image: (name) => (name === 'avatar' ? accessor : null),
            properties: [{ name: 'avatar' }],
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
            imageRuntime: runtime,
            renderSurfaceMode: true,
        });
        const descriptor = { kind: 'image', name: 'avatar', path: 'avatar', source: 'view-model' };
        harness.publishRenderSurfaceCanonicalState(true, 'initial');

        await expect(harness.applyRenderSurfaceImageCommand({
            ...descriptor,
            imageSelection: { kind: 'file', label: 'not-an-image.bin' },
            value: [1, 2, 3, 4],
        }, true)).rejects.toThrow('not a supported raster image');
        expect(runtime.decodeImage).not.toHaveBeenCalled();
        expect(accessor.value).toBeNull();
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBeNull();
        expect(harness.readAcknowledgedRenderSurfaceImageMetadata(descriptor)).toBeNull();
        expect(harness.publishRenderSurfaceCanonicalState(true, 'invalid-first').controlChanges).toEqual([]);
    });

    it('keeps external image metadata bounded to kind and label', async () => {
        const image = {
            get value() { return null; },
            set value(_next) {},
        };
        const runtime = {
            decodeImage: vi.fn().mockResolvedValue({ unref: vi.fn() }),
        };
        const root = {
            image: (name) => (name === 'main_im' ? image : null),
            properties: [{ name: 'main_im' }],
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
            imageRuntime: runtime,
            renderSurfaceMode: true,
        });
        const descriptor = { kind: 'image', name: 'main_im', path: 'main_im', source: 'view-model' };
        harness.publishRenderSurfaceCanonicalState(true, 'initial');

        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({
            ...descriptor,
            imageSelection: {
                kind: 'file',
                label: 'open_source.jpg',
                path: '/private/should-never-be-published/open_source.jpg',
                bytes: [9, 8, 7],
            },
            value: validPngBytes(1),
        }, true));

        const delta = harness.publishRenderSurfaceCanonicalState(true, 'external-file');
        expect(delta.controlChanges).toEqual([{
            key: 'vm:main_im:image',
            kind: 'image',
            metadata: { kind: 'file', label: 'open_source.jpg' },
            present: true,
        }]);
        const serialized = JSON.stringify(delta.controlChanges[0]);
        expect(serialized).not.toContain('/private/');
        expect(serialized).not.toContain('should-never-be-published');
        expect(serialized).not.toContain('bytes');
        expect(serialized).not.toContain('1,2,3,4');
        expect(Object.keys(harness.readAcknowledgedRenderSurfaceImageMetadata(descriptor)).sort())
            .toEqual(['kind', 'label']);
    });

    it('replays list-generated image set, clear, growth, and rebind by full path', async () => {
        const decoded = [];
        const createRow = () => {
            const image = {
                value: null,
            };
            return {
                image: (name) => (name === 'avatar' ? image : null),
                properties: [{ name: 'avatar' }],
                imageAccessor: image,
            };
        };
        const rows = [createRow()];
        const root = {
            list: (name) => (name === 'rows' ? {
                get length() { return rows.length; },
                instanceAt: (index) => rows[index] || null,
            } : null),
            properties: [{ name: 'rows' }],
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, {
            imageRuntime: {
                decodeImage: vi.fn(async (bytes) => {
                    const image = { bytes: [...bytes], unref: vi.fn() };
                    decoded.push(image);
                    return image;
                }),
            },
            renderSurfaceMode: true,
        });
        const command = (path, value, imageSelection, action = 'set-image') => harness.applyRenderSurfaceImageCommand({
            action,
            kind: 'image',
            path,
            source: 'view-model',
            imageSelection,
            value,
        }, true);

        const rowOneBytes = validPngBytes(1);
        const rowTwoBytes = validPngBytes(2);
        await withRendererAdvance(harness, () => command(
            'rows/0/avatar', rowOneBytes, { kind: 'file', label: 'row-1.png' },
        ));
        rows.push(createRow());
        await withRendererAdvance(harness, () => command(
            'rows/1/avatar', rowTwoBytes, { kind: 'file', label: 'row-2.png' },
        ));
        rows[0].imageAccessor.value = null;
        rows[1].imageAccessor.value = null;
        await withRendererAdvance(harness, () => harness.restoreRenderSurfaceImageSnapshot());
        expect(rows[0].imageAccessor.value.bytes).toEqual(rowOneBytes);
        expect(rows[1].imageAccessor.value.bytes).toEqual(rowTwoBytes);

        // Rebinding the first list item at the same index must target the new
        // instance, while the second row remains independently addressable.
        const rebound = createRow();
        rows[0] = rebound;
        await withRendererAdvance(harness, () => harness.restoreRenderSurfaceImageSnapshot());
        expect(rebound.imageAccessor.value.bytes).toEqual(rowOneBytes);
        expect(rows[1].imageAccessor.value.bytes).toEqual(rowTwoBytes);

        await withRendererAdvance(harness, () => command('rows/1/avatar', null, null, 'clear-image'));
        rows[1].imageAccessor.value = { stale: true };
        await withRendererAdvance(harness, () => harness.restoreRenderSurfaceImageSnapshot());
        expect(rows[1].imageAccessor.value).toBeNull();
        expect(decoded.length).toBe(7);
    });

    it('observes 999 runtime-driven values in fixed-size batches and publishes the eventual delta', () => {
        let reads = 0;
        const accessors = Array.from({ length: 999 }, (_, index) => {
            let value = index;
            return {
                get value() { reads += 1; return value; },
                set value(next) { value = next; },
            };
        });
        const root = {
            number: (name) => accessors[Number(name.slice(1))] || null,
            properties: accessors.map((_accessor, index) => ({ name: `p${index}` })),
        };
        const harness = createDemoVmHarness({ stateMachineNames: [], viewModelInstance: root }, { renderSurfaceMode: true });
        const initial = harness.publishRenderSurfaceCanonicalState(true, 'initial');
        expect(JSON.stringify(initial)).toContain('controlsHierarchy');
        expect(reads).toBe(999);

        reads = 0;
        accessors[998].value = 5000;
        for (let pass = 0; pass < 63; pass += 1) {
            const before = reads;
            expect(harness.observeRenderSurfaceControlBudget()).toBeLessThanOrEqual(16);
            expect(reads - before).toBeLessThanOrEqual(16);
        }
        expect(reads).toBe(1008);
        const steady = harness.publishRenderSurfaceCanonicalState(true, 'advance');
        const serialized = JSON.stringify(steady);
        expect(steady.controlChanges).toEqual([{ key: 'vm:p998:number', kind: 'number', value: 5000 }]);
        expect(serialized).not.toContain('controlsHierarchy');
        expect(serialized).not.toContain('children');
        expect(serialized.length).toBeLessThan(1_000);
        expect(harness.getRenderSurfaceObserverDiagnostics()).toEqual(expect.objectContaining({
            controlCount: 999,
            passes: 63,
            readBudget: 16,
            reads: 1008,
        }));
    });

    it('keeps steady playback and state callbacks free of full control sweeps', () => {
        let reads = 0;
        const accessors = Array.from({ length: 999 }, (_, index) => ({
            get value() { reads += 1; return index; },
        }));
        const root = {
            number: (name) => accessors[Number(name.slice(1))] || null,
            properties: accessors.map((_accessor, index) => ({ name: `p${index}` })),
        };
        const harness = createDemoVmHarness({
            isPlaying: true,
            playingAnimationNames: [],
            playingStateMachineNames: ['Machine'],
            stateMachineNames: ['Machine'],
            stateMachineInputs: () => [],
            viewModelInstance: root,
        }, { renderSurfaceMode: true });
        harness.publishRenderSurfaceCanonicalState(true, 'initial');
        reads = 0;

        ['advance', 'play', 'pause', 'state-change'].forEach((reason) => {
            expect(harness.publishRenderSurfaceCanonicalState(true, reason)).toEqual(expect.objectContaining({
                stateType: 'delta',
            }));
            expect(reads).toBe(0);
        });
        expect(riveLoaderSource).toContain('observeRenderSurfaceControlBudget(getRenderSurfaceBridgeState())');
        expect(harness.observeRenderSurfaceControlBudget()).toBe(16);
        expect(reads).toBe(16);
    });

    it('binds a configured ViewModel instance by name and falls back to index', () => {
        const named = { name: 'Board' };
        const indexed = { index: 0 };
        const bindViewModelInstance = vi.fn();
        const riveInstance = {
            bindViewModelInstance,
            defaultViewModel: () => ({
                instanceByIndex: (index) => (index === 0 ? indexed : null),
                instanceByName: (name) => (name === 'Board' ? named : null),
            }),
        };
        const harness = createDemoVmHarness(riveInstance);

        expect(harness.bindViewModelInstanceByKey(riveInstance, 'Board')).toBe(true);
        expect(bindViewModelInstance).toHaveBeenLastCalledWith(named);
        expect(harness.bindViewModelInstanceByKey(riveInstance, '0')).toBe(true);
        expect(bindViewModelInstance).toHaveBeenLastCalledWith(indexed);
        expect(harness.bindViewModelInstanceByKey(riveInstance, 'Missing')).toBe(false);
    });

    it('applies an available count once and restores a delayed list row later', () => {
        const playerCount = { value: 0 };
        const rows = [];
        const riveInstance = {
            stateMachineNames: [],
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    get length() { return rows.length; },
                    instanceAt: (index) => rows[index] || null,
                } : null),
                number: (name) => (name === 'playerCount' ? playerCount : null),
            },
        };
        const harness = createDemoVmHarness(riveInstance);

        expect(harness.applyControlSnapshot([
            {
                descriptor: { kind: 'number', name: 'playerCount', path: 'playerCount' },
                kind: 'number',
                value: 50,
            },
            {
                descriptor: { kind: 'string', name: 'playerName', path: 'rows/0/playerName' },
                kind: 'string',
                value: 'Restored Player',
            },
        ])).toBe(1);
        expect(playerCount.value).toBe(50);
        expect(harness.pendingCount()).toBe(1);

        playerCount.value = 100;
        const playerName = { value: '' };
        rows.push({ string: (name) => (name === 'playerName' ? playerName : null) });

        expect(harness.retryPendingControlSnapshot()).toBe(1);
        expect(playerName.value).toBe('Restored Player');
        expect(playerCount.value).toBe(100);
        expect(harness.pendingCount()).toBe(0);
    });

    it('rerenders when an empty list gains delayed items, grows, and shrinks', () => {
        const rows = [];
        const listAccessor = {
            get length() { return rows.length; },
            instanceAt: (index) => rows[index] || null,
        };
        const riveInstance = {
            stateMachineNames: [],
            viewModelInstance: {
                list: (name) => (name === 'rows' ? listAccessor : null),
                properties: [{ name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance);

        expect(harness.initializeTopology()).toContain('["list","rows",0]');
        expect(harness.syncVmControlTopology()).toBe(false);

        rows.push(null);
        expect(harness.syncVmControlTopology()).toBe(true);
        expect(harness.topologyRenderCount()).toBe(1);

        rows[0] = { properties: [] };
        expect(harness.syncVmControlTopology()).toBe(true);

        rows.push({ properties: [] });
        expect(harness.syncVmControlTopology()).toBe(true);

        rows.splice(1, 1);
        expect(harness.syncVmControlTopology()).toBe(true);
        expect(harness.syncVmControlTopology()).toBe(false);
        expect(harness.topologyRenderCount()).toBe(4);
    });

    it('hides excluded root controls while extending a selected list field to new rows', () => {
        const exportedHierarchy = createExportHierarchy(2);
        const controlSnapshot = [
            createHierarchyInput('playerCount', 'number'),
            createHierarchyInput('rows/0/playerName'),
            createHierarchyInput('rows/1/playerName'),
        ];
        const harness = createDemoVmHarness(null, { controlSnapshot, vmHierarchy: exportedHierarchy });
        const grownHierarchy = stripHierarchyDescriptors(createExportHierarchy(3));

        const filtered = harness.filterHierarchyNode(grownHierarchy);
        expect(filtered.inputs.map((input) => input.path)).toEqual(['playerCount']);
        expect(filtered.inputs.map((input) => input.path)).not.toContain('focusIndex');
        expect(filtered.children[0].children.flatMap((child) => child.inputs.map((input) => input.path))).toEqual([
            'rows/0/playerName',
            'rows/1/playerName',
            'rows/2/playerName',
        ]);
        expect(filtered.totalInputs).toBe(4);
    });

    it('treats a selected list field as a family even when only some exported rows had changed values', () => {
        const exportedHierarchy = createExportHierarchy(2);
        const controlSnapshot = [createHierarchyInput('rows/0/playerName')];
        const harness = createDemoVmHarness(null, { controlSnapshot, vmHierarchy: exportedHierarchy });

        const filtered = harness.filterHierarchyNode(createExportHierarchy(3));
        expect(filtered.children[0].children).toHaveLength(3);
        expect(filtered.children[0].children.map((child) => child.path)).toEqual([
            'rows/0',
            'rows/1',
            'rows/2',
        ]);
    });

    it('expands ten selected row values across all 180 live rows without exposing focusIndex', () => {
        const exportedHierarchy = createExportHierarchy(150);
        const controlSnapshot = [
            createHierarchyInput('scrollScale', 'number'),
            createHierarchyInput('featureRank', 'number'),
            createHierarchyInput('playerCount', 'number'),
            createHierarchyInput('showPlayer', 'trigger'),
            ...Array.from({ length: 10 }, (_, index) => createHierarchyInput(`rows/${index}/playerName`)),
        ];
        const harness = createDemoVmHarness(null, { controlSnapshot, vmHierarchy: exportedHierarchy });

        const filtered = harness.filterHierarchyNode(stripHierarchyDescriptors(createExportHierarchy(180)));
        expect(filtered.inputs.map((input) => input.path)).toEqual([
            'scrollScale',
            'featureRank',
            'playerCount',
            'showPlayer',
        ]);
        expect(filtered.inputs.some((input) => input.path === 'focusIndex')).toBe(false);
        expect(filtered.children[0].children).toHaveLength(180);
        expect(filtered.children[0].children[0].label).toBe('Row 1');
        expect(filtered.children[0].children[179].label).toBe('Row 180');
        expect(filtered.totalInputs).toBe(184);
    });

    it('builds one-based list-aware labels for live list instances', () => {
        const rows = Array.from({ length: 3 }, (_, index) => ({
            properties: [{ name: 'playerName' }],
            string: (name) => (name === 'playerName' ? { value: `Player ${index + 1}` } : null),
        }));
        const riveInstance = {
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    instanceAt: (index) => rows[index] || null,
                    length: rows.length,
                } : null),
                properties: [{ name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance, {
            controlSelectionKeys: ['vm:rows/*/playerName:string'],
        });

        const hierarchy = harness.filterHierarchyNode(harness.buildVmHierarchy(riveInstance.viewModelInstance));
        expect(hierarchy.children[0].children.map((child) => child.label)).toEqual([
            'Row 1',
            'Row 2',
            'Row 3',
        ]);
        expect(harness.formatVmListItemLabel('playerEntries', 3)).toBe('Row 4');
    });

    it('uses one unambiguous canonical string match for authored live-list labels', () => {
        const rows = [
            {
                properties: [{ name: 'item_code' }, { name: 'status' }],
                string: (name) => ({
                    item_code: { value: 'Item-Alpha' },
                    status: { value: 'Active' },
                })[name] || null,
                viewModelName: 'ListItemVM',
            },
            {
                properties: [{ name: 'item_code' }, { name: 'alternate' }],
                string: (name) => ({
                    alternate: { value: 'Item-Beta' },
                    item_code: { value: 'Item-Alpha' },
                })[name] || null,
                viewModelName: 'ListItemVM',
            },
        ];
        const riveInstance = {
            viewModelByName: (name) => (name === 'ListItemVM'
                ? { instanceNames: ['Item-Alpha', 'Item-Beta'] }
                : null),
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    instanceAt: (index) => rows[index] || null,
                    length: rows.length,
                } : null),
                properties: [{ name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance, {
            controlSelectionKeys: [
                'vm:rows/*/item_code:string',
                'vm:rows/*/status:string',
                'vm:rows/*/alternate:string',
            ],
        });

        const hierarchy = harness.filterHierarchyNode(harness.buildVmHierarchy(riveInstance.viewModelInstance));
        expect(hierarchy.children[0].children.map((child) => child.label)).toEqual([
            'Item-Alpha',
            'Row 2',
        ]);
    });

    it('uses authored list instance names and discovers image controls', () => {
        const imageAccessor = { value: null };
        const rows = [
            {
                name: 'First Authored Row',
                image: (name) => (name === 'avatar' ? imageAccessor : null),
                properties: [{ name: 'avatar' }],
            },
        ];
        const riveInstance = {
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    instanceAt: (index) => rows[index] || null,
                    length: rows.length,
                } : null),
                properties: [{ name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance, {
            controlSelectionKeys: ['vm:rows/*/avatar:image'],
        });

        const hierarchy = harness.filterHierarchyNode(harness.buildVmHierarchy(riveInstance.viewModelInstance));
        expect(hierarchy.children[0].children[0].label).toBe('First Authored Row');
        expect(hierarchy.children[0].children[0].inputs[0]).toEqual(expect.objectContaining({
            kind: 'image',
            path: 'rows/0/avatar',
        }));
    });

    it('tracks playerCount-driven list growth and shrinkage in the rendered hierarchy', () => {
        const playerCount = { value: 150 };
        const createRow = (index) => ({
            number: (name) => (name === 'introY' ? { value: index } : null),
            properties: [{ name: 'introY' }],
        });
        const rows = Array.from({ length: playerCount.value }, (_, index) => createRow(index));
        const resizeRows = (count) => {
            playerCount.value = count;
            if (rows.length > count) rows.length = count;
            while (rows.length < count) rows.push(createRow(rows.length));
        };
        const riveInstance = {
            viewModelInstance: {
                list: (name) => (name === 'rows' ? {
                    get length() { return rows.length; },
                    instanceAt: (index) => rows[index] || null,
                } : null),
                number: (name) => (name === 'playerCount' ? playerCount : null),
                properties: [{ name: 'playerCount' }, { name: 'rows' }],
            },
        };
        const harness = createDemoVmHarness(riveInstance, {
            controlSelectionKeys: [
                'vm:playerCount:number',
                'vm:rows/*/introY:number',
            ],
        });

        harness.initializeTopology();
        resizeRows(180);
        expect(harness.syncVmControlTopology()).toBe(true);
        expect(harness.renderedHierarchy().children[0].children).toHaveLength(180);
        expect(harness.renderedHierarchy().children[0].children[179].label).toBe('Row 180');
        expect(harness.renderedHierarchy().totalInputs).toBe(181);

        resizeRows(7);
        expect(harness.syncVmControlTopology()).toBe(true);
        expect(harness.renderedHierarchy().children[0].children).toHaveLength(7);
        expect(harness.renderedHierarchy().children[0].children[6].label).toBe('Row 7');
        expect(harness.renderedHierarchy().totalInputs).toBe(8);
    });

    it('renders no Properties hierarchy when the export selection is empty', () => {
        const exportedHierarchy = createExportHierarchy(2);
        const harness = createDemoVmHarness(null, {
            controlSelectionKeys: [],
            controlSnapshot: [createHierarchyInput('rows/0/playerName')],
            vmHierarchy: exportedHierarchy,
        });

        expect(harness.filterHierarchyNode(stripHierarchyDescriptors(exportedHierarchy))).toBeNull();
    });
});
