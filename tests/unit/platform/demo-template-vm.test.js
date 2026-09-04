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
const runtimeCompatibilitySource = readFileSync(
    path.resolve(process.cwd(), 'src/app/snippets/source/rive-runtime-compatibility.js'),
    'utf8',
).replace(/\r\n?/g, '\n');
const playbackLayoutSource = readTemplateSource('core/playback-layout.js');
const demoBundleSource = readFileSync(
    path.resolve(process.cwd(), 'src-tauri/src/app/demo_bundle.rs'),
    'utf8',
).replace(/\r\n?/g, '\n');
const timelineStateSource = readTemplateSource('vm/timeline-state.js');
const preambleSource = readTemplateSource('core/preamble.js');
const firstFrameSource = readTemplateSource('core/load/first-frame.js');
const frameClockSource = readTemplateSource('media/frame-clock.js');
const diagnosticCaptureSource = readTemplateSource('media/diagnostic-capture.js');
const riveLoaderSource = readTemplateSource('core/rive-loader.js');
const editorConfigSource = readTemplateSource('core/editor-config.js');
const controlsRenderSource = readTemplateSource('vm/controls-render.js');
const syncSource = readTemplateSource('vm/sync.js');
const bootstrapSource = readTemplateSource('core/bootstrap.js');
const renderSurfaceBridgeSource = readTemplateSource('core/render-surface-bridge.js');
const renderSurfaceEvalSource = readTemplateSource('core/bridge/eval.js');
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

describe('render surface VM numeric presentation', () => {
    it('keeps template controls at two decimals while runtime values remain numeric', () => {
        expect(controlsRenderSource).toContain('function formatVmNumber(value)');
        expect(controlsRenderSource).toContain('numberInput.value = formatVmNumber(accessor && accessor.value)');
        expect(controlsRenderSource).toContain('alphaInput.value = formatVmNumber(colorMeta.alphaPercent)');
        expect(syncSource).toContain('var nextNum = formatVmNumber(numValue);');
        expect(syncSource).toContain('var nextAlpha = formatVmNumber(meta.alphaPercent);');
    });

    it('writes text, number, and alpha edits before blur without formatting active numeric input', () => {
        const accessors = {
            accent: { value: 0xff112233 },
            name: { value: 'Before' },
            speed: { value: 1 },
        };
        const logged = [];
        const helpers = new Function('document', 'resolveControlAccessor', 'registerVmControlBinding', 'logEvent', `
            function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
            function argbToColorMeta(value) {
                return { alphaPercent: 100, hex: '#112233' };
            }
            function hexToRgb(value) {
                return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) };
            }
            function rgbAlphaToArgb(r, g, b, a) {
                return (((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
            }
            ${controlsRenderSource}
            return { createVmControlRow };
        `)(
            document,
            (descriptor) => accessors[descriptor.path] || null,
            () => {},
            (...entry) => logged.push(entry),
        );

        const textInput = helpers.createVmControlRow({ kind: 'string', name: 'name', path: 'name' })
            .querySelector('input');
        textInput.value = 'During input';
        textInput.dispatchEvent(new Event('input'));
        expect(accessors.name.value).toBe('During input');
        expect(logged).toHaveLength(0);

        const numberInput = helpers.createVmControlRow({ kind: 'number', name: 'speed', path: 'speed' })
            .querySelector('input');
        numberInput.value = '12.5';
        numberInput.dispatchEvent(new Event('input'));
        expect(accessors.speed.value).toBe(12.5);
        expect(numberInput.value).toBe('12.5');
        numberInput.dispatchEvent(new Event('change'));
        expect(numberInput.value).toBe('12.50');

        const colorRow = helpers.createVmControlRow({ kind: 'color', name: 'accent', path: 'accent' });
        const alphaInput = colorRow.querySelector('input[type="number"]');
        alphaInput.value = '50';
        alphaInput.dispatchEvent(new Event('input'));
        expect((accessors.accent.value >>> 24) & 255).toBe(128);
        expect(alphaInput.value).toBe('50');
        alphaInput.dispatchEvent(new Event('change'));
        expect(alphaInput.value).toBe('50.00');
        expect(logged.map((entry) => entry[1])).toEqual(['vm-number', 'vm-color']);
    });
});

describe('render surface canvas capture', () => {
    it('keeps capture on the child canvas with background compositing and bounded retries', () => {
        expect(bootstrapSource).toContain("type === 'capture-canvas'");
        expect(bootstrapSource).toContain('captureRenderSurfaceDiagnostic(payload, emitToMain)');
        expect(demoBundleSource).toContain('include_str!("../demo-template/js/media/diagnostic-capture.js")');
        expect(diagnosticCaptureSource).toContain('window.getComputedStyle(canvas)');
        expect(diagnosticCaptureSource).toContain('context.fillStyle = backgroundColor');
        expect(diagnosticCaptureSource).toContain("riveInstance.stopRendering()");
        expect(diagnosticCaptureSource).toContain("riveInstance.startRendering()");
        expect(diagnosticCaptureSource).toContain("riveInstance.drawOptimization = 'alwaysDraw'");
        expect(diagnosticCaptureSource).toContain('attempts <= 4');
        expect(diagnosticCaptureSource).toContain('12 * 1024 * 1024');
        expect(diagnosticCaptureSource).toContain("data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0");
        expect(diagnosticCaptureSource).toContain("emitToMain('render-surface:capture'");
    });
});

describe('render surface eval authority', () => {
    it('evaluates in child scope and returns a bounded safe preview', async () => {
        const helpers = new Function(`
            let riveInstance = {
                animationNames: ['idle'],
                artboard: { name: 'Child' },
                isPlaying: true,
                isStopped: false,
                stateMachineNames: ['Main'],
                viewModelInstance: {},
            };
            ${renderSurfaceEvalSource}
            return { evaluateRenderSurfaceExpression };
        `)();

        await expect(helpers.evaluateRenderSurfaceExpression({ expression: 'riveInstance' }))
            .resolves.toEqual({ result: {
                $type: 'RiveInstance',
                animations: ['idle'],
                artboard: 'Child',
                hasViewModel: true,
                isPlaying: true,
                isStopped: false,
                stateMachines: ['Main'],
            } });
        const bounded = await helpers.evaluateRenderSurfaceExpression({
            expression: '({ text: "x".repeat(9000), values: Array.from({ length: 20 }, (_, index) => index) })',
        });
        expect(bounded.result.text.length).toBeLessThan(8300);
        expect(bounded.result.values).toHaveLength(13);
        expect(bounded.result.values.at(-1)).toBe('... 8 more');
    });

    it('bundles the child helper before the command router', () => {
        const helperInclude = 'include_str!("../demo-template/js/core/bridge/eval.js")';
        const bootstrapInclude = 'include_str!("../demo-template/js/core/bootstrap.js")';
        expect(demoBundleSource).toContain(helperInclude);
        expect(demoBundleSource.indexOf(helperInclude)).toBeLessThan(demoBundleSource.indexOf(bootstrapInclude));
        expect(bootstrapSource).toContain("if (type === 'eval') return evaluateRenderSurfaceExpression(payload);");
    });
});

