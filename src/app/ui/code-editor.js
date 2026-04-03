const DEFAULT_EDITOR_CODE = `// Rive instantiation config — riveInst is the global instance
// Uncomment any property to override defaults

({
  autoplay: true,
  autoBind: true,

  // artboard: "MyArtboard",
  // stateMachines: "main-sm",
  // animations: "idle",

  // layout: { fit: "contain", alignment: "center" },
  //   fit options: contain, cover, fill, fitWidth, fitHeight, scaleDown, none, layout
  //   alignment: center, topLeft, topCenter, topRight, etc.
  // useOffscreenRenderer: true, // recommended for transparent overlays with glows/shadows

  onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  },

  // onStateChange: (event) => { console.log("state:", event); },
  // onAdvance: (event) => { console.log("advance:", event); },
  // onPlay: () => { console.log("play"); },
  // onPause: () => { console.log("pause"); },
  // onStop: () => { console.log("stop"); },
  // onLoop: (event) => { console.log("loop:", event); },
})`;

function createTextareaEditorAdapter(textarea) {
    return {
        dispatch(transaction = {}) {
            const change = transaction?.changes;
            if (!change || typeof change.insert !== 'string') {
                return;
            }
            textarea.value = change.insert;
        },
        dom: textarea,
        state: {
            doc: {
                toString: () => textarea.value,
            },
        },
    };
}

export function replaceOnLoadBlock(code, replacement) {
    const onLoadIdx = code.indexOf('onLoad:');
    if (onLoadIdx === -1) {
        const lastClose = code.lastIndexOf('}');
        if (lastClose === -1) {
            return null;
        }
        const before = code.substring(0, lastClose).trimEnd();
        const needsComma = before.endsWith(',') ? '' : ',';
        return before + needsComma + '\n  ' + replacement.trim() + '\n' + code.substring(lastClose);
    }

    const braceStart = code.indexOf('{', onLoadIdx + 'onLoad:'.length);
    if (braceStart === -1) {
        return null;
    }

    let depth = 0;
    let end = -1;
    for (let index = braceStart; index < code.length; index += 1) {
        if (code[index] === '{') {
            depth += 1;
        } else if (code[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                end = index;
                break;
            }
        }
    }
    if (end === -1) {
        return null;
    }

    return code.substring(0, onLoadIdx) + replacement.trim() + code.substring(end + 1);
}

export function extractBraceBlock(text, onLoadIdx, prefix) {
    const braceStart = text.indexOf('{', onLoadIdx + prefix.length);
    if (braceStart === -1) {
        return null;
    }

    let depth = 0;
    let end = -1;
    for (let index = braceStart; index < text.length; index += 1) {
        if (text[index] === '{') {
            depth += 1;
        } else if (text[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                end = index;
                break;
            }
        }
    }
    if (end === -1) {
        return null;
    }

    return text.substring(onLoadIdx, end + 1);
}

export function evaluateEditorConfig(code, evalFn = eval) {
    const trimmed = String(code || '').trim();
    if (!trimmed) {
        return {};
    }

    let result;
    try {
        result = evalFn(`(function() {
            return (
                ${trimmed}
            );
        })()`);
    } catch (error) {
        throw new Error(`Invalid JavaScript config: ${error.message}`);
    }

    if (!result || Array.isArray(result) || typeof result !== 'object') {
        throw new Error('Initialization config must return an object');
    }

    return result;
}

export function hasVmExplorerSnippet(code) {
    const text = String(code || '');
    return text.includes('vmExplore') || text.includes('vmRootInstance');
}

