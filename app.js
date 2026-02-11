// CodeMirror will be loaded dynamically if available
let CodeMirrorModules = null;

// Try to load CodeMirror modules
async function loadCodeMirror() {
    try {
        let modules;

        if (window.__TAURI__) {
            // Desktop app - load from bundled single file
            modules = await import('/vendor/codemirror-bundle.js');
        } else {
            // Web version - load from node_modules
            const [cm, js, theme] = await Promise.all([
                import('/node_modules/codemirror/dist/index.js'),
                import('/node_modules/@codemirror/lang-javascript/dist/index.js'),
                import('/node_modules/@codemirror/theme-one-dark/dist/index.js')
            ]);
            modules = {
                basicSetup: cm.basicSetup,
                EditorView: cm.EditorView,
                javascript: js.javascript,
                oneDark: theme.oneDark
            };
        }

        CodeMirrorModules = modules;
        return true;
    } catch (error) {
        console.warn('CodeMirror not available, using fallback textarea', error);
        return false;
    }
}

const RIVE_VERSION = '2.34.3';
const MIN_SCRIPTING_RUNTIME_VERSION = '2.34.0';
const runtimeSources = {
    canvas: `https://cdn.jsdelivr.net/npm/@rive-app/canvas@${RIVE_VERSION}`,
    webgl2: `https://cdn.jsdelivr.net/npm/@rive-app/webgl2@${RIVE_VERSION}`,
};

const runtimeRegistry = {};
const runtimePromises = {};
const runtimeVersions = {};
const runtimeResolvedUrls = {};
const runtimeSourceTexts = {};
const runtimeBlobUrls = {};
const runtimeAssets = {};
const runtimeWarningsShown = new Set();
const APP_VERSION = '__APP_VERSION__';
let resolvedAppVersion = APP_VERSION;
const DEFAULT_LAYOUT_FIT = 'contain';
const LAYOUT_FITS = ['cover', 'contain', 'fill', 'fitWidth', 'fitHeight', 'scaleDown', 'scaleUp'];
const RUNTIME_CACHE_NAME = 'rive-runtime-cache-v1';
const RUNTIME_META_STORAGE_KEY = 'riveRuntimeMeta';
const VM_CONTROL_KINDS = new Set(['number', 'boolean', 'string', 'enum', 'color', 'trigger']);

let riveInstance = null;
let currentFileUrl = null;
let currentFileName = null;
let currentRuntime = 'webgl2';
let lastObjectUrl = null;
let currentLayoutFit = DEFAULT_LAYOUT_FIT;
let currentFileBuffer = null;
let currentFileMimeType = 'application/octet-stream';
let lastInitConfig = {};
let configDirty = false;
let errorTimeoutId = null;
let currentArtboardName = null;
let currentCanvasColor = '#0d1117';
const runtimeMeta = loadRuntimeMeta();
let editorView = null;
let isAutoFilling = false;
let hasAutoReloaded = false;

const elements = {
    versionInfo: document.getElementById('version-info'),
    fileInput: document.getElementById('file-input'),
    fileTriggerButton: document.getElementById('file-trigger-btn'),
    runtimeSelect: document.getElementById('runtime-select'),
    layoutSelect: document.getElementById('layout-select'),
    codeEditor: document.getElementById('code-editor'),
    info: document.getElementById('info'),
    error: document.getElementById('error-message'),
    canvasContainer: document.getElementById('canvas-container'),
    canvasColorInput: document.getElementById('canvas-color-input'),
    mainGrid: document.getElementById('main-grid'),
    configPanel: document.getElementById('config-panel'),
    configToggle: document.getElementById('config-toggle'),
    configContent: document.getElementById('config-content'),
    vmControlsPanel: document.getElementById('vm-controls-panel'),
    vmControlsCount: document.getElementById('vm-controls-count'),
    vmControlsEmpty: document.getElementById('vm-controls-empty'),
    vmControlsList: document.getElementById('vm-controls-list'),
};

init();

async function init() {
    resolveAppVersion();
    updateVersionInfo('Loading runtime...');
    setupFileInput();
    updateFileTriggerButton('empty');
    setupRuntimeSelect();
    setupLayoutSelect();
    setupConfigToggle();
    await setupCodeEditor();
    setupCanvasColor();
    setupDemoButton();
    setupResizeHandle();
    resetVmInputControls('No animation loaded.');
    window.addEventListener('resize', handleResize);
    window.addEventListener('beforeunload', revokeLastObjectUrl);
    ensureRuntime(currentRuntime)
        .then(() => updateVersionInfo())
        .catch((error) => showError(`Failed to load runtime: ${error.message}`));
}

function setupFileInput() {
    if (!elements.fileInput) {
        return;
    }
    elements.fileInput.addEventListener('change', async (event) => {
        const selectedFile = event.target.files?.[0];
        if (!selectedFile) {
            updateFileTriggerButton('empty');
            return;
        }
        if (!selectedFile.name.toLowerCase().endsWith('.riv')) {
            showError('Please select a .riv file');
            event.target.value = '';
            updateFileTriggerButton('empty');
            return;
        }

        updateFileTriggerButton('loaded', selectedFile.name);

        const buffer = await selectedFile.arrayBuffer();
        const fileUrl = URL.createObjectURL(selectedFile);
        setCurrentFile(fileUrl, selectedFile.name, true, buffer, selectedFile.type);
        hideError();
        try {
            await loadRiveAnimation(fileUrl, selectedFile.name);
        } catch {
            // loadRiveAnimation already surfaced the error
        } finally {
            event.target.value = '';
        }
    });
}

function setupRuntimeSelect() {
    if (!elements.runtimeSelect) {
        return;
    }

    elements.runtimeSelect.addEventListener('change', async (event) => {
        const selected = event.target.value;
        if (selected === currentRuntime) {
            return;
        }

        currentRuntime = selected;
        updateInfo(`Runtime changed to: ${currentRuntime}`);
        updateVersionInfo('Loading runtime...');

        try {
            await ensureRuntime(currentRuntime);
            updateVersionInfo();
            if (currentFileUrl && currentFileName) {
                await loadRiveAnimation(currentFileUrl, currentFileName);
            }
        } catch (error) {
            showError(`Failed to load runtime: ${error.message}`);
        }
    });
}

function setupLayoutSelect() {
    const select = elements.layoutSelect;
    if (!select) {
        return;
    }

    select.value = currentLayoutFit;
    select.addEventListener('change', async (event) => {
        const selected = event.target.value;
        if (!selected || selected === currentLayoutFit) {
            return;
        }
        if (!LAYOUT_FITS.includes(selected)) {
            showError(`Unsupported layout fit: ${selected}`);
            return;
        }
        currentLayoutFit = selected;
        updateInfo(`Layout fit set to: ${currentLayoutFit}`);
        if (currentFileUrl && currentFileName) {
            try {
                await loadRiveAnimation(currentFileUrl, currentFileName);
            } catch {
                /* loadRiveAnimation already reports errors */
            }
        }
    });
}

