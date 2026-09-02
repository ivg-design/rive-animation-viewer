    (function () {
        'use strict';

        /* ── Configuration from Rust placeholders ────────────── */

        const CONFIG = JSON.parse('__CONFIG_JSON__');
        const VM_HIERARCHY = JSON.parse('__VM_HIERARCHY_JSON__');
        const runtimeCompatibility = createRiveRuntimeCompatibility();
        const CONTROL_SNAPSHOT = Array.isArray(CONFIG.controlSnapshot) ? CONFIG.controlSnapshot : [];
        const CONTROL_SELECTION_KEYS = Array.isArray(CONFIG.controlSelectionKeys)
            ? CONFIG.controlSelectionKeys
            : null;
        const INSTANTIATION_SNIPPETS = (CONFIG.instantiationSnippets && typeof CONFIG.instantiationSnippets === 'object')
            ? CONFIG.instantiationSnippets
            : {};
        const DEFAULT_CANVAS_COLOR = '__CANVAS_COLOR__' || '#0d1117';
        const TRANSPARENT_CANVAS_COLOR = 'transparent';
        const LAYOUT_STATE = (CONFIG.layoutState && typeof CONFIG.layoutState === 'object')
            ? CONFIG.layoutState
            : {};
        // The normal export remains a complete interactive demo. The embedded
        // renderer activates only when its native host explicitly adds this
        // query flag, so exported HTML opened in any browser is unchanged.
        const renderSurfaceParams = new URLSearchParams(window.location.search);
        const isRenderSurfaceMode = renderSurfaceParams.get('renderSurface') === '1';
        const renderSurfaceSessionId = renderSurfaceParams.get('renderSession') || null;

        const LAYOUT_FITS = ['cover', 'contain', 'fill', 'fitWidth', 'fitHeight', 'scaleDown', 'none', 'layout'];
        const LAYOUT_ALIGNMENTS = ['topLeft', 'topCenter', 'topRight', 'centerLeft', 'center', 'centerRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];
        const VM_CONTROL_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color', 'image', 'trigger']);
        const DEFAULT_CANVAS_SIZING = {
            mode: 'auto',
            width: 1280,
            height: 720,
            lockAspectRatio: false,
            aspectRatio: 1280 / 720,
        };
        const EVENT_LOG_LIMIT = 500;
        const VM_CONTROL_SYNC_INTERVAL_MS = 120;
        const VM_TOPOLOGY_SYNC_INTERVAL_MS = 1000;
        const VM_DEPTH_COLORS = ['#C4F82A', '#38BDF8', '#A78BFA', '#FB923C', '#F472B6', '#34D399'];
        const ALLOWED_CONTROL_KEYS = new Set(
            (CONTROL_SELECTION_KEYS || CONTROL_SNAPSHOT.map(function (entry) {
                return controlSelectionKeyForDescriptor(entry && entry.descriptor ? entry.descriptor : entry);
            }))
                .filter(function (key) { return typeof key === 'string'; })
                .map(function (key) { return normalizeControlSelectionKey(key); })
                .filter(Boolean)
        );
        let riveInstance = null;
        let currentControlSnapshot = JSON.parse(JSON.stringify(CONTROL_SNAPSHOT));
        let currentInstantiationPackageSource = CONFIG.defaultInstantiationPackageSource === 'local' ? 'local' : 'cdn';
        let currentLayoutAlignment = CONFIG.layoutAlignment || 'center';
        let currentLayoutFit = CONFIG.layoutFit || 'contain';
        let currentCanvasSizing = normalizeCanvasSizingState(CONFIG.canvasSizing, DEFAULT_CANVAS_SIZING);
        let lastSolidCanvasColor = normalizeCanvasColor(CONFIG.canvasColor) || DEFAULT_CANVAS_COLOR;
        let currentCanvasColor = CONFIG.canvasTransparent ? TRANSPARENT_CANVAS_COLOR : lastSolidCanvasColor;
        let isRightPanelVisible = typeof LAYOUT_STATE.rightPanelVisible === 'boolean'
            ? LAYOUT_STATE.rightPanelVisible
            : true;
        let errorTimeoutId = null;
        let canvasResizeObserver = null;
        const eventLogEntries = [];
        const eventFilterState = {
            native: typeof LAYOUT_STATE.eventFilters?.native === 'boolean' ? LAYOUT_STATE.eventFilters.native : true,
            riveUser: typeof LAYOUT_STATE.eventFilters?.riveUser === 'boolean' ? LAYOUT_STATE.eventFilters.riveUser : true,
            ui: typeof LAYOUT_STATE.eventFilters?.ui === 'boolean' ? LAYOUT_STATE.eventFilters.ui : true,
            search: typeof LAYOUT_STATE.eventFilters?.search === 'string' ? LAYOUT_STATE.eventFilters.search.toLowerCase() : '',
        };
        let eventLogSequence = 0;
        let riveEventUnsubscribers = [];
        let vmControlSyncTimer = null;
        let vmControlBindings = [];
        let vmListTopologySignature = null;
        let isRenderingVmControls = false;
        let pendingControlSnapshot = new Map();
        let pendingRenderSurfaceReset = null;
        let renderSurfaceUserCallbacksActive = !isRenderSurfaceMode;
        let pendingRenderSurfaceOnLoad = null;
        // The visible renderer alone owns live image bytes.  Retain a copied
        // command per image path so an in-place reset never asks the hidden
        // parent to decode or recreate those images.
        let renderSurfaceImageSnapshot = new Map();
        let renderSurfaceAdvanceRevision = 0;
        let lastFpsUpdate = 0;
        let frameCount = 0;
        let isFallbackFullscreenMode = false;
        let loadedRiveRuntime = null;
        const embeddedImageAssets = new Map();

        function controlSnapshotKeyForDescriptor(descriptor) {
            if (!descriptor) return null;
            if (descriptor.source === 'state-machine') {
                return 'sm:' + (descriptor.stateMachineName || '') + ':' + (descriptor.name || '') + ':' + (descriptor.kind || '');
            }
            if (descriptor.source === 'global-view-model') {
                return 'gvm:' + encodeURIComponent(descriptor.globalViewModelName || '') + ':' + (descriptor.path || '') + ':' + (descriptor.kind || '');
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
            var trimmed = key.trim();
            if (trimmed.indexOf('vm:') !== 0 && trimmed.indexOf('gvm:') !== 0) return trimmed || null;
            var kindSeparator = trimmed.lastIndexOf(':');
            var pathStart = trimmed.indexOf('gvm:') === 0 ? trimmed.indexOf(':', 4) + 1 : 3;
            if (kindSeparator <= pathStart) return trimmed || null;
            var path = trimmed.slice(pathStart, kindSeparator)
                .split('/')
                .map(function (segment) { return /^(0|[1-9]\d*)$/.test(segment) ? '*' : segment; })
                .join('/');
            return trimmed.slice(0, pathStart) + path + ':' + trimmed.slice(kindSeparator + 1);
        }

        function clampCanvasDimension(value, fallback) {
            var numeric = Number.parseInt(String(value == null ? '' : value).trim(), 10);
            if (!Number.isFinite(numeric)) {
                return fallback;
            }
            return Math.max(1, Math.min(8192, Math.round(numeric)));
        }

        function normalizeCanvasSizingState(raw, fallback) {
            var basis = fallback && typeof fallback === 'object' ? fallback : DEFAULT_CANVAS_SIZING;
            var width = clampCanvasDimension(raw && raw.width, basis.width);
            var height = clampCanvasDimension(raw && raw.height, basis.height);
            var aspectRatio = Number(raw && raw.aspectRatio);
            if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
                aspectRatio = width / height;
            }
            return {
                mode: raw && raw.mode === 'fixed' ? 'fixed' : 'auto',
                width: width,
                height: height,
                lockAspectRatio: Boolean(raw && raw.lockAspectRatio),
                aspectRatio: aspectRatio,
            };
        }

        function countHierarchyInputs(node) {
            if (!node) return 0;
            var total = Array.isArray(node.inputs) ? node.inputs.length : 0;
            if (Array.isArray(node.children)) {
                node.children.forEach(function (child) {
                    total += countHierarchyInputs(child);
                });
            }
            return total;
        }

        function readEmbeddedAssetField(asset, fieldName) {
            try {
                var value = asset && asset[fieldName];
                return typeof value === 'function' ? value.call(asset) : value;
            } catch (error) {
                return null;
            }
        }

        function copyEmbeddedAssetBytes(bytes) {
            if (bytes instanceof Uint8Array) return new Uint8Array(bytes);
            if (ArrayBuffer.isView(bytes)) {
                return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
            }
            if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes.slice(0));
            return null;
        }

        function embeddedBytesMatch(bytes, offset, signature) {
            return signature.every(function (value, index) { return bytes[offset + index] === value; });
        }

        function detectEmbeddedImageMimeType(bytes) {
            if (bytes && bytes.length >= 12 && embeddedBytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) {
                return 'image/png';
            }
            if (bytes && bytes.length >= 12
                && embeddedBytesMatch(bytes, 0, [0x52, 0x49, 0x46, 0x46])
                && embeddedBytesMatch(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
                return 'image/webp';
            }
            if (bytes && bytes.length >= 3 && embeddedBytesMatch(bytes, 0, [0xff, 0xd8, 0xff])) {
                return 'image/jpeg';
            }
            if (bytes && bytes.length >= 12 && embeddedBytesMatch(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
                var brand = String.fromCharCode.apply(null, bytes.slice(8, 12));
                if (brand === 'avif' || brand === 'avis') return 'image/avif';
            }
            return 'application/octet-stream';
        }

        var anonymousEmbeddedImageSequence = 0;

        function captureEmbeddedImageAsset(asset, bytes) {
            var copiedBytes = copyEmbeddedAssetBytes(bytes);
            if (!readEmbeddedAssetField(asset, 'isImage') || !copiedBytes || !copiedBytes.length) return false;
            var name = String(readEmbeddedAssetField(asset, 'name') || '').trim();
            if (!name) return false;
            var uniqueFilename = String(readEmbeddedAssetField(asset, 'uniqueFilename') || '').trim();
            var assetId = String(readEmbeddedAssetField(asset, 'id') || '').trim();
            var key = uniqueFilename || assetId || 'anonymous-image-' + anonymousEmbeddedImageSequence++;
            embeddedImageAssets.set(key, {
                bytes: copiedBytes,
                extension: String(readEmbeddedAssetField(asset, 'fileExtension') || '').trim(),
                key: key,
                mimeType: detectEmbeddedImageMimeType(copiedBytes),
                name: name,
                uniqueFilename: uniqueFilename,
            });
            return true;
        }

        function getEmbeddedImageAssets() {
            var nameCounts = new Map();
            return Array.from(embeddedImageAssets.values()).map(function (entry) {
                var occurrence = (nameCounts.get(entry.name) || 0) + 1;
                nameCounts.set(entry.name, occurrence);
                return Object.assign({}, entry, {
                    label: occurrence === 1 ? entry.name : entry.name + ' (' + occurrence + ')',
                });
            });
        }

        function resetEmbeddedImageAssets() {
            embeddedImageAssets.clear();
            anonymousEmbeddedImageSequence = 0;
        }

        function composeEmbeddedImageAssetLoader(userAssetLoader) {
            return function (asset, bytes) {
                captureEmbeddedImageAsset(asset, bytes);
                return typeof userAssetLoader === 'function'
                    ? userAssetLoader.apply(this, arguments)
                    : false;
            };
        }

        /* ── DOM references ──────────────────────────────────── */

        const els = {
            canvasContainer: document.getElementById('canvas-container'),
            canvas: document.getElementById('rive-canvas'),
            info: document.getElementById('info'),
            error: document.getElementById('error-message'),
            fpsChip: document.getElementById('fps-chip'),
            centerPanel: document.getElementById('center-panel'),
            eventLogPanel: document.getElementById('event-log-panel'),
            eventLogHeader: document.getElementById('event-log-header'),
            eventLogCount: document.getElementById('event-log-count'),
            eventLogList: document.getElementById('event-log-list'),
            eventLogClearBtn: document.getElementById('event-log-clear-btn'),
            eventFilterNative: document.getElementById('event-filter-native'),
            eventFilterRiveUser: document.getElementById('event-filter-rive-user'),
            eventFilterUi: document.getElementById('event-filter-ui'),
            eventFilterSearch: document.getElementById('event-filter-search'),
            vmControlsCount: document.getElementById('vm-controls-count'),
            vmControlsEmpty: document.getElementById('vm-controls-empty'),
            vmControlsTree: document.getElementById('vm-controls-tree'),
            mainGrid: document.querySelector('.workspace'),
            rightResizer: document.getElementById('right-resizer'),
            centerResizer: document.getElementById('center-resizer'),
            rightPanel: document.getElementById('right-panel'),
            copyInstantiationBtn: document.getElementById('copy-instantiation-btn'),
            instantiationPackageSourceSelect: document.getElementById('instantiation-package-source-select'),
            eventLogToggleBtn: document.getElementById('event-log-toggle-btn'),
            toggleRightPanelBtn: document.getElementById('toggle-right-panel-btn'),
            showRightPanelBtn: document.getElementById('show-right-panel-btn'),
            settingsBtn: document.getElementById('settings-btn'),
            settingsPopover: document.getElementById('settings-popover'),
            layoutSelect: document.getElementById('layout-select'),
            alignmentSelect: document.getElementById('alignment-select'),
            canvasColorInput: document.getElementById('canvas-color-input'),
            canvasColorResetBtn: document.getElementById('canvas-color-reset-btn'),
            btnPlay: document.getElementById('btn-play'),
            btnPause: document.getElementById('btn-pause'),
            btnReset: document.getElementById('btn-reset'),
            fullscreenToggleBtn: document.getElementById('fullscreen-toggle-btn'),
        };

        /* ── Initialization ──────────────────────────────────── */