describe('standalone runtime deprecation compatibility', () => {
    it('embeds the shared factory before the template modules and initializes it in the preamble', () => {
        expect(demoBundleSource).toContain('include_str!("../../../src/app/snippets/source/rive-runtime-compatibility.js")');
        expect(preambleSource).toContain('const runtimeCompatibility = createRiveRuntimeCompatibility();');
    });

    it('emits singular playback for 2.41, preserves plural playback for 2.40, and retains mixed legacy targets', () => {
        const compatibility = new Function(`${runtimeCompatibilitySource}; return createRiveRuntimeCompatibility();`)();

        expect(compatibility.normalizePlaybackConfig({ stateMachines: 'Machine' }, '2.41.1')).toEqual({
            stateMachine: 'Machine',
        });
        expect(compatibility.normalizePlaybackConfig({ stateMachine: 'Machine' }, '2.40.1')).toEqual({
            stateMachines: 'Machine',
        });
        expect(compatibility.normalizePlaybackConfig({
            animations: ['Intro', 'Loop'],
            stateMachines: 'Machine',
        }, '2.41.1')).toEqual({
            animations: ['Intro', 'Loop'],
            stateMachines: 'Machine',
        });
    });

    it('lets an explicit payload timeline or state machine override stale singular editor playback', () => {
        const helpers = new Function(`${runtimeCompatibilitySource}
            const runtimeCompatibility = createRiveRuntimeCompatibility();
            ${playbackLayoutSource}; return {
            resolveStandalonePlaybackConfig,
        };`)();

        expect(helpers.resolveStandalonePlaybackConfig({
            animations: ['Intro'],
            runtimeVersion: '2.41.1',
        }, { stateMachine: 'OldSM' }).config).toEqual(expect.objectContaining({
            animations: 'Intro',
        }));
        expect(helpers.resolveStandalonePlaybackConfig({
            animations: ['Intro'],
            runtimeVersion: '2.41.1',
        }, { stateMachine: 'OldSM' }).config).not.toHaveProperty('stateMachine');

        expect(helpers.resolveStandalonePlaybackConfig({
            runtimeVersion: '2.41.1',
            stateMachines: ['NewSM'],
        }, { stateMachine: 'OldSM' }).config).toEqual({ stateMachine: 'NewSM' });
    });

    it('does not probe deprecated stateMachineInputs when exact active-artboard metadata says a machine is empty', () => {
        const stateMachineInputs = vi.fn(() => []);
        const contents = vi.fn(() => { throw new Error('Live contents must never be inspected'); });
        const riveInstance = {
            activeArtboard: 'Main',
            get contents() { return contents(); },
            stateMachineInputs,
            stateMachineNames: ['Machine'],
        };
        const harness = createDemoVmHarness(riveInstance, {
            renderSurfaceMode: true,
            inspectionMetadata: { artboards: [{ name: 'Main', stateMachines: [{ name: 'Machine', inputs: [] }] }] },
        });

        expect(harness.captureRenderSurfaceControlsHierarchy().children).toEqual([]);
        expect(harness.resolveStateMachineInputAccessor('Machine', 'missing', 'trigger')).toBeNull();
        expect(harness.fireStateMachineTriggerByName('missing')).toBe(0);
        harness.publishRenderSurfaceCanonicalState(true, 'initial');
        expect(stateMachineInputs).not.toHaveBeenCalled();
        expect(contents).not.toHaveBeenCalled();
    });

    it('keeps explicit legacy callbacks while avoiding irrelevant automatic event subscriptions', () => {
        expect(playbackLayoutSource).toContain('runtimeCompatibility.normalizePlaybackConfig(config, payload.runtimeVersion);');
        const eventCallbackSource = readTemplateSource('core/event-log.js');
        expect(eventCallbackSource).toContain("typeof appliedEditorConfig.onLoop === 'function'");
        expect(eventCallbackSource).toContain("typeof appliedEditorConfig.onStateChange === 'function'");
        expect(riveLoaderSource).toContain('configureRiveDeprecatedEventCallbacks(riveConfig');
        expect(riveLoaderSource).toContain('instance.on(eventType, listener);');
    });

    it('preserves lowercase explicit legacy callbacks exactly once while removing their deprecated aliases', () => {
        const eventCallbackSource = readTemplateSource('core/event-log.js');
        const start = eventCallbackSource.indexOf('function configureRiveDeprecatedEventCallbacks');
        const end = eventCallbackSource.indexOf('function renderEventLog', start);
        const invoke = vi.fn((callback, args) => callback(...args));
        const onloop = vi.fn();
        const onstatechange = vi.fn();
        const helpers = new Function('logEvent', 'invokeRenderSurfaceAwareEditorCallback', 'publishRenderSurfaceCanonicalState', `
            ${eventCallbackSource.slice(start, end)}
            return { configureRiveDeprecatedEventCallbacks };
        `)(vi.fn(), invoke, vi.fn());
        const riveConfig = { onloop, onstatechange };

        helpers.configureRiveDeprecatedEventCallbacks(riveConfig, {
            appliedEditorConfig: { onloop, onstatechange },
            reportCallbackError: vi.fn(),
            userSpecifiedAnimations: false,
            userSpecifiedStateMachines: true,
        });
        riveConfig.onLoop({ name: 'loop' });
        riveConfig.onStateChange({ name: 'state' });

        expect(onloop).toHaveBeenCalledTimes(1);
        expect(onstatechange).toHaveBeenCalledTimes(1);
        expect(riveConfig).not.toHaveProperty('onloop');
        expect(riveConfig).not.toHaveProperty('onstatechange');
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
    inspectionMetadata = null,
    renderSurfaceMode = false,
    vmHierarchy = null,
} = {}) {
    delete window.__ravRenderSurfaceCanonical;
    window.__ravRenderSurfaceTarget = {};
    if (deferCanonicalUntilActivation) window.__ravRenderSurfaceDefersCanonical = true;
    else delete window.__ravRenderSurfaceDefersCanonical;
    const emitted = [];
    window.__ravRenderSurfaceEmit = (event, payload) => emitted.push({ event, payload });
    const build = new Function('riveInstance', 'CONTROL_SELECTION_KEYS', 'CONTROL_SNAPSHOT', 'VM_HIERARCHY', 'IS_RENDER_SURFACE_MODE', 'IMAGE_RUNTIME', 'INSPECTION_METADATA', `
        const CONFIG = { artboardName: null, viewModelInstanceName: null, runtimeVersion: '2.41.1' };
        ${runtimeCompatibilitySource}
        const runtimeCompatibility = createRiveRuntimeCompatibility();
        runtimeCompatibility.setInspectionMetadata(riveInstance, INSPECTION_METADATA);
        const isRenderSurfaceMode = IS_RENDER_SURFACE_MODE;
        const VM_CONTROL_SYNC_INTERVAL_MS = 120;
        const VM_TOPOLOGY_SYNC_INTERVAL_MS = 1000;
        const VM_CONTROL_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color', 'image', 'trigger']);
        let vmControlBindings = [];
        let vmControlSyncTimer = null;
        let vmListTopologySignature = null;
        let pendingControlSnapshot = new Map();
        let currentControlSnapshot = CONTROL_SNAPSHOT;
        let pendingRenderSurfaceReset = null;
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
            if (descriptor.source === 'global-view-model') {
                return 'gvm:' + encodeURIComponent(descriptor.globalViewModelName || '') + ':'
                    + (descriptor.path || '') + ':' + (descriptor.kind || '');
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
            if (trimmed.startsWith('gvm:')) {
                const firstSeparator = trimmed.indexOf(':', 4);
                const kindSeparator = trimmed.lastIndexOf(':');
                if (firstSeparator <= 4 || kindSeparator <= firstSeparator) return trimmed || null;
                const path = trimmed.slice(firstSeparator + 1, kindSeparator)
                    .split('/')
                    .map((segment) => /^(0|[1-9]\\d*)$/.test(segment) ? '*' : segment)
                    .join('/');
                return trimmed.slice(0, firstSeparator + 1) + path + ':' + trimmed.slice(kindSeparator + 1);
            }
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
        ${frameClockSource}
        ${firstFrameSource}
        ${resetContractSource}
        // Match the loader's onAdvance revision; never advance from a host RAF alone.
        if (riveInstance) riveInstance.onAdvance = () => { renderSurfaceAdvanceRevision += 1; };
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
            vmListTopologySignature = buildAllVmTopologySignature();
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
            captureRenderSurfaceControlsHierarchy: () => captureRenderSurfaceControlsHierarchy(getRenderSurfaceBridgeState()),
            fireStateMachineTriggerByName,
            filterHierarchyNode,
            formatVmListItemLabel,
            getRenderSurfaceObserverDiagnostics,
            initializeTopology: () => {
                vmListTopologySignature = buildAllVmTopologySignature();
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
            runtime: riveInstance,
            setPendingReset: (pending) => { pendingRenderSurfaceReset = pending; },
            settleRenderSurfaceResetAfterPresentation,
            waitForRenderSurfaceImagePresentation,
            restoreRenderSurfaceImageSnapshot,
            resolveStateMachineInputAccessor,
            scheduleRenderSurfaceCanonicalRefresh,
            scheduleRenderSurfaceInitialCanonicalState,
            scrubRenderSurfaceTimeline,
            setRenderSurfaceTarget: setRenderSurfacePlaybackTarget,
            renderedHierarchy: () => renderedHierarchy,
            topologyRenderCount: () => topologyRenderCount,
        };
    `);
    return { ...build(installFrameRuntime(riveInstance), controlSelectionKeys, controlSnapshot, vmHierarchy, renderSurfaceMode, imageRuntime, inspectionMetadata), emitted };
}

const resetContractRuntimePreamble = `
    const CONFIG = { runtimeVersion: '2.41.1' };
    ${runtimeCompatibilitySource}
    const runtimeCompatibility = createRiveRuntimeCompatibility();
`;

function createResetContractHelpers() {
    return new Function(`${resetContractRuntimePreamble}\n${resetContractSource}; return {
        buildRenderSurfaceResetContract,
        restartRenderSurfacePlaybackAfterReset,
    };`)();
}

// A runtime boundary double: the production clock owns fencing and zero-delta
// advancement, while draw invokes the same onAdvance hook wired by rive-loader.
function createFrameRuntime(overrides = {}) {
    const order = [];
    const deltas = [];
    const player = {
        loaded: true,
        artboard: {},
        isPlaying: false,
        frameCount: 0,
        drawOptimization: 'drawOnChanged',
        order,
        deltas,
        stopRendering: vi.fn(() => order.push('stop')),
        startRendering: vi.fn(() => order.push('start')),
        play: vi.fn(),
        runtime: { resolveAnimationFrame: vi.fn(() => order.push('flush')) },
        draw: vi.fn(function (time) {
            order.push('draw');
            deltas.push((time - this.lastRenderTime) / 1000);
            this.frameCount++;
            this.onAdvance?.();
        }),
    };
    // Preserve accessor descriptors, including poison .contents getters.
    return Object.defineProperties(player, Object.getOwnPropertyDescriptors(overrides));
}

function installFrameRuntime(player) {
    if (!player) return player;
    const defaults = createFrameRuntime();
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(defaults))) {
        if (!(key in player)) Object.defineProperty(player, key, descriptor);
    }
    return player;
}

