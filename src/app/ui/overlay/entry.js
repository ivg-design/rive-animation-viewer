import {
    renderControlHierarchyTree,
    updateControlHierarchySelection,
} from '../export/control-tree.js';
import { createOverlayActionClient } from './action-client.js';
import { createAboutRenderer, createMcpRenderer } from './purpose-renderers.js';
import { waitForOverlayVisualReadiness } from './readiness.js';
import { createSettingsOverlayRenderer } from './settings-renderer.js';

const bootstrap = window.__RAV_UI_OVERLAY_BOOTSTRAP__ || {};
const epoch = Number(bootstrap.epoch) || 0;
const purpose = String(bootstrap.purpose || '');
const invoke = window.__TAURI__?.core?.invoke;
const events = window.__TAURI__?.event;
const EXCLUSIVE_ACTIONS = [
    'client-install',
    'client-remove',
    'copy-preview',
    'export',
    'generate-preview',
    'open-link',
    'default-riv-app-apply',
];
let pendingExclusiveActions = 0;

function element(id) {
    return document.getElementById(id);
}

function renderCurrentPurpose() {
    if (purpose === 'settings') renderSettings(currentOverlayState);
    if (purpose === 'about') renderAbout(currentOverlayState);
    if (purpose === 'mcp') renderMcp(currentOverlayState);
    if (purpose === 'export') renderExport(currentOverlayState);
}

function showActionError(error) {
    const target = element('ui-overlay-action-error');
    if (!target) return;
    target.textContent = `Control update failed${error?.message ? `: ${error.message}` : '.'}`;
    target.hidden = false;
}

function clearActionError() {
    const target = element('ui-overlay-action-error');
    if (!target) return;
    target.hidden = true;
    target.textContent = '';
}

const emitAction = createOverlayActionClient({
    epoch,
    exclusiveActions: EXCLUSIVE_ACTIONS,
    invoke,
    onFailure: ({ error }) => {
        renderCurrentPurpose();
        showActionError(error);
    },
    onPendingChange: ({ action, pending }) => {
        if (!EXCLUSIVE_ACTIONS.includes(action)) return;
        pendingExclusiveActions = Math.max(0, pendingExclusiveActions + (pending ? 1 : -1));
        const root = element('ui-overlay-root');
        root?.classList.toggle('is-action-busy', pendingExclusiveActions > 0);
        root?.setAttribute('aria-busy', String(pendingExclusiveActions > 0));
    },
    onSuccess: clearActionError,
    purpose,
    windowRef: window,
});
const renderAbout = createAboutRenderer({ documentRef: document, emitAction });
const renderMcp = createMcpRenderer({ documentRef: document, emitAction });
const settingsRenderer = createSettingsOverlayRenderer({ documentRef: document, emitAction, windowRef: window });
const renderSettings = settingsRenderer.render;

let exportExpandedBranchKeys = new Set();
let exportHierarchy = null;
let exportHierarchyRevision = null;

function renderExport(state = {}) {
    const summary = document.querySelector('[data-overlay-export-summary]');
    if (summary) summary.textContent = String(state.selectionSummary || 'No controls available.');
    const packageSource = document.querySelector('[data-overlay-export-package]');
    if (packageSource && document.activeElement !== packageSource) {
        packageSource.value = state.packageSource === 'local' ? 'local' : 'cdn';
    }
    const snippetMode = document.querySelector('[data-overlay-export-mode]');
    if (snippetMode && document.activeElement !== snippetMode) {
        snippetMode.value = state.snippetMode === 'scaffold' ? 'scaffold' : 'compact';
    }
    exportExpandedBranchKeys = new Set(state.expandedBranchKeys || exportExpandedBranchKeys);
    const nextRevision = Number(state.hierarchyRevision);
    const hasHierarchy = Boolean(state.hierarchy);
    const hierarchyChanged = hasHierarchy && (
        !exportHierarchy
        || !Number.isFinite(nextRevision)
        || nextRevision !== exportHierarchyRevision
    );
    if (hasHierarchy) {
        exportHierarchy = state.hierarchy;
        if (Number.isFinite(nextRevision)) exportHierarchyRevision = nextRevision;
    }
    const selectedKeys = new Set(state.selectedControlKeys || []);
    const tree = document.querySelector('[data-overlay-export-tree]');
    if (tree) {
        if (hierarchyChanged || !tree.childElementCount) {
            const scrollTop = tree.scrollTop;
            renderControlHierarchyTree({
                currentHierarchy: exportHierarchy,
                documentRef: document,
                expandedBranchKeys: exportExpandedBranchKeys,
                onExpandedBranchChange: (key, expanded) => {
                    void emitAction('branch-expanded', { expanded, key });
                },
                onBranchSelectionChange: (branchKey, selected) => {
                    void emitAction('branch-selection', { branchKey, selected });
                },
                onSelectionToggle: (key, selected) => {
                    void emitAction('selection-toggle', { key, selected });
                },
                selectedKeys,
                treeElement: tree,
            });
            tree.scrollTop = Number.isFinite(Number(state.treeScrollTop))
                ? Number(state.treeScrollTop)
                : scrollTop;
        } else {
            updateControlHierarchySelection({
                currentHierarchy: exportHierarchy,
                selectedKeys,
                treeElement: tree,
            });
        }
    }
    const previewStatus = document.querySelector('[data-overlay-export-preview-status]');
    if (previewStatus) previewStatus.textContent = String(state.previewStatus || '');
    const previewOutput = document.querySelector('[data-overlay-export-preview-output]');
    if (previewOutput) previewOutput.textContent = state.previewText || '// Generate a snippet to preview it here.';
    const copy = document.querySelector('[data-overlay-export-copy]');
    if (copy) copy.disabled = !state.previewText;
    const submit = document.querySelector('[data-overlay-export-submit]');
    if (submit) submit.disabled = !state.exportEnabled;
}