export function createCodeEditorController({
    callbacks = {},
    codeMirrorModulesRef = () => null,
    documentRef = globalThis.document,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    getCurrentFileName = () => null,
    getCurrentFileUrl = () => null,
    loadCodeMirror = async () => false,
    setTimeoutFn = globalThis.setTimeout,
} = {}) {
    const {
        getTauriInvoker = () => null,
        loadRiveAnimation = async () => {},
        logEvent = () => {},
        refreshCurrentState = async () => {},
        showError = () => {},
        updateInfo = () => {},
    } = callbacks;

    const liveModeChip = documentRef.getElementById('editor-live-mode-chip');
    let configDirty = false;
    let devToolsEnabled = false;
    let editorView = null;
    let isAutoFilling = false;
    let liveConfigSource = 'internal';
    let appliedEditorCode = '';
    let appliedEditorConfig = {};
    let setupPromise = null;

    function updateLiveModeChip() {
        if (!liveModeChip) {
            return;
        }

        const usingEditor = liveConfigSource === 'editor';
        liveModeChip.dataset.liveSource = liveConfigSource;
        liveModeChip.closest('.panel-heading')?.setAttribute('data-live-source', liveConfigSource);
        liveModeChip.classList.toggle('is-draft', configDirty);
        liveModeChip.setAttribute('aria-pressed', String(usingEditor));
        liveModeChip.title = usingEditor
            ? (configDirty
                ? 'Editor code is driving the animation. Draft changes are not live yet. Click to switch back to RAV internal wiring.'
                : 'Running the applied editor code. Click to switch to internal wiring.')
            : 'Running RAV internal wiring. Click to switch to the editor code.';
    }

    function markDraftState(nextDirty) {
        configDirty = Boolean(nextDirty);
        updateLiveModeChip();
    }

    function getEditorDraftCode() {
        return editorView ? editorView.state.doc.toString() : '';
    }

    function getEditorCode() {
        return editorView ? editorView.state.doc.toString() : undefined;
    }

    function setEditorCode(code) {
        if (!editorView) {
            return false;
        }
        isAutoFilling = true;
        editorView.dispatch({
            changes: { from: 0, to: editorView.state.doc.length, insert: code },
        });
        isAutoFilling = false;
        updateLiveModeChip();
        return true;
    }

    async function mountCodeEditor() {
        const editorEl = documentRef.getElementById('code-editor');
        if (!editorEl) {
            return false;
        }

        editorEl.replaceChildren();
        const hasCodeMirror = await loadCodeMirror();
        const codeMirrorModules = codeMirrorModulesRef();

        if (hasCodeMirror && codeMirrorModules) {
            const { EditorView, basicSetup, javascript, oneDark } = codeMirrorModules;
            editorView = new EditorView({
                doc: DEFAULT_EDITOR_CODE,
                extensions: [
                    basicSetup,
                    javascript(),
                    oneDark,
                    EditorView.lineWrapping,
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged && !isAutoFilling) {
                            markDraftState(true);
                        }
                    }),
                ],
                parent: editorEl,
            });

            editorEl.addEventListener('keydown', (event) => {
                if (event.key !== 'Tab' || (!event.target.classList.contains('cm-content') && !editorEl.contains(event.target))) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();

                const state = editorView.state;
                const selection = state.selection;

                if (event.shiftKey) {
                    const changes = [];
                    const newRanges = [];

                    for (const range of selection.ranges) {
                        const line = state.doc.lineAt(range.from);
                        const lineText = line.text;
                        let spaces = 0;

                        for (let index = 0; index < Math.min(2, lineText.length); index += 1) {
                            if (lineText[index] === ' ') {
                                spaces += 1;
                            } else {
                                break;
                            }
                        }

                        if (spaces > 0) {
                            changes.push({ from: line.from, insert: '', to: line.from + spaces });
                            newRanges.push({
                                anchor: range.anchor - spaces,
                                head: range.head - spaces,
                            });
                        } else {
                            newRanges.push({ anchor: range.anchor, head: range.head });
                        }
                    }

                    if (changes.length > 0) {
                        editorView.dispatch({
                            changes,
                            selection: { anchor: newRanges[0].anchor, head: newRanges[0].head },
                        });
                    }
                    return;
                }

                const changes = [];
                const newRanges = [];

                for (const range of selection.ranges) {
                    changes.push({ from: range.from, insert: '  ' });
                    newRanges.push({
                        anchor: range.anchor + 2,
                        head: range.head + 2,
                    });
                }

                editorView.dispatch({
                    changes,
                    selection: { anchor: newRanges[0].anchor, head: newRanges[0].head },
                });
            }, true);
        } else {
            const textarea = documentRef.createElement('textarea');
            textarea.value = DEFAULT_EDITOR_CODE;
            textarea.style.width = '100%';
            textarea.style.height = '100%';
            textarea.style.background = '#1e1e1e';
            textarea.style.color = '#d4d4d4';
            textarea.style.fontFamily = 'Monaco, Menlo, monospace';
            textarea.style.fontSize = '13px';
            textarea.style.border = 'none';
            textarea.style.outline = 'none';
            textarea.style.padding = '10px';
            textarea.style.resize = 'none';
            textarea.addEventListener('input', () => {
                if (!isAutoFilling) {
                    markDraftState(true);
                }
            });
            editorEl.appendChild(textarea);
            editorView = createTextareaEditorAdapter(textarea);
        }

        configDirty = false;
        isAutoFilling = false;
        setTimeoutFn(() => {
            markDraftState(false);
        }, 100);
        updateLiveModeChip();

        return true;
    }

    async function setupCodeEditor() {
        if (editorView) {
            return true;
        }
        if (setupPromise) {
            return setupPromise;
        }

        setupPromise = mountCodeEditor().finally(() => {
            setupPromise = null;
        });
        return setupPromise;
    }

    async function ensureEditorReady() {
        if (editorView) {
            return true;
        }
        return setupCodeEditor();
    }

    function getEditorConfig() {
        if (!editorView) {
            return {};
        }
        return evaluateEditorConfig(editorView.state.doc.toString());
    }

    function getLiveConfig() {
        return liveConfigSource === 'editor' ? { ...appliedEditorConfig } : {};
    }

    function getLiveConfigState() {
        return {
            appliedEditorCode,
            draftCode: getEditorDraftCode(),
            draftDirty: configDirty,
            sourceMode: liveConfigSource,
            usingEditor: liveConfigSource === 'editor',
        };
    }

    function getVmExplorerSnippetState() {
        return {
            injected: hasVmExplorerSnippet(getEditorDraftCode()),
        };
    }

    async function useInternalWiringAndReload() {
        if (liveConfigSource === 'internal') {
            updateLiveModeChip();
            return getLiveConfigState();
        }
        liveConfigSource = 'internal';
        updateLiveModeChip();
        updateInfo('Using internal RAV wiring');
        try {
            await refreshCurrentState();
        } catch {
            /* refreshCurrentState already reports the error */
        }
        return getLiveConfigState();
    }

    async function applyCodeAndReload() {
        const currentFileUrl = getCurrentFileUrl();
        const currentFileName = getCurrentFileName();
        if (!currentFileUrl || !currentFileName) {
            showError('Please load a Rive file first');
            return;
        }

        const currentCode = getEditorDraftCode();
        const parsedConfig = evaluateEditorConfig(currentCode);
        appliedEditorCode = currentCode;
        appliedEditorConfig = parsedConfig;
        liveConfigSource = 'editor';
        markDraftState(false);
        logEvent('ui', 'apply-refresh', 'Applied editor config and refreshed the current view.');
        try {
            await refreshCurrentState();
        } catch {
            /* refreshCurrentState already reports the error */
        }
        return getLiveConfigState();
    }

    async function setLiveConfigSource(nextSourceMode) {
        const normalizedSourceMode = nextSourceMode === 'editor' ? 'editor' : 'internal';
        if (normalizedSourceMode === 'internal') {
            return useInternalWiringAndReload();
        }

        const currentCode = getEditorDraftCode();
        const shouldApply =
            liveConfigSource !== 'editor'
            || configDirty
            || currentCode !== appliedEditorCode;

        if (!shouldApply) {
            updateLiveModeChip();
            return getLiveConfigState();
        }

        return applyCodeAndReload();
    }

    async function toggleLiveConfigSource() {
        return setLiveConfigSource(liveConfigSource === 'editor' ? 'internal' : 'editor');
    }

    async function setVmExplorerSnippetEnabled(enabled, { openDevtools = false } = {}) {
        if (!editorView) {
            showError('Code editor is not available');
            return { ok: false, injected: false };
        }

        const invoke = getTauriInvoker();
        if (openDevtools && invoke && !devToolsEnabled) {
            try {
                devToolsEnabled = true;
                await invoke('open_devtools');
            } catch {
                /* noop */
            }
        }

        try {
            const currentCode = editorView.state.doc.toString();
            const snippetInjected = hasVmExplorerSnippet(currentCode);
            if (snippetInjected === Boolean(enabled)) {
                return { ok: true, changed: false, injected: snippetInjected };
            }

            let newCode;
            if (!enabled) {
                newCode = replaceOnLoadBlock(currentCode, `onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  }`);
                updateInfo('VM explorer removed — restored default');
                console.log('VM explorer removed. Default onLoad restored.');
            } else {
                let explorerOnLoad = null;
                try {
                    const response = await fetchImpl('/vm-explorer-snippet.js');
                    if (response?.ok) {
                        const text = await response.text();
                        const startMarker = 'onLoad: () => {';
                        const startIdx = text.indexOf(startMarker);
                        if (startIdx !== -1) {
                            explorerOnLoad = extractBraceBlock(text, startIdx, 'onLoad:');
                        }
                    }
                } catch {
                    /* noop */
                }

                if (!explorerOnLoad) {
                    showError('Could not load VM explorer snippet');
                    return;
                }

                newCode = replaceOnLoadBlock(currentCode, explorerOnLoad);
                updateInfo('VM explorer injected — click Apply & Reload');
                console.log('%cVM Explorer injected. Click Apply & Reload to activate.', 'color: #C4F82A; font-weight: bold');
                console.log('After reload: vmExplore(), vmGet("path"), vmSet("path", val), vmFire("path")');
            }

            if (!newCode || newCode === currentCode) {
                showError('Could not modify onLoad block — check editor code syntax');
                return;
            }

            setEditorCode(newCode);
            markDraftState(true);
            return { ok: true, changed: true, injected: Boolean(enabled) };
        } catch (error) {
            showError(`Failed to modify code: ${error.message}`);
            throw error;
        }
    }

    async function injectCodeSnippet() {
        const currentCode = editorView?.state.doc.toString() ?? '';
        return setVmExplorerSnippetEnabled(!hasVmExplorerSnippet(currentCode), { openDevtools: true });
    }

    liveModeChip?.addEventListener('click', () => {
        toggleLiveConfigSource().catch((error) => {
            showError(`Failed to switch live config source: ${error.message}`);
        });
    });

    return {
        applyCodeAndReload,
        ensureEditorReady,
        getEditorCode,
        getEditorConfig,
        getLiveConfig,
        getLiveConfigState,
        getVmExplorerSnippetState,
        injectCodeSnippet,
        setEditorCode,
        setLiveConfigSource,
        setVmExplorerSnippetEnabled,
        setupCodeEditor,
        toggleLiveConfigSource,
        useInternalWiringAndReload,
    };
}