function setupConfigToggle() {
    const panel = elements.configPanel;
    const toggle = elements.configToggle;
    if (!panel || !toggle) {
        console.warn('setupConfigToggle: missing panel or toggle');
        return;
    }
    toggle.addEventListener('click', () => {
        applyConfigPanelState(panel.classList.contains('collapsed'));
    });
    applyConfigPanelState(!panel.classList.contains('collapsed'));
}

function applyConfigPanelState(visible) {
    const panel = elements.configPanel;
    const content = elements.configContent;
    const grid = elements.mainGrid;
    const toggle = elements.configToggle;
    if (!panel || !grid || !toggle) {
        console.warn('applyConfigPanelState: missing element', {
            panel: !!panel,
            grid: !!grid,
            toggle: !!toggle,
        });
        return;
    }
    panel.hidden = !visible;
    panel.classList.toggle('collapsed', !visible);
    if (content) {
        content.hidden = !visible;
    }
    grid.classList.toggle('config-collapsed', !visible);

    // Clear inline style so CSS class can take effect
    if (!visible) {
        grid.style.gridTemplateColumns = '';
    }

    const label = visible ? 'Hide settings panel' : 'Show settings panel';
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
    toggle.classList.toggle('collapsed', !visible);
    handleResize();
}

async function setupCodeEditor() {
    const editorEl = document.getElementById('code-editor');
    if (!editorEl) {
        return;
    }

    // Set initial code
    const initialCode = `// You can define functions and helpers here
// riveInst is available as a global variable
// Runtimes are pinned to ${RIVE_VERSION} for scripting/ViewModel support

({
  autoplay: true,
  autoBind: true,
  onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  }
})`;

    // Try to load CodeMirror
    const hasCodeMirror = await loadCodeMirror();

    if (hasCodeMirror && CodeMirrorModules) {
        // Use CodeMirror if available
        const { EditorView, basicSetup, javascript, oneDark } = CodeMirrorModules;
        editorView = new EditorView({
            doc: initialCode,
            extensions: [
                basicSetup,
                javascript(),
                oneDark,
                EditorView.lineWrapping,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && !isAutoFilling) {
                        configDirty = true;
                    }
                })
            ],
            parent: editorEl
        });

        // Prevent default tab behavior when editor is focused
        editorEl.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && (e.target.classList.contains('cm-content') || editorEl.contains(e.target))) {
                // Prevent default browser tab behavior
                e.preventDefault();
                e.stopPropagation();

                // Get current selection
                const state = editorView.state;
                const selection = state.selection;

                if (e.shiftKey) {
                    // Shift+Tab: Remove indentation
                    const changes = [];
                    const newRanges = [];

                    for (const range of selection.ranges) {
                        const line = state.doc.lineAt(range.from);
                        const lineText = line.text;
                        let spaces = 0;

                        // Count spaces at beginning of line (up to 2)
                        for (let i = 0; i < Math.min(2, lineText.length); i++) {
                            if (lineText[i] === ' ') spaces++;
                            else break;
                        }

                        if (spaces > 0) {
                            changes.push({ from: line.from, to: line.from + spaces, insert: '' });
                            newRanges.push({
                                anchor: range.anchor - spaces,
                                head: range.head - spaces
                            });
                        } else {
                            newRanges.push({ anchor: range.anchor, head: range.head });
                        }
                    }

                    if (changes.length > 0) {
                        editorView.dispatch({
                            changes,
                            selection: { anchor: newRanges[0].anchor, head: newRanges[0].head }
                        });
                    }
                } else {
                    // Tab: Add indentation
                    const changes = [];
                    const newRanges = [];

                    for (const range of selection.ranges) {
                        changes.push({ from: range.from, insert: '  ' });
                        newRanges.push({
                            anchor: range.anchor + 2,
                            head: range.head + 2
                        });
                    }

                    editorView.dispatch({
                        changes,
                        selection: { anchor: newRanges[0].anchor, head: newRanges[0].head }
                    });
                }
            }
        }, true);
    } else {
        // Fallback to textarea
        const textarea = document.createElement('textarea');
        textarea.value = initialCode;
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
                configDirty = true;
            }
        });
        editorEl.appendChild(textarea);

        // Create a simple API to match CodeMirror
        editorView = {
            dom: textarea,
            state: { doc: { toString: () => textarea.value } },
            dispatch: () => {}
        };
    }

    // CRITICAL: Reset dirty flag after initial setup
    configDirty = false;
    isAutoFilling = false;

    setTimeout(() => {
        configDirty = false;
    }, 100);
}

function setupCanvasColor() {
    const input = elements.canvasColorInput;
    if (!input) {
        return;
    }
    input.value = currentCanvasColor;
    input.addEventListener('input', (event) => {
        currentCanvasColor = event.target.value || '#0d1117';
        updateCanvasBackground();
    });
    updateCanvasBackground();
}

function setupDemoButton() {
    const button = document.getElementById('demo-bundle-btn');
    if (!button) {
        return;
    }

    const setButtonState = (enabled) => {
        button.disabled = !enabled;
        button.classList.toggle('demo-button--disabled', !enabled);
        button.title = enabled
            ? 'Package the current animation into a demo executable'
            : 'Available in the desktop app';
    };

    const refreshState = () => {
        setButtonState(Boolean(getTauriInvoker()));
    };

    refreshState();

    let attempts = 0;
    const maxAttempts = 20;
    const interval = setInterval(() => {
        refreshState();
        if (getTauriInvoker()) {
            clearInterval(interval);
            return;
        }
        attempts += 1;
        if (attempts >= maxAttempts) {
            clearInterval(interval);
        }
    }, 300);

    window.addEventListener(
        'tauri://ready',
        () => {
            refreshState();
        },
        { once: true },
    );
}

function setupResizeHandle() {
    const handle = document.getElementById('resize-handle');
    const mainGrid = elements.mainGrid;
    if (!handle || !mainGrid) {
        return;
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        const configPanel = document.getElementById('config-panel');
        if (configPanel) {
            startWidth = configPanel.offsetWidth;
        }
        handle.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const diff = startX - e.clientX;
        const newWidth = Math.max(280, startWidth + diff);

        // Update grid template
        mainGrid.style.gridTemplateColumns = `minmax(0, 1fr) 4px ${newWidth}px`;

        // Resize canvas to match new container size
        handleResize();
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // Final resize when done dragging
            handleResize();
        }
    });
}