let currentOverlayState = { ...(bootstrap.state || {}) };

if (purpose === 'settings') {
    const settings = element('ui-overlay-settings');
    if (settings) settings.hidden = false;
    settingsRenderer.bind();
    renderSettings(currentOverlayState);
    window.addEventListener('resize', settingsRenderer.scheduleOverflowSync);
}

if (purpose === 'about') {
    const about = element('ui-overlay-about');
    if (about) about.hidden = false;
    about?.querySelector('[data-overlay-close]')?.addEventListener('click', () => void emitAction('close'));
    renderAbout(currentOverlayState);
}
if (purpose === 'mcp') {
    const mcp = element('ui-overlay-mcp');
    if (mcp) mcp.hidden = false;
    mcp?.querySelector('[data-overlay-close]')?.addEventListener('click', () => void emitAction('close'));
    mcp?.querySelector('[data-overlay-mcp-script-access]')?.addEventListener('click', () => void emitAction('script-access-toggle'));
    const applyPort = () => void emitAction('port-apply', element('overlay-mcp-port')?.value || '');
    mcp?.querySelector('[data-overlay-mcp-port-apply]')?.addEventListener('click', applyPort);
    element('overlay-mcp-port')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyPort();
    });
    element('overlay-mcp-port')?.addEventListener('input', (event) => {
        void emitAction('port-draft', event.target.value);
    });
    mcp?.querySelector('[data-overlay-mcp-copy="server-path"]')?.addEventListener('click', () => void emitAction('copy', 'server-path'));
    renderMcp(currentOverlayState);
}
if (purpose === 'export') {
    const exportPanel = element('ui-overlay-export');
    if (exportPanel) exportPanel.hidden = false;
    exportPanel?.querySelector('[data-overlay-close]')?.addEventListener('click', () => void emitAction('close'));
    exportPanel?.querySelectorAll('[data-overlay-export-preset]').forEach((button) => {
        button.addEventListener('click', () => void emitAction('selection-preset', button.dataset.overlayExportPreset));
    });
    exportPanel?.querySelector('[data-overlay-export-package]')?.addEventListener('change', (event) => {
        void emitAction('package-source', event.target.value);
    });
    exportPanel?.querySelector('[data-overlay-export-mode]')?.addEventListener('change', (event) => {
        void emitAction('snippet-mode', event.target.value);
    });
    exportPanel?.querySelector('[data-overlay-export-generate]')?.addEventListener('click', () => void emitAction('generate-preview'));
    exportPanel?.querySelector('[data-overlay-export-copy]')?.addEventListener('click', () => void emitAction('copy-preview'));
    exportPanel?.querySelector('[data-overlay-export-submit]')?.addEventListener('click', () => void emitAction('export'));
    renderExport(currentOverlayState);
    let scrollTimer = null;
    exportPanel?.querySelector('[data-overlay-export-tree]')?.addEventListener('scroll', (event) => {
        window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(() => {
            void emitAction('tree-scroll', Math.max(0, Math.round(event.target.scrollTop)));
        }, 80);
    }, { passive: true });
}

const stateListenerPromise = Promise.resolve(events?.listen?.('ui-overlay:state', (event) => {
    const payload = event?.payload || {};
    if (Number(payload.epoch) !== epoch) return;
    currentOverlayState = { ...currentOverlayState, ...(payload.state || {}) };
    clearActionError();
    renderCurrentPurpose();
}));
const actionResultListenerPromise = Promise.resolve(events?.listen?.('ui-overlay:action-result', (event) => {
    emitAction.handleResult(event?.payload || {});
}));
document.addEventListener('focusin', (event) => {
    const targetId = event.target?.id;
    if (targetId) void emitAction('focus-target', targetId);
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    void emitAction('close');
});

async function announceReady() {
    if (typeof invoke !== 'function' || !epoch || !purpose) return;
    await Promise.all([stateListenerPromise, actionResultListenerPromise]);
    await waitForOverlayVisualReadiness({ documentRef: document, windowRef: window });
    await invoke('ui_overlay_ready', { request: { epoch, purpose } });
}

void announceReady().catch((error) => {
    console.error('[rive-viewer] UI overlay did not become visually ready:', error);
});