async function drainMicrotasks() {
    for (let i = 0; i < 16; i++) await Promise.resolve();
}

async function presentFrame(frames) {
    expect(frames.length).toBeGreaterThan(0);
    frames.shift()();
    await drainMicrotasks();
}

function queuePresentationFrames() {
    const frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
    });
    return frames;
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
            await drainMicrotasks();
            if (frames.length) await presentFrame(frames);
        }
        if (!settled) throw new Error('Image task did not settle after explicit runtime draws.');
        if (rejected) throw rejected;
        return result;
    } finally {
        window.requestAnimationFrame = previousRaf;
    }
}

function createPresentationHarness(runtime, hostWindow = window, hostDocument = document) {
    return new Function('riveInstance', 'window', 'document', `
        ${frameClockSource}
        ${firstFrameSource}
        return waitForRenderSurfacePresentationFrames;
    `)(runtime, hostWindow, hostDocument);
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
        const helpers = createResetContractHelpers();
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
        const helpers = createResetContractHelpers();
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
        const helpers = createResetContractHelpers();
        const runtime = { play: vi.fn() };

        expect(helpers.restartRenderSurfacePlaybackAfterReset(runtime, {
            animations: 'Timeline',
            autoplay: true,
        })).toEqual({ names: ['Timeline'], restarted: true });
        expect(runtime.play).toHaveBeenCalledWith('Timeline');
    });

    it('does not restart playback when the reset contract disables autoplay', () => {
        const helpers = createResetContractHelpers();
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
        expect(imageResetSource.indexOf('applyControlSnapshot(snapshot);', presentationStart))
            .toBeLessThan(imageResetSource.indexOf('await restoreRenderSurfaceImageSnapshot({ pruneFailures: false });', presentationStart));
        expect(imageResetSource.indexOf('await restoreRenderSurfaceImageSnapshot({ pruneFailures: false });', presentationStart))
            .toBeLessThan(imageResetSource.indexOf('restartRenderSurfacePlaybackAfterReset(', presentationStart));
        expect(imageResetSource.indexOf('restartRenderSurfacePlaybackAfterReset(', presentationStart))
            .toBeLessThan(imageResetSource.indexOf('pendingReset.resolve({'));
        expect(bootstrapSource).toContain('return applyRenderSurfaceImageCommand(imageDescriptor, true);');
    });

    it('replays child-owned image set and clear state before a reset can acknowledge', async () => {
        const avatar = { value: null };
        const decodedImages = [];
        const harness = createDemoVmHarness({
            viewModelInstance: { image: (name) => name === 'avatar' ? avatar : null, properties: [{ name: 'avatar' }] },
        }, {
            imageRuntime: { decodeImage: vi.fn(async (bytes) => {
                const image = { bytes: [...bytes], unref: vi.fn() };
                decodedImages.push(image);
                return image;
            }) },
        });
        const imageBytes = validPngBytes(1);
        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({ path: 'avatar', value: imageBytes }, true));
        avatar.value = null; // Reset recreates the accessor value.
        await withRendererAdvance(harness, () => harness.restoreRenderSurfaceImageSnapshot());
        expect(avatar.value).toBe(decodedImages[1]);
        expect(decodedImages[1].bytes).toEqual(imageBytes);
        expect(decodedImages.every((image) => image.unref.mock.calls.length === 1)).toBe(true);

        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({ action: 'clear-image', path: 'avatar', value: null }, true));
        avatar.value = { stale: true };
        await withRendererAdvance(harness, () => harness.restoreRenderSurfaceImageSnapshot());
        expect(avatar.value).toBeNull();
        expect(harness.runtime.draw).toHaveBeenCalledTimes(4);
        expect(harness.runtime.runtime.resolveAnimationFrame).toHaveBeenCalledTimes(4);
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
        const frames = queuePresentationFrames();
        const enabled = { value: false };
        const harness = createDemoVmHarness({ viewModelInstance: {
            boolean: (name) => name === 'enabled' ? enabled : null, properties: [{ name: 'enabled' }],
        } });
        const pendingReset = {
            params: { animations: 'Timeline', autoplay: true },
            reject: vi.fn(),
            resolve: vi.fn(),
            snapshot: [{ descriptor: { kind: 'boolean', path: 'enabled' }, kind: 'boolean', value: true }],
        };
        harness.setPendingReset(pendingReset);
        harness.settleRenderSurfaceResetAfterPresentation(pendingReset);
        harness.settleRenderSurfaceResetAfterPresentation(pendingReset);
        await drainMicrotasks();
        expect(enabled.value).toBe(true);
        expect(harness.runtime.startRendering).toHaveBeenCalledTimes(1);
        expect(harness.runtime.play).not.toHaveBeenCalled();
        expect(frames).toHaveLength(1);
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        await presentFrame(frames);
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        expect(harness.runtime.runtime.resolveAnimationFrame).toHaveBeenCalledTimes(1);
        await presentFrame(frames);
        expect(pendingReset.reject).not.toHaveBeenCalled();
        expect(pendingReset.resolve).toHaveBeenCalledExactlyOnceWith({
            pending: 0, playbackRestart: { names: ['Timeline'], restarted: true },
            presentationFrames: 2, reset: true, restored: 1, rendered: true, presented: !document.hidden,
        });
        expect(harness.runtime.deltas).toEqual([0, 0]);
        expect(harness.runtime.runtime.resolveAnimationFrame).toHaveBeenCalledTimes(2);
        expect(harness.emitted).toEqual([]);
        expect(renderSurfaceBridgeSource).toContain("commandType === 'reset'");
        expect(renderSurfaceBridgeSource).toContain("scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true)");
    });

    it('rejects reset restoration with unresolved runtime-list rows and clears their stale snapshot', async () => {
        const frames = queuePresentationFrames();
        const rows = [];
        const harness = createDemoVmHarness({ viewModelInstance: {
            list: (name) => name === 'rows' ? { get length() { return rows.length; }, instanceAt: (i) => rows[i] || null } : null,
            properties: [{ name: 'rows' }],
        } });
        const pendingReset = {
            params: { animations: 'Timeline', autoplay: true },
            reject: vi.fn(), resolve: vi.fn(),
            snapshot: [{ descriptor: { kind: 'string', path: 'rows/0/title' }, kind: 'string', value: 'old row' }],
        };
        harness.setPendingReset(pendingReset);
        harness.settleRenderSurfaceResetAfterPresentation(pendingReset);
        await drainMicrotasks();
        expect(harness.pendingCount()).toBe(1);
        await presentFrame(frames);
        expect(pendingReset.reject).not.toHaveBeenCalled();
        await presentFrame(frames);
        expect(pendingReset.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            message: 'Playback reset could not restore 1 control value.',
        }));
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        expect(harness.pendingCount()).toBe(0);
        const title = { value: 'new row' };
        rows.push({ string: (name) => name === 'title' ? title : null, properties: [{ name: 'title' }] });
        expect(harness.retryPendingControlSnapshot()).toBe(0);
        expect(title.value).toBe('new row');
    });

    it('restores a runtime-generated list image that appears after reset starts advancing', async () => {
        const rows = [];
        const decoded = [];
        const row = () => ({ value: null });
        let createRowOnDraw = false;
        const runtime = createFrameRuntime({ viewModelInstance: {
            list: (name) => name === 'rows' ? {
                get length() { return rows.length; },
                instanceAt: (i) => rows[i] ? { image: () => rows[i], properties: [{ name: 'avatar' }] } : null,
            } : null,
            properties: [{ name: 'rows' }],
        } });
        const draw = runtime.draw;
        runtime.draw = vi.fn(function (time) {
            draw.call(this, time);
            if (createRowOnDraw && !rows.length) rows.push(row());
        });
        const harness = createDemoVmHarness(runtime, { imageRuntime: {
            decodeImage: vi.fn(async (bytes) => {
                const image = { bytes: [...bytes], unref: vi.fn() };
                decoded.push(image);
                return image;
            }),
        } });
        const descriptor = { kind: 'image', name: 'avatar', path: 'rows/0/avatar', source: 'view-model' };
        rows.push(row());
        const bytes = validPngBytes(4);
        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand({ ...descriptor, value: bytes }, true));
        const frames = queuePresentationFrames();
        rows.length = 0;
        createRowOnDraw = true;
        const pendingReset = { params: { animations: 'Timeline', autoplay: true }, reject: vi.fn(), resolve: vi.fn(), snapshot: [] };
        harness.setPendingReset(pendingReset);
        harness.settleRenderSurfaceResetAfterPresentation(pendingReset);
        await drainMicrotasks();
        expect(rows).toHaveLength(0);
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBe(true);
        await presentFrame(frames);
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBeNull();
        await presentFrame(frames);
        expect(rows[0].value?.bytes).toEqual(bytes);
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        expect(decoded[1].unref).not.toHaveBeenCalled();
        await presentFrame(frames); // The final image restore must itself draw and flush.
        expect(pendingReset.reject).not.toHaveBeenCalled();
        expect(pendingReset.resolve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reset: true }));
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBe(true);
        expect(decoded).toHaveLength(2);
        expect(decoded[1].unref).toHaveBeenCalledOnce();
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

    it('waits for two real zero-delta draws and flushes before prepare-frame can ACK', async () => {
        const frames = queuePresentationFrames();
        const runtime = createFrameRuntime({ isPlaying: true });
        const waitForFrames = createPresentationHarness(runtime);
        let settled = false;
        const pending = waitForFrames(2).then((result) => { settled = true; return result; });
        expect(frames).toHaveLength(1);
        expect(runtime.draw).not.toHaveBeenCalled();
        await presentFrame(frames);
        expect(settled).toBe(false);
        expect(runtime.order).toEqual(['stop', 'draw', 'flush', 'stop', 'start']);
        await presentFrame(frames);
        await expect(pending).resolves.toEqual({
            frames: 2, rendered: true, presented: !document.hidden, timerFallbacks: 0, verifiedBy: 'runtime-draw-flush',
        });
        expect(runtime.deltas).toEqual([0, 0]);
        expect(runtime.runtime.resolveAnimationFrame).toHaveBeenCalledTimes(2);
        expect(runtime.drawOptimization).toBe('drawOnChanged');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds both prepare-frame draws at 150ms when a hidden WebView starves RAF without claiming presentation', async () => {
        const frames = queuePresentationFrames();
        const cancel = vi.spyOn(window, 'cancelAnimationFrame');
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        const runtime = createFrameRuntime();
        const waitForFrames = createPresentationHarness(runtime);
        let settled = false;
        const pending = waitForFrames(2).then((result) => { settled = true; return result; });
        await vi.advanceTimersByTimeAsync(149);
        expect(runtime.draw).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toBe(false);
        expect(runtime.draw).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(149);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toEqual({
            frames: 2, rendered: true, presented: false, timerFallbacks: 2, verifiedBy: 'runtime-draw-flush',
        });
        expect(cancel.mock.calls).toEqual([[1], [2]]);
        expect(runtime.deltas).toEqual([0, 0]);
        expect(runtime.runtime.resolveAnimationFrame).toHaveBeenCalledTimes(2);
        frames.forEach((callback) => callback());
        await drainMicrotasks();
        expect(runtime.draw).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not acknowledge an image mutation or release its decode until that exact mutation has drawn and flushed', async () => {
        const frames = queuePresentationFrames();
        const order = [];
        const imageOne = { unref: vi.fn(() => order.push('release:1')) };
        const imageTwo = { unref: vi.fn(() => order.push('release:2')) };
        const accessors = { image1: { value: null }, image2: { value: null } };
        let expectedImage;
        let currentAccessor;
        const runtime = createFrameRuntime({
            viewModelInstance: { image: (name) => accessors[name] || null, properties: [{ name: 'image1' }, { name: 'image2' }] },
            runtime: { resolveAnimationFrame: vi.fn(() => {
                expect(currentAccessor.value).toBe(expectedImage);
                expect(expectedImage.unref).not.toHaveBeenCalled();
                order.push('flush');
            }) },
        });
        const draw = runtime.draw;
        runtime.draw = vi.fn(function (time) {
            expect(currentAccessor.value).toBe(expectedImage);
            expect(expectedImage.unref).not.toHaveBeenCalled();
            order.push('draw');
            draw.call(this, time);
        });
        const harness = createDemoVmHarness(runtime, {
            imageRuntime: { decodeImage: vi.fn().mockResolvedValueOnce(imageOne).mockResolvedValueOnce(imageTwo) },
            renderSurfaceMode: true,
        });
        for (const [index, image] of [imageOne, imageTwo].entries()) {
            expectedImage = image;
            currentAccessor = accessors['image' + (index + 1)];
            const descriptor = { action: 'set-image', kind: 'image', path: 'image' + (index + 1), source: 'view-model', value: validPngBytes(index) };
            const pending = harness.applyRenderSurfaceImageCommand(descriptor, true).then((result) => {
                order.push('ack:' + (index + 1));
                return result;
            });
            await drainMicrotasks();
            expect(currentAccessor.value).toBe(image);
            expect(image.unref).not.toHaveBeenCalled();
            expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBeNull();
            expect(frames).toHaveLength(1);
            await presentFrame(frames);
            await expect(pending).resolves.toEqual(expect.objectContaining({ imageApplied: true, presentation: expect.objectContaining({ rendered: true, rendererAdvanced: true }) }));
            expect(image.unref).toHaveBeenCalledOnce();
            expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBe(true);
        }
        expect(accessors.image1.value).toBe(imageOne);
        expect(accessors.image2.value).toBe(imageTwo);
        expect(order).toEqual(['draw', 'flush', 'release:1', 'ack:1', 'draw', 'flush', 'release:2', 'ack:2']);
    });

    it('rejects a failed image draw on the 150ms fallback, releases its decode, and never journals success', async () => {
        const frames = queuePresentationFrames();
        const image = { unref: vi.fn() };
        const accessor = { value: null };
        const harness = createDemoVmHarness({
            viewModelInstance: { image: () => accessor, properties: [{ name: 'avatar' }] },
            draw: vi.fn(() => { throw new Error('GPU lost'); }),
        }, { imageRuntime: { decodeImage: vi.fn().mockResolvedValue(image) }, renderSurfaceMode: true });
        const descriptor = { action: 'set-image', kind: 'image', path: 'avatar', source: 'view-model', value: validPngBytes(7) };
        const rejected = vi.fn();
        const pending = harness.applyRenderSurfaceImageCommand(descriptor, true).catch(rejected);
        await drainMicrotasks();
        await vi.advanceTimersByTimeAsync(149);
        expect(rejected).not.toHaveBeenCalled();
        expect(image.unref).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(rejected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'GPU lost' }));
        expect(image.unref).toHaveBeenCalledOnce();
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBeNull();
        expect(harness.runtime.runtime.resolveAnimationFrame).not.toHaveBeenCalled();
        expect(harness.runtime.drawOptimization).toBe('drawOnChanged');
        expect(harness.runtime.stopRendering).toHaveBeenCalledTimes(2);
        await presentFrame(frames); // A late RAF after the timer rejection is inert.
        expect(harness.runtime.draw).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps a hidden reset pending through deferred restore, zero-delta flushes, and final image pruning', async () => {
        const slots = { stale: { value: null }, good: { value: null } };
        const decoded = [];
        const decodeImage = vi.fn(async () => {
            const image = { unref: vi.fn() };
            decoded.push(image);
            return image;
        });
        const harness = createDemoVmHarness({ viewModelInstance: {
            image: (name) => slots[name] || null,
            properties: [{ name: 'stale' }, { name: 'good' }],
        } }, { imageRuntime: { decodeImage } });
        const stale = { kind: 'image', path: 'stale', value: validPngBytes(1) };
        const good = { kind: 'image', path: 'good', value: validPngBytes(2) };
        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand(stale, true));
        await withRendererAdvance(harness, () => harness.applyRenderSurfaceImageCommand(good, true));
        delete slots.stale;
        slots.good.value = null;
        harness.runtime.order.length = 0;
        harness.runtime.deltas.length = 0;
        const frames = queuePresentationFrames();
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        let finishDecode;
        decodeImage.mockImplementationOnce(() => new Promise((resolve) => { finishDecode = resolve; }));
        const pendingReset = { params: { animations: 'Timeline', autoplay: true }, snapshot: [], resolve: vi.fn(), reject: vi.fn() };
        harness.setPendingReset(pendingReset);
        harness.settleRenderSurfaceResetAfterPresentation(pendingReset);
        await drainMicrotasks();
        await vi.advanceTimersByTimeAsync(600);
        // A pending restore cannot be replaced by elapsed wall time or a fabricated frame receipt.
        expect(finishDecode).toBeTypeOf('function');
        expect(harness.runtime.order).toEqual([]);
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        expect(pendingReset.reject).not.toHaveBeenCalled();
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(stale)).toBe(true);
        const restored = { unref: vi.fn() };
        finishDecode(restored);
        await drainMicrotasks();
        expect(slots.good.value).toBe(restored);
        expect(restored.unref).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(149);
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1); // First image restore draws and releases.
        expect(restored.unref).toHaveBeenCalledOnce();
        expect(harness.runtime.deltas).toEqual([0]);
        await vi.advanceTimersByTimeAsync(300); // Reset's two draws complete, then final pruning/restore starts.
        expect(harness.runtime.deltas).toEqual([0, 0, 0]);
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(stale)).toBeNull();
        expect(slots.good.value).toBe(decoded[2]);
        expect(decoded[2].unref).not.toHaveBeenCalled();
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(150); // Final restore has its own draw/flush before ACK.
        expect(decoded[2].unref).toHaveBeenCalledOnce();
        expect(pendingReset.reject).not.toHaveBeenCalled();
        expect(pendingReset.resolve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            pending: 0, reset: true, rendered: true, presented: false, presentationFrames: 2,
        }));
        expect(harness.runtime.deltas).toEqual([0, 0, 0, 0]);
        expect(harness.runtime.order.filter((event) => event === 'flush')).toHaveLength(4);
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(good)).toBe(true);
        frames.forEach((callback) => callback());
        await drainMicrotasks();
        expect(harness.runtime.deltas).toHaveLength(4);
    });

    it.each(['RAF', 'timer'])('rejects reset on a failed %s draw without an ACK or extra scheduled draw', async (wake) => {
        const frames = queuePresentationFrames();
        const harness = createDemoVmHarness({ draw: vi.fn(() => { throw new Error('reset GPU failure'); }) });
        const pendingReset = { params: { autoplay: false }, snapshot: [], resolve: vi.fn(), reject: vi.fn() };
        harness.setPendingReset(pendingReset);
        harness.settleRenderSurfaceResetAfterPresentation(pendingReset);
        await drainMicrotasks();
        if (wake === 'RAF') await presentFrame(frames);
        else await vi.advanceTimersByTimeAsync(150);
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        expect(pendingReset.reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'reset GPU failure' }));
        expect(harness.runtime.runtime.resolveAnimationFrame).not.toHaveBeenCalled();
        expect(harness.runtime.drawOptimization).toBe('drawOnChanged');
        expect(harness.pendingCount()).toBe(0);
        frames.forEach((callback) => callback());
        await vi.advanceTimersByTimeAsync(500);
        expect(harness.runtime.draw).toHaveBeenCalledOnce();
    });

    it('rejects an image frame that draws and flushes without an onAdvance receipt', async () => {
        const frames = queuePresentationFrames();
        const image = { unref: vi.fn() };
        const accessor = { value: null };
        const harness = createDemoVmHarness({
            draw: vi.fn(), // Simulate a renderer that never invokes onAdvance.
            viewModelInstance: { image: () => accessor },
        }, { imageRuntime: { decodeImage: vi.fn().mockResolvedValue(image) } });
        const descriptor = { kind: 'image', path: 'avatar', value: validPngBytes(1) };
        const outcome = harness.applyRenderSurfaceImageCommand(descriptor, true).then(
            (value) => ({ value }), (error) => ({ error }),
        );
        await drainMicrotasks();
        await presentFrame(frames);
        expect(await outcome).toEqual({ error: expect.objectContaining({ message: 'Image mutation did not advance in the renderer.' }) });
        expect(harness.runtime.runtime.resolveAnimationFrame).toHaveBeenCalledOnce();
        expect(image.unref).toHaveBeenCalledOnce();
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBeNull();
    });

    it('releases a decoded image if assigning it to the runtime accessor fails', async () => {
        const image = { unref: vi.fn() };
        const accessor = { set value(_) { throw new Error('accessor was invalidated'); }, get value() { return null; } };
        const harness = createDemoVmHarness({ viewModelInstance: { image: () => accessor } }, {
            imageRuntime: { decodeImage: vi.fn().mockResolvedValue(image) },
        });
        const descriptor = { kind: 'image', path: 'avatar', value: validPngBytes(1) };
        await expect(harness.applyRenderSurfaceImageCommand(descriptor, true)).rejects.toThrow('accessor was invalidated');
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBeNull();
        expect(harness.runtime.draw).not.toHaveBeenCalled();
        expect(image.unref).toHaveBeenCalledOnce();
    });

    it('does not count an advance before decoding finishes as an advance of the assigned image', async () => {
        const frames = queuePresentationFrames();
        const image = { unref: vi.fn() };
        const accessor = { value: null };
        let finishDecode;
        const harness = createDemoVmHarness({
            viewModelInstance: { image: () => accessor },
        }, { imageRuntime: { decodeImage: vi.fn(() => new Promise((resolve) => { finishDecode = resolve; })) } });
        const descriptor = { kind: 'image', path: 'avatar', value: validPngBytes(1) };
        const outcome = harness.applyRenderSurfaceImageCommand(descriptor, true).then(
            (value) => ({ value }), (error) => ({ error }),
        );
        const precedingFrame = createPresentationHarness(harness.runtime)(1);
        await presentFrame(frames); // An unrelated real draw/flush while decode is still pending.
        await precedingFrame;
        harness.runtime.draw = vi.fn(); // The image's own fence draws but never advances.
        finishDecode(image);
        await drainMicrotasks();
        expect(accessor.value).toBe(image);
        await presentFrame(frames);
        expect(await outcome).toEqual({ error: expect.objectContaining({ message: 'Image mutation did not advance in the renderer.' }) });
        expect(harness.readAcknowledgedRenderSurfaceImagePresence(descriptor)).toBeNull();
        expect(image.unref).toHaveBeenCalledOnce();
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
        expect(riveLoaderSource).toContain('resolveStandalonePlaybackConfig(CONFIG, appliedEditorConfig)');
        expect(playbackLayoutSource).toContain('var payloadPlaybackSelected = payloadStateMachines.length > 0 || payloadAnimations.length > 0;');
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

    it('falls back when animation frames and idle callbacks starve and publishes one initial snapshot', () => {
        const frames = [];
        const idleTasks = [];
        const timers = [];
        let nextTimerId = 1;
        const previousRaf = window.requestAnimationFrame;
        const previousIdle = window.requestIdleCallback;
        const previousSetTimeout = window.setTimeout;
        const previousClearTimeout = window.clearTimeout;
        window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
        window.requestIdleCallback = (callback, options) => {
            idleTasks.push({ callback, options });
            return idleTasks.length;
        };
        window.setTimeout = (callback, delay) => {
            const timer = { callback, cancelled: false, delay, id: nextTimerId, ran: false };
            nextTimerId += 1;
            timers.push(timer);
            return timer.id;
        };
        window.clearTimeout = (id) => {
            const timer = timers.find((candidate) => candidate.id === id);
            if (timer) timer.cancelled = true;
        };
        const runTimer = (delay) => {
            const timer = timers.find((candidate) => (
                candidate.delay === delay && !candidate.cancelled && !candidate.ran
            ));
            expect(timer).toBeDefined();
            timer.ran = true;
            timer.callback();
        };
        try {
            const root = {
                number: (name) => (name === 'speed' ? { value: 42 } : null),
                properties: [{ name: 'speed' }],
            };
            const harness = createDemoVmHarness({
                artboard: { name: 'Fallback' },
                stateMachineNames: [],
                viewModelInstance: root,
            }, { deferCanonicalUntilActivation: true, renderSurfaceMode: true });

            harness.publishRenderSurfaceCanonicalState(true, 'load');
            expect(harness.scheduleRenderSurfaceInitialCanonicalState()).toBe(true);
            expect(frames).toHaveLength(1);
            expect(idleTasks).toHaveLength(0);

            // A hidden staged WebView never presents its requested frame. The
            // independent frame-stage timer must still install the idle work.
            runTimer(250);
            expect(idleTasks).toHaveLength(1);

            // The same WebView can also withhold idle callbacks. Its second
            // bounded fallback must publish exactly one complete snapshot.
            runTimer(1000);
            expect(harness.emitted.map(({ payload }) => payload.reason)).toEqual(['load', 'activation']);

            // Late frame and idle callbacks share once guards and cannot emit a
            // duplicate canonical state.
            frames.shift()();
            idleTasks.shift().callback();
            expect(harness.emitted.map(({ payload }) => payload.reason)).toEqual(['load', 'activation']);

            expect(harness.scheduleRenderSurfaceCanonicalRefresh('fallback-refresh', true)).toBe(true);
            frames.shift()();
            expect(idleTasks).toHaveLength(1);
            runTimer(1000);
            expect(harness.emitted.map(({ payload }) => payload.reason)).toEqual([
                'load', 'activation', 'fallback-refresh',
            ]);
            idleTasks.shift().callback();
            expect(harness.emitted.map(({ payload }) => payload.reason)).toEqual([
                'load', 'activation', 'fallback-refresh',
            ]);
        } finally {
            if (typeof previousRaf === 'function') window.requestAnimationFrame = previousRaf;
            else delete window.requestAnimationFrame;
            if (typeof previousIdle === 'function') window.requestIdleCallback = previousIdle;
            else delete window.requestIdleCallback;
            window.setTimeout = previousSetTimeout;
            window.clearTimeout = previousClearTimeout;
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

    it('scrubs the selected child timeline and returns an O(1) canonical playback delta', () => {
        const createWrapper = () => ({
            animation: { duration: 60, fps: 60 },
            name: 'Intro',
            playing: false,
            time: 0,
        });
        const riveInstance = {
            animator: { animations: [] },
            isPlaying: false,
            pause: vi.fn((name) => {
                expect(name).toBe('Intro');
                riveInstance.animator.animations.push(createWrapper());
            }),
            playingAnimationNames: [],
            playingStateMachineNames: [],
            scrub: vi.fn((name, seconds) => {
                expect(name).toBe('Intro');
                riveInstance.animator.animations.at(-1).time = seconds;
            }),
        };
        const harness = createDemoVmHarness(riveInstance, { renderSurfaceMode: true });
        harness.setRenderSurfaceTarget({ name: 'Intro', type: 'animation' });

        expect(harness.scrubRenderSurfaceTimeline({ name: 'Intro', seconds: 0.75 })).toEqual({
            currentFrame: 45,
            currentSeconds: 0.75,
            name: 'Intro',
            totalFrames: 60,
            totalSeconds: 1,
        });
        expect(riveInstance.pause).toHaveBeenCalledOnce();
        expect(riveInstance.scrub).toHaveBeenCalledWith('Intro', 0.75);

        const delta = harness.captureRenderSurfaceCommandCanonicalDelta(
            { payload: { name: 'Intro', seconds: 0.75 }, type: 'scrub' },
            { name: 'Intro' },
        );
        expect(delta).toEqual(expect.objectContaining({
            controlChanges: [],
            playback: expect.objectContaining({
                currentFrame: 45,
                currentSeconds: 0.75,
                name: 'Intro',
                totalFrames: 60,
                totalSeconds: 1,
                type: 'animation',
            }),
            reason: 'command:scrub',
            stateType: 'delta',
        }));
        expect(delta).not.toHaveProperty('controlsHierarchy');
        expect(bootstrapSource).toContain("if (type === 'scrub') return scrubRenderSurfaceTimeline(payload);");
    });

    it('rejects timeline scrubbing when the acknowledged target is a state machine', () => {
        const harness = createDemoVmHarness({ scrub: vi.fn() }, { renderSurfaceMode: true });
        harness.setRenderSurfaceTarget({ name: 'MainSM', type: 'stateMachine' });
        expect(() => harness.scrubRenderSurfaceTimeline({ name: 'MainSM', seconds: 1 }))
            .toThrow('Timeline scrubbing requires an active linear animation.');
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
        expect(harness.emitted.at(-1)).toEqual({
            event: 'render-surface:timeline',
            payload: expect.objectContaining({
                advanceRevision: 0,
                currentFrame: 45,
                currentSeconds: 0.75,
                playbackName: 'Focus Fullscreen Mode',
                playbackType: 'animation',
                totalFrames: 60,
            }),
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
        const frames = queuePresentationFrames();
        const active = { animation: { duration: 60, fps: 60 }, name: 'Focus Fullscreen Mode', playing: true, time: 0 };
        const runtime = {
            artboard: { name: 'TrackMap' }, animator: { animations: [active] }, isPlaying: true,
            playingAnimationNames: ['Focus Fullscreen Mode'], playingStateMachineNames: [], stateMachineNames: [],
            startRendering: vi.fn(() => {
                // Model the first playback tick separately from explicit zero-delta barrier draws.
                if (active.time === 0) window.requestAnimationFrame(() => { active.time += 0.25; });
            }),
            viewModelInstance: { properties: [] },
        };
        const harness = createDemoVmHarness(runtime, { renderSurfaceMode: true });
        const pendingReset = {
            params: { animations: 'Focus Fullscreen Mode', autoplay: true },
            resolve: vi.fn(), reject: vi.fn(), snapshot: [],
        };
        harness.setPendingReset(pendingReset);
        harness.settleRenderSurfaceResetAfterPresentation(pendingReset);
        await drainMicrotasks();
        expect(active.time).toBe(0);
        expect(frames).toHaveLength(2);
        await presentFrame(frames); // Authored playback resumes.
        await presentFrame(frames); // First explicit barrier draw.
        expect(pendingReset.resolve).not.toHaveBeenCalled();
        await presentFrame(frames); // Second explicit barrier draw.
        expect(active.time).toBe(0.25);
        expect(harness.runtime.deltas).toEqual([0, 0]);
        expect(pendingReset.reject).not.toHaveBeenCalled();
        expect(pendingReset.resolve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            playbackRestart: { names: ['Focus Fullscreen Mode'], restarted: true },
        }));
        harness.setRenderSurfaceTarget({ name: 'Focus Fullscreen Mode', type: 'animation' });
        const resetAckDelta = harness.captureRenderSurfaceCommandCanonicalDelta(
            { payload: {}, type: 'reset' }, pendingReset.resolve.mock.calls[0][0],
        );
        expect(resetAckDelta).toEqual(expect.objectContaining({
            artboard: 'TrackMap', controlChanges: [],
            playback: expect.objectContaining({ currentSeconds: 0.25, name: 'Focus Fullscreen Mode', type: 'animation' }),
            reason: 'command:reset', stateType: 'delta',
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

    it('publishes late enum choices without changing the authored value or rebuilding topology', () => {
        const writes = vi.fn();
        const choices = [];
        const mode = { get value() { return 'line'; }, set value(value) { writes(value); }, values: choices };
        const harness = createDemoVmHarness({
            stateMachineNames: [],
            viewModelInstance: { properties: [{ name: 'mode' }], enum: (name) => name === 'mode' ? mode : null },
        }, { renderSurfaceMode: true });
        const initial = harness.publishRenderSurfaceCanonicalState(true, 'initial');
        expect(initial.controlsHierarchy.children[0].inputs[0]).toMatchObject({ value: 'line', values: [] });

        harness.observeRenderSurfaceControlBudget();
        expect(harness.publishRenderSurfaceCanonicalState(true, 'unchanged').controlChanges).toEqual([]);
        choices.push('bar', 'line');
        harness.observeRenderSurfaceControlBudget();
        const refreshed = harness.publishRenderSurfaceCanonicalState(true, 'late-choices');
        expect(refreshed.topologyRevision).toBe(initial.topologyRevision);
        expect(refreshed).not.toHaveProperty('controlsHierarchy');
        expect(refreshed.controlChanges).toEqual([{ key: 'vm:mode:enum', kind: 'enum', value: 'line', values: ['bar', 'line'] }]);
        // Captured choices must not alias the runtime's mutable array.
        choices.reverse();
        harness.observeRenderSurfaceControlBudget();
        expect(harness.publishRenderSurfaceCanonicalState(true, 'reorder').controlChanges[0].values).toEqual(['line', 'bar']);
        expect(refreshed.controlChanges[0].values).toEqual(['bar', 'line']);
        choices.length = 0;
        harness.observeRenderSurfaceControlBudget();
        expect(harness.publishRenderSurfaceCanonicalState(true, 'clear').controlChanges[0]).toMatchObject({ value: 'line', values: [] });
        harness.observeRenderSurfaceControlBudget();
        expect(harness.publishRenderSurfaceCanonicalState(true, 'settled').controlChanges).toEqual([]);
        expect(writes).not.toHaveBeenCalled();
    });

    it('retains late enum choices when a value change or command ACK supersedes a queued observation', () => {
        const mode = { value: 'line', values: [] };
        const descriptor = { kind: 'enum', name: 'mode', path: 'mode', source: 'view-model' };
        const harness = createDemoVmHarness({
            stateMachineNames: [],
            viewModelInstance: { properties: [{ name: 'mode' }], enum: (name) => name === 'mode' ? mode : null },
        }, { renderSurfaceMode: true });
        harness.publishRenderSurfaceCanonicalState(true, 'initial');
        mode.values = ['bar', 'line'];
        harness.observeRenderSurfaceControlBudget();
        mode.value = 'bar';
        harness.observeRenderSurfaceControlBudget();
        expect(harness.publishRenderSurfaceCanonicalState(true, 'coalesced').controlChanges).toEqual([
            { key: 'vm:mode:enum', kind: 'enum', value: 'bar', values: ['bar', 'line'] },
        ]);
        mode.values = ['bar', 'line', 'area'];
        harness.observeRenderSurfaceControlBudget();
        mode.value = 'area';
        const ack = harness.captureRenderSurfaceCommandCanonicalDelta({ type: 'vm-set', payload: { descriptor } }, { descriptor, value: 'area' });
        expect(ack.controlChanges).toEqual([
            { key: 'vm:mode:enum', kind: 'enum', value: 'area', values: ['bar', 'line', 'area'] },
        ]);
        harness.observeRenderSurfaceControlBudget();
        expect(harness.publishRenderSurfaceCanonicalState(true, 'after-ack').controlChanges).toEqual([]);
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

    it('rebuilds canonical hierarchy when a named global ViewModel list grows', () => {
        const rows = [];
        const list = {
            get length() { return rows.length; },
            instanceAt: (index) => rows[index] || null,
        };
        const theme = {
            list: (name) => (name === 'rows' ? list : null),
            properties: [{ name: 'rows' }],
        };
        const harness = createDemoVmHarness({
            globalViewModelInstance: (name) => (name === 'Theme' ? theme : null),
            globalViewModelNames() {
                if (arguments.length) throw new Error('globalViewModelNames takes no arguments');
                return ['Theme'];
            },
            stateMachineNames: [],
            viewModelInstance: { properties: [] },
        }, { renderSurfaceMode: true });

        expect(harness.publishRenderSurfaceCanonicalState(true, 'initial')).toEqual(expect.objectContaining({
            stateType: 'snapshot', topologyRevision: 1,
        }));

        const enabled = { value: false };
        rows.push({
            boolean: (name) => (name === 'enabled' ? enabled : null),
            properties: [{ name: 'enabled' }],
        });
        const refreshed = harness.publishRenderSurfaceCanonicalState(true, 'global-list-growth', true);
        const globalInput = refreshed.controlsHierarchy.children[0].children[0].children[0].children[0].inputs[0];
        expect(refreshed).toEqual(expect.objectContaining({ stateType: 'snapshot', topologyRevision: 2 }));
        expect(globalInput).toEqual(expect.objectContaining({
            globalViewModelName: 'Theme',
            path: 'rows/0/enabled',
            source: 'global-view-model',
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
        expect(startRendering).toHaveBeenCalledTimes(2);
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

        expect(JSON.parse(harness.initializeTopology()).root).toContain('["list","rows",0]');
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
