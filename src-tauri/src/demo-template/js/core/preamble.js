    (function () {
        'use strict';

        /* ── Configuration from Rust placeholders ────────────── */

        const CONFIG = JSON.parse('__CONFIG_JSON__');
        const VM_HIERARCHY = JSON.parse('__VM_HIERARCHY_JSON__');
        const CONTROL_SNAPSHOT = Array.isArray(CONFIG.controlSnapshot) ? CONFIG.controlSnapshot : [];
        const INSTANTIATION_SNIPPETS = (CONFIG.instantiationSnippets && typeof CONFIG.instantiationSnippets === 'object')
            ? CONFIG.instantiationSnippets
            : {};
        const DEFAULT_CANVAS_COLOR = '__CANVAS_COLOR__' || '#0d1117';
        const TRANSPARENT_CANVAS_COLOR = 'transparent';
        const DEMO_TRANSPARENCY_TOGGLE_ENABLED = false;
        const LAYOUT_STATE = (CONFIG.layoutState && typeof CONFIG.layoutState === 'object')
            ? CONFIG.layoutState
            : {};

        const LAYOUT_FITS = ['cover', 'contain', 'fill', 'fitWidth', 'fitHeight', 'scaleDown', 'none', 'layout'];
        const LAYOUT_ALIGNMENTS = ['topLeft', 'topCenter', 'topRight', 'centerLeft', 'center', 'centerRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];
        const VM_CONTROL_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color', 'trigger']);
        const DEFAULT_CANVAS_SIZING = {
            mode: 'auto',
            width: 1280,
            height: 720,
            lockAspectRatio: false,
            aspectRatio: 1280 / 720,
        };
        const EVENT_LOG_LIMIT = 500;
        const VM_CONTROL_SYNC_INTERVAL_MS = 120;
        const VM_DEPTH_COLORS = ['#C4F82A', '#38BDF8', '#A78BFA', '#FB923C', '#F472B6', '#34D399'];
        const ALLOWED_CONTROL_KEYS = new Set(
            CONTROL_SNAPSHOT
                .map(function (entry) { return controlSnapshotKeyForDescriptor(entry && entry.descriptor ? entry.descriptor : entry); })
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
        let isTransparencyModeEnabled = false;
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
        let lastFpsUpdate = 0;
        let frameCount = 0;
        let isFallbackFullscreenMode = false;

        function controlSnapshotKeyForDescriptor(descriptor) {
            if (!descriptor) return null;
            if (descriptor.source === 'state-machine') {
                return 'sm:' + (descriptor.stateMachineName || '') + ':' + (descriptor.name || '') + ':' + (descriptor.kind || '');
            }
            return 'vm:' + (descriptor.path || '') + ':' + (descriptor.kind || '');
        }

        function normalizeControlDescriptor(input) {
            var source = input && input.descriptor ? input.descriptor : input;
            if (!source || typeof source !== 'object') return null;
            return {
                kind: source.kind || null,
                name: source.name || null,
                path: source.path || null,
                source: source.source || 'view-model',
                stateMachineName: source.stateMachineName || null,
            };
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

        function isControlDescriptorAllowed(descriptor) {
            if (!ALLOWED_CONTROL_KEYS.size) return false;
            var normalized = normalizeControlDescriptor(descriptor);
            if (!normalized) return false;
            var key = controlSnapshotKeyForDescriptor(normalized);
            return Boolean(key) && ALLOWED_CONTROL_KEYS.has(key);
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

        function filterHierarchyNode(node) {
            if (!node || typeof node !== 'object') return null;

            var inputs = Array.isArray(node.inputs)
                ? node.inputs.filter(function (input) {
                    return isControlDescriptorAllowed(normalizeControlDescriptor(input));
                })
                : [];

            var children = Array.isArray(node.children)
                ? node.children
                    .map(function (child) { return filterHierarchyNode(child); })
                    .filter(Boolean)
                : [];

            if (!inputs.length && !children.length) {
                return null;
            }

            var nextNode = Object.assign({}, node, {
                children: children,
                inputs: inputs,
            });
            nextNode.totalInputs = countHierarchyInputs(nextNode);
            return nextNode;
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
            transparencyModeToggle: document.getElementById('transparency-mode-toggle'),
            btnPlay: document.getElementById('btn-play'),
            btnPause: document.getElementById('btn-pause'),
            btnReset: document.getElementById('btn-reset'),
            fullscreenToggleBtn: document.getElementById('fullscreen-toggle-btn'),
        };

        /* ── Initialization ──────────────────────────────────── */