function setCurrentFile(url, name, isObjectUrl = false, buffer, mimeType) {
    if (lastObjectUrl && lastObjectUrl !== url) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }

    if (isObjectUrl) {
        lastObjectUrl = url;
    }

    currentFileUrl = url;
    currentFileName = name;
    if (buffer instanceof ArrayBuffer) {
        currentFileBuffer = buffer;
    }
    if (mimeType) {
        currentFileMimeType = mimeType;
    }
    updateFileTriggerButton(name ? 'loaded' : 'empty', name);
}

async function loadRiveAnimation(fileUrl, fileName) {
    if (!fileUrl) {
        showError('Please load a Rive file first');
        return;
    }

    updateInfo(`Loading ${fileName} (${currentRuntime})...`);
    resetVmInputControls('Loading ViewModel inputs...');

    try {
        const runtime = await ensureRuntime(currentRuntime);
        const container = elements.canvasContainer;
        if (!runtime || !container) {
            throw new Error('Runtime or canvas container is not available');
        }

        cleanupInstance();
        container.innerHTML = '';

        const canvas = document.createElement('canvas');
        canvas.id = 'rive-canvas';
        container.appendChild(canvas);
        resizeCanvas(canvas);

        const userConfig = getEditorConfig();
        lastInitConfig = { ...userConfig };
        const config = { ...userConfig };

        // Save user's onLoad callback
        const userOnLoad = config.onLoad;

        if (config.artboard) {
            currentArtboardName = config.artboard;
        }
        config.src = fileUrl;
        config.canvas = canvas;
        if (typeof config.autoBind === 'undefined') {
            config.autoBind = true;
        }
        const layoutFromConfig = config.layout && typeof config.layout === 'object' ? config.layout : {};
        const { alignment, fit: _ignoredFit, ...otherLayoutProps } = layoutFromConfig;
        config.layout = new runtime.Layout({
            fit: currentLayoutFit,
            alignment: alignment || 'center',
            ...otherLayoutProps,
        });

        config.onLoad = () => {
            hideError();
            resizeCanvas(canvas);
            riveInstance?.resizeDrawingSurfaceToCanvas();

            // Get state machine names from instance (same as v1.2.6)
            const names = Array.isArray(riveInstance?.stateMachineNames) ? riveInstance.stateMachineNames : [];

            // Auto-fill and reload with correct config
            const didAutoFill = autoFillConfigStateMachine(names);
            if (didAutoFill && !hasAutoReloaded) {
                hasAutoReloaded = true;
                updateInfo(`Auto-reloading with correct state machine...`);
                setTimeout(() => {
                    loadRiveAnimation(currentFileUrl, currentFileName);
                }, 50);
                return;
            }

            // Show which state machine is initialized
            // Handle both string and array formats for stateMachines
            let activeStateMachine = 'none';
            if (config.stateMachines) {
                activeStateMachine = Array.isArray(config.stateMachines)
                    ? config.stateMachines[0]
                    : config.stateMachines;
            } else if (names.length > 0) {
                activeStateMachine = names[0];
            }

            const statusMsg = names.length > 0
                ? `Loaded: ${fileName} (${currentRuntime}) - default state machine (${activeStateMachine}) initialized`
                : `Loaded: ${fileName} (${currentRuntime}) - no state machines`;
            updateInfo(statusMsg);
            currentArtboardName = riveInstance?.artboard?.name || currentArtboardName || config.artboard || null;
            hasAutoReloaded = false;

            // Call user's onLoad callback if provided
            if (typeof userOnLoad === 'function') {
                try {
                    userOnLoad();
                } catch (e) {
                    console.warn('Error in user onLoad:', e);
                }
            }

            renderVmInputControls();
        };

        config.onLoadError = (error) => {
            const errorMsg = error?.message || error?.toString() || String(error);
            showError(`Error loading animation: ${errorMsg}`);
        };

        const instanceConfig = currentRuntime === 'webgl2'
            ? { ...config, useOffscreenRenderer: true }
            : config;

        riveInstance = new runtime.Rive(instanceConfig);
        // Expose globally for code editor access
        window.riveInst = riveInstance;
    } catch (error) {
        showError(`Error initializing Rive: ${error.message}`);
        throw error;
    }
}

async function applyCodeAndReload() {
    if (!currentFileUrl || !currentFileName) {
        showError('Please load a Rive file first');
        return;
    }

    try {
        await loadRiveAnimation(currentFileUrl, currentFileName);
    } catch {
        // loadRiveAnimation already reported the error
    }
}

function play() {
    if (riveInstance) {
        riveInstance.play();
        updateInfo('Playing');
    }
}

function pause() {
    if (riveInstance) {
        riveInstance.pause();
        updateInfo('Paused');
    }
}

function reset() {
    if (riveInstance) {
        riveInstance.reset();
        updateInfo('Reset');
    }
}

let devToolsEnabled = false;

async function injectCodeSnippet() {
    // Clear console first
    console.clear();

    // Open dev tools in Tauri desktop app (only if not already enabled)
    if (window.__TAURI__ && !devToolsEnabled) {
        try {
            // Enable dev tools and mark as enabled
            devToolsEnabled = true;
            await window.__TAURI__.invoke('open_devtools');
            console.log('Dev tools opened. You can now use the console to explore the Rive instance.');
        } catch (error) {
            console.warn('Could not open dev tools programmatically:', error);
            console.log('You may need to right-click and select "Inspect Element" to open dev tools manually.');
        }
    } else if (!window.__TAURI__) {
        // For web version, clear console
        console.clear();
    }

    // Default onLoad snippet
    const defaultSnippet = `onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  }`;

    // Load VM exploration snippet from external file
    let vmExplorerSnippet;
    try {
        // Try to load from external file
        const response = await fetch('/vm-explorer-snippet.js');
        const text = await response.text();
        // Extract the snippet from the file
        const match = text.match(/const vmExplorerSnippet = `([\s\S]*?)`;/);
        vmExplorerSnippet = match ? match[1] : null;
    } catch (error) {
        console.warn('Could not load VM explorer snippet from file, using fallback');
        vmExplorerSnippet = null;
    }

    // Fallback to default if external file not available
    if (!vmExplorerSnippet) {
        vmExplorerSnippet = `
  onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
    console.log("VM explorer snippet not loaded - using basic onLoad");
  }`;
    }

    if (!editorView) {
        showError('Code editor is not available');
        return;
    }

    try {
        // Get current code
        const currentCode = editorView.state.doc.toString();

        // Check if VM explorer is already present
        const hasVmExplorer = currentCode.includes('viewModelInstance') || currentCode.includes('vmExplore');

        // Parse the current config to preserve other properties like stateMachines
        let currentConfig = {};
        try {
            const wrappedCode = `(function() { return (${currentCode}); })()`;
            currentConfig = eval(wrappedCode);
        } catch (e) {
            // If parsing fails, we'll just work with the string
        }

        // Decide which snippet to use
        const targetSnippet = hasVmExplorer ? defaultSnippet : vmExplorerSnippet;
        const isRemoving = hasVmExplorer;

        // Find and replace the onLoad section while preserving other properties
        const hasOnLoad = currentCode.includes('onLoad:');

        let newCode;
        if (hasOnLoad && typeof currentConfig === 'object' && currentConfig !== null) {
            // Build new config preserving all properties except onLoad
            const props = [];

            // Preserve all non-onLoad properties
            for (const key in currentConfig) {
                if (key !== 'onLoad') {
                    if (key === 'stateMachines' && Array.isArray(currentConfig[key])) {
                        props.push(`  ${key}: ${JSON.stringify(currentConfig[key])}`);
                    } else if (typeof currentConfig[key] === 'boolean' || typeof currentConfig[key] === 'number') {
                        props.push(`  ${key}: ${currentConfig[key]}`);
                    } else if (typeof currentConfig[key] === 'string') {
                        props.push(`  ${key}: "${currentConfig[key]}"`);
                    }
                }
            }

            // Add the target onLoad
            props.push(`  ${targetSnippet.trim()}`);

            newCode = `// You can define functions and helpers here
// riveInst is available as a global variable

({
${props.join(',\n')}
})`;
        } else if (hasOnLoad) {
            // Fallback to regex replacement if parsing failed
            // Replace existing onLoad with target version
            // Match onLoad: () => { ... } including multi-line content
            newCode = currentCode.replace(/onLoad:\s*\(\)\s*=>\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g, targetSnippet.trim());

            // If the regex didn't work, try a simpler approach
            if (newCode === currentCode) {
                // Find the start of onLoad
                const onLoadStart = currentCode.indexOf('onLoad:');
                if (onLoadStart !== -1) {
                    // Find the matching closing brace
                    let braceCount = 0;
                    let i = currentCode.indexOf('{', onLoadStart);
                    let start = i;
                    while (i < currentCode.length) {
                        if (currentCode[i] === '{') braceCount++;
                        if (currentCode[i] === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                // Found the matching closing brace
                                newCode = currentCode.substring(0, onLoadStart) + targetSnippet.trim() + currentCode.substring(i + 1);
                                break;
                            }
                        }
                        i++;
                    }
                }
            }
        } else {
            // Insert snippet before the closing })
            const beforeClosing = currentCode.lastIndexOf('})');
            if (beforeClosing === -1) {
                showError('Could not find closing }) in the code');
                return;
            }
            newCode = currentCode.slice(0, beforeClosing - 1) + ',' + targetSnippet + '\n' + currentCode.slice(beforeClosing - 1);
        }

        // Update the editor based on whether it's CodeMirror or textarea
        if (editorView.dispatch) {
            // CodeMirror
            editorView.dispatch({
                changes: {
                    from: 0,
                    to: editorView.state.doc.length,
                    insert: newCode
                }
            });
        } else if (editorView.dom) {
            // Textarea fallback
            editorView.dom.value = newCode;
        }

        // Show appropriate message
        if (isRemoving) {
            updateInfo('VM explorer removed - restored default');
            console.log('VM explorer removed. Default onLoad restored.');
        } else {
            updateInfo('VM explorer code injected - Apply & Reload');
            // Display comprehensive usage guide
            console.log('%cRive VM Explorer Injected Successfully', 'color: #4CAF50; font-size: 16px; font-weight: bold');
            console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #666');
            console.log('%cAvailable Commands (after reload):', 'color: #2196F3; font-weight: bold');
            console.log('  %cvmExplore()%c or %cvmExplore("path")%c', 'color: #4CAF50; font-family: monospace', 'color: #888', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('    → Show interactive table of properties at root or specified path');
            console.log('    → Example: vmExplore("myGroup/subItem")');
            console.log('  %cvmGet("path")%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('    → Get current value at path');
            console.log('    → Example: vmGet("settings/volume")');
            console.log('  %cvmSet("path", value)%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('    → Update value at path');
            console.log('    → Example: vmSet("settings/volume", 0.8)');
            console.log('  %cvmFire("path")%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('    → Fire a trigger input at path');
            console.log('    → Example: vmFire("settings/apply")');
            console.log('');
            console.log('%cAvailable Data Structures:', 'color: #FF9800; font-weight: bold');
            console.log('  %cvmTree%c         - Full hierarchical structure of all ViewModels', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('  %cvmPaths%c        - Array of all scalar property paths (ready for get/set)', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('  %cvmInputs%c       - Full list of detected writable VM inputs', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('  %cvmRootInstance%c - The root ViewModelInstance object', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('');
            console.log('%cQuick Start:', 'color: #9C27B0; font-weight: bold');
            console.log('  1. Click "Apply & Reload" to load with VM explorer');
            console.log('  2. Run %cvmExplore()%c to see all available properties', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('  3. Navigate deeper with %cvmExplore("path/to/item")%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('  4. Read values with %cvmGet("path")%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('  5. Modify values with %cvmSet("path", newValue)%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('  6. Fire triggers with %cvmFire("path")%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
            console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #666');
        }
    } catch (error) {
        showError(`Failed to modify code: ${error.message}`);
    }
}

async function createDemoBundle() {
    const invoke = getTauriInvoker();
    if (!invoke) {
        showError('Demo bundles can only be created inside the desktop app.');
        return;
    }

    if (!currentFileBuffer || !currentFileName) {
        showError('Please load a Rive file first.');
        return;
    }

    const runtimeAsset = runtimeAssets[currentRuntime];
    if (!runtimeAsset?.text) {
        showError('Runtime data is not ready yet. Please wait for the runtime to finish loading.');
        return;
    }

    const configuredStateMachines = normalizeStateMachineSelection(lastInitConfig.stateMachines);
    const detectedStateMachines = Array.isArray(riveInstance?.stateMachineNames)
        ? riveInstance.stateMachineNames
        : [];
    const stateMachines = configuredStateMachines.length ? configuredStateMachines : detectedStateMachines;

    const payload = {
        file_name: currentFileName,
        animation_base64: arrayBufferToBase64(currentFileBuffer),
        runtime_name: currentRuntime,
        runtime_version: runtimeAsset.version,
        runtime_script: runtimeAsset.text,
        autoplay: typeof lastInitConfig.autoplay === 'boolean' ? lastInitConfig.autoplay : true,
        layout_fit: currentLayoutFit,
        state_machines: stateMachines,
        artboard_name: currentArtboardName,
        canvas_color: currentCanvasColor,
    };

    updateInfo('Building demo bundle...');
    try {
        const outputPath = await invoke('make_demo_bundle', { payload });
        updateInfo(`Demo bundle saved to: ${outputPath}`);
    } catch (error) {
        showError(`Failed to create demo bundle: ${error.message || error}`);
    }
}

function updateInfo(message) {
    if (elements.info) {
        elements.info.textContent = message;
    }
}

function showError(message) {
    if (elements.error) {
        elements.error.textContent = message;
        elements.error.classList.add('visible');
        if (errorTimeoutId) {
            clearTimeout(errorTimeoutId);
        }
        errorTimeoutId = setTimeout(() => {
            hideError();
        }, 6000);
    }
}

function hideError() {
    if (elements.error) {
        elements.error.textContent = '';
        elements.error.classList.remove('visible');
    }
    if (errorTimeoutId) {
        clearTimeout(errorTimeoutId);
        errorTimeoutId = null;
    }
}

function getEditorConfig() {
    if (!editorView) {
        return {};
    }

    const code = editorView.state.doc.toString().trim();
    if (!code) {
        return {};
    }

    let result;
    try {
        // Evaluate JavaScript code with access to global scope
        // Wrap in parentheses to handle leading comments
        const wrappedCode = `(function() {
            return (
                ${code}
            );
        })()`;
        result = eval(wrappedCode);
    } catch (error) {
        throw new Error(`Invalid JavaScript config: ${error.message}`);
    }

    if (!result || Array.isArray(result) || typeof result !== 'object') {
        throw new Error('Initialization config must return an object');
    }

    return result;
}

function resizeCanvas(canvas) {
    const container = elements.canvasContainer;
    if (!container || !canvas) {
        return;
    }
    const { clientWidth, clientHeight } = container;
    canvas.width = clientWidth;
    canvas.height = clientHeight;
}

function handleResize() {
    const canvas = document.getElementById('rive-canvas');
    if (!canvas) {
        return;
    }
    resizeCanvas(canvas);
    if (riveInstance) {
        riveInstance.resizeDrawingSurfaceToCanvas();
    }
}

function cleanupInstance() {
    if (riveInstance?.cleanup) {
        riveInstance.cleanup();
    }
    riveInstance = null;
    window.riveInst = null;
    resetVmInputControls('No animation loaded.');
}

function revokeLastObjectUrl() {
    if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }
}

function updateCanvasBackground() {
    if (elements.canvasContainer) {
        elements.canvasContainer.style.background = currentCanvasColor;
    }
}

function updateVersionInfo(statusMessage) {
    if (!elements.versionInfo) {
        return;
    }

    const appVersion = resolvedAppVersion || 'dev';
    const releaseLine = `Release: v${appVersion}`;
    const footer = '<div class="version-footer">© 2025 IVG Design · MIT License · Runtime © Rive</div>';

    if (statusMessage) {
        elements.versionInfo.innerHTML = `${releaseLine}<br>${statusMessage}${footer}`;
        return;
    }

    const runtime = runtimeRegistry[currentRuntime];
    if (!runtime) {
        elements.versionInfo.innerHTML = `${releaseLine}<br>Runtime ${currentRuntime} is loading...${footer}`;
        return;
    }

    const version = runtimeVersions[currentRuntime] || runtime.version || 'resolving...';
    const source = runtimeResolvedUrls[currentRuntime] || runtimeSources[currentRuntime];
    elements.versionInfo.innerHTML = `
        ${releaseLine}<br>
        Runtime: ${currentRuntime}<br>
        Version: ${version}<br>
        Source: ${source}
        ${footer}
    `;
}

function loadRuntime(runtimeName) {
    if (runtimeRegistry[runtimeName]) {
        return Promise.resolve(runtimeRegistry[runtimeName]);
    }

    if (runtimePromises[runtimeName]) {
        return runtimePromises[runtimeName];
    }

    const scriptUrl = runtimeSources[runtimeName];
    if (!scriptUrl) {
        return Promise.reject(new Error(`Unknown runtime: ${runtimeName}`));
    }

    runtimePromises[runtimeName] = (async () => {
        const asset = await prepareRuntimeAsset(runtimeName);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = asset.objectUrl;
            script.async = true;
            script.onload = () => {
                if (!window.rive) {
                    reject(new Error('Runtime did not expose the expected API'));
                    return;
                }
                runtimeRegistry[runtimeName] = window.rive;
                if (runtimeName === currentRuntime) {
                    updateVersionInfo();
                }
                resolve(window.rive);
            };
            script.onerror = () => reject(new Error(`Failed to load runtime from ${script.src}`));
            document.head.appendChild(script);
        });
    })();

    return runtimePromises[runtimeName];
}

async function prepareRuntimeAsset(runtimeName) {
    if (runtimeAssets[runtimeName]) {
        return runtimeAssets[runtimeName];
    }

    const scriptUrl = runtimeSources[runtimeName];
    if (!scriptUrl) {
        throw new Error(`Unknown runtime: ${runtimeName}`);
    }

    const { resolvedUrl, version } = await resolveRuntimeSource(scriptUrl, runtimeName);
    const asset = await fetchRuntimeAsset(resolvedUrl);
    const record = {
        objectUrl: asset.objectUrl,
        text: asset.text,
        resolvedUrl,
        version: version || runtimeMeta[runtimeName]?.version || extractVersionFromUrl(resolvedUrl) || 'unknown',
    };

    if (runtimeBlobUrls[runtimeName]) {
        URL.revokeObjectURL(runtimeBlobUrls[runtimeName]);
    }

    runtimeBlobUrls[runtimeName] = record.objectUrl;
    runtimeSourceTexts[runtimeName] = record.text;
    runtimeResolvedUrls[runtimeName] = resolvedUrl;
    runtimeVersions[runtimeName] = record.version;
    runtimeAssets[runtimeName] = record;
    persistRuntimeMeta(runtimeName, {
        resolvedUrl,
        version: record.version,
        cachedAt: Date.now(),
    });

    return record;
}

async function fetchRuntimeAsset(resolvedUrl) {
    if (typeof caches === 'undefined') {
        return fetchRuntimeDirectly(resolvedUrl);
    }

    const cache = await caches.open(RUNTIME_CACHE_NAME);
    let response = await cache.match(resolvedUrl);
    if (!response) {
        response = await fetchRuntimeRequest(resolvedUrl);
        await cache.put(resolvedUrl, response.clone());
    }
    return responseToRuntimeAsset(response);
}

async function fetchRuntimeDirectly(resolvedUrl) {
    const response = await fetchRuntimeRequest(resolvedUrl);
    return responseToRuntimeAsset(response);
}

async function fetchRuntimeRequest(resolvedUrl) {
    const response = await fetch(resolvedUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to download runtime (${response.status})`);
    }
    return response;
}

async function responseToRuntimeAsset(response) {
    let text = await response.clone().text();

    // Strip sourceMappingURL to prevent blob warnings in Tauri/WebKit
    text = text.replace(/\/\/# sourceMappingURL=.*$/gm, '');

    // Create blob from cleaned text instead of original response
    const blob = new Blob([text], { type: 'application/javascript' });
    const objectUrl = URL.createObjectURL(blob);
    return { text, objectUrl };
}

async function ensureRuntime(runtimeName) {
    const runtime = await loadRuntime(runtimeName);
    window.rive = runtime;
    warnIfRuntimeLacksScripting(runtimeName);
    if (runtimeName === currentRuntime) {
        updateVersionInfo();
    }
    return runtime;
}

function warnIfRuntimeLacksScripting(runtimeName) {
    const version = runtimeVersions[runtimeName] || runtimeRegistry[runtimeName]?.version;
    if (!version || isSemverAtLeast(version, MIN_SCRIPTING_RUNTIME_VERSION)) {
        return;
    }
    const warningKey = `${runtimeName}@${version}`;
    if (runtimeWarningsShown.has(warningKey)) {
        return;
    }
    runtimeWarningsShown.add(warningKey);
    showError(`Runtime ${runtimeName}@${version} is below ${MIN_SCRIPTING_RUNTIME_VERSION}; VM scripting may be unavailable.`);
}

function isSemverAtLeast(version, minimum) {
    const currentParts = parseSemverParts(version);
    const minimumParts = parseSemverParts(minimum);
    if (!currentParts || !minimumParts) {
        return true;
    }
    for (let index = 0; index < 3; index += 1) {
        if (currentParts[index] > minimumParts[index]) {
            return true;
        }
        if (currentParts[index] < minimumParts[index]) {
            return false;
        }
    }
    return true;
}

function parseSemverParts(rawVersion) {
    const match = String(rawVersion || '').match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
        return null;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function resetVmInputControls(message = 'No bound ViewModel inputs detected.') {
    const panel = elements.vmControlsPanel;
    const count = elements.vmControlsCount;
    const empty = elements.vmControlsEmpty;
    const list = elements.vmControlsList;
    if (!panel || !count || !empty || !list) {
        return;
    }
    list.innerHTML = '';
    count.textContent = '0';
    empty.hidden = false;
    empty.textContent = message;
}

function renderVmInputControls() {
    const panel = elements.vmControlsPanel;
    const count = elements.vmControlsCount;
    const empty = elements.vmControlsEmpty;
    const list = elements.vmControlsList;
    if (!panel || !count || !empty || !list) {
        return;
    }

    const rootVm = resolveVmRootInstance();
    if (!rootVm) {
        resetVmInputControls('No bound ViewModel inputs detected.');
        return;
    }

    const descriptors = collectVmInputDescriptors(rootVm);
    list.innerHTML = '';
    count.textContent = String(descriptors.length);

    if (!descriptors.length) {
        empty.hidden = false;
        empty.textContent = 'No writable ViewModel inputs were found.';
        return;
    }

    empty.hidden = true;
    descriptors.forEach((descriptor) => {
        list.appendChild(createVmControlRow(descriptor));
    });
}

function resolveVmRootInstance() {
    if (!riveInstance) {
        return null;
    }
    if (riveInstance.viewModelInstance) {
        return riveInstance.viewModelInstance;
    }

    try {
        const defaultViewModel = typeof riveInstance.defaultViewModel === 'function'
            ? riveInstance.defaultViewModel()
            : null;
        if (!defaultViewModel) {
            return null;
        }
        if (typeof defaultViewModel.defaultInstance === 'function') {
            return defaultViewModel.defaultInstance();
        }
        if (typeof defaultViewModel.instance === 'function') {
            return defaultViewModel.instance();
        }
    } catch (error) {
        console.warn('Unable to resolve default ViewModel instance', error);
    }

    return null;
}

function collectVmInputDescriptors(rootVm) {
    const descriptors = [];
    const seenPaths = new Set();
    const activeInstances = new WeakSet();

    const walk = (instance, basePath) => {
        if (!instance || typeof instance !== 'object') {
            return;
        }
        if (activeInstances.has(instance)) {
            return;
        }
        activeInstances.add(instance);

        const properties = Array.isArray(instance.properties) ? instance.properties : [];
        properties.forEach((property) => {
            const name = property?.name;
            if (typeof name !== 'string' || !name) {
                return;
            }

            const fullPath = basePath ? `${basePath}/${name}` : name;
            const accessorInfo = getVmAccessor(rootVm, fullPath);
            if (accessorInfo && VM_CONTROL_KINDS.has(accessorInfo.kind) && !seenPaths.has(fullPath)) {
                descriptors.push({
                    path: fullPath,
                    kind: accessorInfo.kind,
                });
                seenPaths.add(fullPath);
            }

            const nestedVm = safeVmMethodCall(instance, 'viewModelInstance', name)
                || safeVmMethodCall(instance, 'viewModel', name);
            if (nestedVm && nestedVm !== instance) {
                walk(nestedVm, fullPath);
            }

            const listAccessor = safeVmMethodCall(instance, 'list', name);
            const listLength = getVmListLength(listAccessor);
            for (let index = 0; index < listLength; index += 1) {
                const itemInstance = getVmListItemAt(listAccessor, index);
                if (!itemInstance) {
                    continue;
                }
                const itemPath = `${fullPath}/${index}`;
                walk(itemInstance, itemPath);
            }
        });

        activeInstances.delete(instance);
    };

    walk(rootVm, '');
    return descriptors.sort((a, b) => a.path.localeCompare(b.path));
}

function createVmControlRow(descriptor) {
    const row = document.createElement('div');
    row.className = 'vm-control-row';

    const label = document.createElement('div');
    label.className = 'vm-control-path';
    label.textContent = `${descriptor.path} (${descriptor.kind})`;

    const inputContainer = document.createElement('div');
    inputContainer.className = 'vm-control-input';

    const accessor = resolveVmAccessor(descriptor.path, descriptor.kind);
    const isDisabled = !accessor;

    if (descriptor.kind === 'number') {
        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.step = 'any';
        numberInput.value = Number.isFinite(accessor?.value) ? String(accessor.value) : '0';
        numberInput.disabled = isDisabled;
        numberInput.addEventListener('change', () => {
            const nextValue = Number(numberInput.value);
            if (!Number.isFinite(nextValue)) {
                return;
            }
            const liveAccessor = resolveVmAccessor(descriptor.path, 'number');
            if (liveAccessor) {
                liveAccessor.value = nextValue;
            }
        });
        inputContainer.appendChild(numberInput);
    } else if (descriptor.kind === 'boolean') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(accessor?.value);
        checkbox.disabled = isDisabled;
        checkbox.addEventListener('change', () => {
            const liveAccessor = resolveVmAccessor(descriptor.path, 'boolean');
            if (liveAccessor) {
                liveAccessor.value = checkbox.checked;
            }
        });
        inputContainer.appendChild(checkbox);
    } else if (descriptor.kind === 'string') {
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = typeof accessor?.value === 'string' ? accessor.value : '';
        textInput.disabled = isDisabled;
        textInput.addEventListener('change', () => {
            const liveAccessor = resolveVmAccessor(descriptor.path, 'string');
            if (liveAccessor) {
                liveAccessor.value = textInput.value;
            }
        });
        inputContainer.appendChild(textInput);
    } else if (descriptor.kind === 'enum') {
        const select = document.createElement('select');
        const values = Array.isArray(accessor?.values) ? accessor.values : [];
        values.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
        if (values.length === 0) {
            const fallback = document.createElement('option');
            fallback.value = '';
            fallback.textContent = '(no enum values)';
            select.appendChild(fallback);
        }
        if (typeof accessor?.value === 'string') {
            select.value = accessor.value;
        }
        select.disabled = isDisabled || values.length === 0;
        select.addEventListener('change', () => {
            const liveAccessor = resolveVmAccessor(descriptor.path, 'enum');
            if (liveAccessor) {
                liveAccessor.value = select.value;
            }
        });
        inputContainer.appendChild(select);
    } else if (descriptor.kind === 'color') {
        const colorWrap = document.createElement('div');
        colorWrap.className = 'vm-color-control';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        const alphaInput = document.createElement('input');
        alphaInput.type = 'number';
        alphaInput.min = '0';
        alphaInput.max = '100';
        alphaInput.step = '1';

        const colorMeta = argbToColorMeta(accessor?.value);
        colorInput.value = colorMeta.hex;
        alphaInput.value = String(colorMeta.alphaPercent);
        colorInput.disabled = isDisabled;
        alphaInput.disabled = isDisabled;

        const applyColor = () => {
            const liveAccessor = resolveVmAccessor(descriptor.path, 'color');
            if (!liveAccessor) {
                return;
            }
            const rgb = hexToRgb(colorInput.value);
            const alphaPercent = clamp(Number(alphaInput.value), 0, 100);
            alphaInput.value = String(Math.round(alphaPercent));
            const alpha = Math.round((alphaPercent / 100) * 255);
            if (typeof liveAccessor.argb === 'function') {
                liveAccessor.argb(alpha, rgb.r, rgb.g, rgb.b);
                return;
            }
            liveAccessor.value = rgbAlphaToArgb(rgb.r, rgb.g, rgb.b, alpha);
        };

        colorInput.addEventListener('input', applyColor);
        alphaInput.addEventListener('change', applyColor);

        colorWrap.appendChild(colorInput);
        colorWrap.appendChild(alphaInput);
        inputContainer.appendChild(colorWrap);
    } else if (descriptor.kind === 'trigger') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Fire';
        button.disabled = isDisabled;
        button.addEventListener('click', () => {
            const liveAccessor = resolveVmAccessor(descriptor.path, 'trigger');
            if (!liveAccessor) {
                return;
            }
            if (typeof liveAccessor.trigger === 'function') {
                liveAccessor.trigger();
                return;
            }
            if (typeof liveAccessor.fire === 'function') {
                liveAccessor.fire();
            }
        });
        inputContainer.appendChild(button);
    }

    row.appendChild(label);
    row.appendChild(inputContainer);
    return row;
}

function resolveVmAccessor(path, expectedKind) {
    const rootVm = resolveVmRootInstance();
    if (!rootVm) {
        return null;
    }
    const accessorInfo = getVmAccessor(rootVm, path);
    if (!accessorInfo) {
        return null;
    }
    if (expectedKind && accessorInfo.kind !== expectedKind) {
        return null;
    }
    return accessorInfo.accessor;
}

function getVmAccessor(rootVm, path) {
    const probes = [
        ['number', 'number'],
        ['boolean', 'boolean'],
        ['string', 'string'],
        ['enum', 'enum'],
        ['color', 'color'],
        ['trigger', 'trigger'],
    ];

    for (const [kind, methodName] of probes) {
        const accessor = safeVmMethodCall(rootVm, methodName, path);
        if (accessor) {
            return { kind, accessor };
        }
    }

    return null;
}

function safeVmMethodCall(target, methodName, ...args) {
    if (!target || typeof target[methodName] !== 'function') {
        return null;
    }
    try {
        return target[methodName](...args) || null;
    } catch {
        return null;
    }
}

function getVmListLength(listAccessor) {
    if (!listAccessor) {
        return 0;
    }
    if (typeof listAccessor.length === 'number') {
        return Math.max(0, Math.floor(listAccessor.length));
    }
    if (typeof listAccessor.size === 'number') {
        return Math.max(0, Math.floor(listAccessor.size));
    }
    return 0;
}

function getVmListItemAt(listAccessor, index) {
    if (!listAccessor || typeof listAccessor.instanceAt !== 'function') {
        return null;
    }
    try {
        return listAccessor.instanceAt(index);
    } catch {
        return null;
    }
}

function argbToColorMeta(value) {
    const rawValue = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
    const alpha = (rawValue >>> 24) & 255;
    const red = (rawValue >>> 16) & 255;
    const green = (rawValue >>> 8) & 255;
    const blue = rawValue & 255;
    return {
        hex: `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`,
        alphaPercent: Math.round((alpha / 255) * 100),
    };
}

function toHexByte(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function hexToRgb(hex) {
    const cleanHex = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
        return { r: 0, g: 0, b: 0 };
    }
    return {
        r: parseInt(cleanHex.slice(0, 2), 16),
        g: parseInt(cleanHex.slice(2, 4), 16),
        b: parseInt(cleanHex.slice(4, 6), 16),
    };
}

function rgbAlphaToArgb(red, green, blue, alpha) {
    return (
        ((clamp(alpha, 0, 255) & 255) << 24)
        | ((clamp(red, 0, 255) & 255) << 16)
        | ((clamp(green, 0, 255) & 255) << 8)
        | (clamp(blue, 0, 255) & 255)
    ) >>> 0;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

// Expose controls for inline handlers
window.applyCodeAndReload = applyCodeAndReload;
window.play = play;
window.pause = pause;
window.reset = reset;
window.createDemoBundle = createDemoBundle;
window.injectCodeSnippet = injectCodeSnippet;
window.handleFileButtonClick = handleFileButtonClick;
window.refreshVmInputControls = renderVmInputControls;
window.__riveRuntimeCache = {
    getRuntimeSourceText: (runtimeName) => runtimeSourceTexts[runtimeName] || null,
    getRuntimeVersion: (runtimeName) => runtimeVersions[runtimeName] || null,
};
window.__riveAnimationCache = {
    getBuffer: () => currentFileBuffer,
    getName: () => currentFileName,
    getMimeType: () => currentFileMimeType,
};

function arrayBufferToBase64(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
        return '';
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

function normalizeStateMachineSelection(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return [value];
    }
    return [];
}

function autoFillConfigStateMachine(names) {
    if (!editorView) {
        return false;
    }
    if (configDirty) {
        return false;
    }
    if (!Array.isArray(names) || !names.length) {
        return false;
    }
    const current = editorView.state.doc.toString().trim();
    let parsed;
    if (!current) {
        parsed = {};
    } else {
        try {
            // Try to evaluate the current code
            const wrappedCode = `(function() {
                return (
                    ${current}
                );
            })()`;
            parsed = eval(wrappedCode);
        } catch (e) {
            console.warn('Failed to parse config for auto-fill:', e);
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return;
        }
    }

    const primary = names[0];

    // Check if already set to the correct state machine
    if (parsed.stateMachines === primary ||
        (Array.isArray(parsed.stateMachines) && parsed.stateMachines[0] === primary)) {
        return false;
    }

    // Build new config preserving other user settings
    const hasOnLoad = typeof parsed.onLoad === 'function';
    const autoplay = typeof parsed.autoplay === 'boolean' ? parsed.autoplay : true;
    const autoBind = typeof parsed.autoBind === 'boolean' ? parsed.autoBind : true;

    const onLoadCode = `onLoad: () => {\n    riveInst.resizeDrawingSurfaceToCanvas();\n    window.refreshVmInputControls?.();\n  }`;

    const newCode = `// You can define functions and helpers here
// riveInst is available as a global variable

({
  autoplay: ${autoplay},
  autoBind: ${autoBind},
  stateMachines: ${JSON.stringify(primary)},
  ${onLoadCode}
})`;

    isAutoFilling = true;
    editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: newCode }
    });
    isAutoFilling = false;

    parsed.stateMachines = primary;
    lastInitConfig = { ...parsed };
    configDirty = false;

    return true;
}

function getTauriInvoker() {
    if (window.__TAURI__?.invoke) {
        return window.__TAURI__.invoke.bind(window.__TAURI__);
    }
    if (typeof window.__TAURI_IPC__ === 'function') {
        return (cmd, args = {}) =>
            new Promise((resolve, reject) => {
                const successId = makeCallbackId('tauri_cb');
                const errorId = makeCallbackId('tauri_err');

                window[successId] = (data) => {
                    cleanupBridgeCallbacks(successId, errorId);
                    resolve(data);
                };
                window[errorId] = (error) => {
                    cleanupBridgeCallbacks(successId, errorId);
                    reject(error);
                };

                window.__TAURI_IPC__({
                    cmd,
                    callback: successId,
                    error: errorId,
                    ...args,
                });
            });
    }
    return null;
}

function cleanupBridgeCallbacks(...ids) {
    ids.forEach((id) => Reflect.deleteProperty(window, id));
}

function makeCallbackId(prefix) {
    if (window.crypto?.randomUUID) {
        return `_${prefix}_${window.crypto.randomUUID()}`;
    }
    return `_${prefix}_${Math.random().toString(36).slice(2)}${Date.now()}`;
}

function loadRuntimeMeta() {
    try {
        const raw = localStorage.getItem(RUNTIME_META_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function persistRuntimeMeta(runtimeName, meta) {
    runtimeMeta[runtimeName] = meta;
    try {
        localStorage.setItem(RUNTIME_META_STORAGE_KEY, JSON.stringify(runtimeMeta));
    } catch {
        /* ignore storage errors */
    }
}

async function resolveRuntimeSource(scriptUrl, runtimeName) {
    try {
        const response = await fetch(scriptUrl, { method: 'HEAD' });
        if (!response.ok) {
            throw new Error(`Failed to resolve runtime version (${response.status})`);
        }
        const resolvedUrl = response.url || scriptUrl;
        const headerVersion = response.headers.get('x-jsd-version') || response.headers.get('x-rv-version');
        return {
            resolvedUrl,
            version: headerVersion || extractVersionFromUrl(resolvedUrl),
        };
    } catch (error) {
        const stored = runtimeMeta[runtimeName];
        if (stored?.resolvedUrl) {
            console.warn('Falling back to cached runtime metadata', error);
            return {
                resolvedUrl: stored.resolvedUrl,
                version: stored.version || null,
            };
        }
        console.warn('Unable to resolve runtime version metadata', error);
        return { resolvedUrl: scriptUrl, version: null };
    }
}

function extractVersionFromUrl(url) {
    const match = /@([^/]+)/.exec(url);
    return match ? match[1] : null;
}

function handleFileButtonClick() {
    if (!elements.fileInput) {
        return;
    }
    if (currentFileUrl) {
        clearCurrentFile();
        updateFileTriggerButton('empty');
        elements.fileInput.value = '';
    }
    elements.fileInput.click();
}

function clearCurrentFile() {
    cleanupInstance();
    if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
    }
    currentFileUrl = null;
    currentFileName = null;
    currentFileBuffer = null;
    currentArtboardName = null;
    updateFileTriggerButton('empty');
    elements.canvasContainer.innerHTML = `
        <div class="placeholder">
            <p>Upload a .riv file</p>
            <p style="font-size: 11px; margin-top: 10px; opacity: 0.6;">Use the runtime & layout controls above</p>
        </div>
    `;
}

function updateFileTriggerButton(state, fileName) {
    const button = elements.fileTriggerButton || document.getElementById('file-trigger-btn');
    if (!button) {
        return;
    }
    if (state === 'loaded' && fileName) {
        button.classList.remove('primary');
        button.classList.add('loaded');
        button.textContent = fileName;
        button.title = fileName;
    } else {
        button.classList.remove('loaded');
        button.classList.add('primary');
        button.textContent = 'Choose File';
        button.title = 'Choose File';
    }
}
async function resolveAppVersion() {
    if (resolvedAppVersion && resolvedAppVersion !== '__APP_VERSION__') {
        return;
    }
    try {
        const response = await fetch('package.json', { cache: 'no-store' });
        if (response.ok) {
            const data = await response.json();
            if (data?.version) {
                resolvedAppVersion = data.version;
                updateVersionInfo();
            }
        }
    } catch {
        if (!resolvedAppVersion || resolvedAppVersion === '__APP_VERSION__') {
            resolvedAppVersion = 'dev';
        }
    }
}
