import {
    createCodeEditorController,
    evaluateEditorConfig,
    extractBraceBlock,
    replaceOnLoadBlock,
} from '../../../src/app/ui/code-editor.js';

describe('ui/code-editor', () => {
    it('replaces and extracts onLoad blocks', () => {
        const baseCode = `({
  autoplay: true,
  onLoad: () => {
    console.log("ready");
  }
})`;

        expect(replaceOnLoadBlock(baseCode, 'onLoad: () => { riveInst.play(); }')).toContain('riveInst.play();');
        expect(replaceOnLoadBlock('({ autoplay: true })', 'onLoad: () => { riveInst.play(); }')).toContain('onLoad: () => { riveInst.play(); }');

        const source = 'const snippet = `onLoad: () => { if (true) { riveInst.play(); } }`;';
        const start = source.indexOf('onLoad:');
        expect(extractBraceBlock(source, start, 'onLoad:')).toBe('onLoad: () => { if (true) { riveInst.play(); } }');
    });

    it('evaluates object configs and rejects invalid values', () => {
        expect(evaluateEditorConfig('({ autoplay: true, stateMachines: "main" })')).toEqual({
            autoplay: true,
            stateMachines: 'main',
        });
        expect(() => evaluateEditorConfig('[]')).toThrow('Initialization config must return an object');
        expect(() => evaluateEditorConfig('({')).toThrow('Invalid JavaScript config');
    });

    it('boots the fallback editor, reloads the animation, and toggles the VM explorer snippet', async () => {
        document.body.innerHTML = '<div id="code-editor"></div>';

        const refreshCurrentState = vi.fn().mockResolvedValue(true);
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            text: async () => 'const vmExplorerSnippet = `onLoad: () => { vmExplore(); }`;',
        }));
        const controller = createCodeEditorController({
            callbacks: {
                getTauriInvoker: () => vi.fn().mockResolvedValue(undefined),
                refreshCurrentState,
                logEvent: vi.fn(),
                showError: vi.fn(),
                updateInfo: vi.fn(),
            },
            fetchImpl,
            getCurrentFileName: () => 'demo.riv',
            getCurrentFileUrl: () => 'blob:demo',
            loadCodeMirror: async () => false,
            setTimeoutFn: (callback) => {
                callback();
                return 1;
            },
        });

        await controller.setupCodeEditor();

        expect(controller.getEditorCode()).toContain('autoplay: true');
        expect(controller.getEditorConfig()).toEqual(expect.objectContaining({
            autoBind: true,
            autoplay: true,
        }));

        await controller.applyCodeAndReload();
        expect(refreshCurrentState).toHaveBeenCalledTimes(1);

        await controller.injectCodeSnippet();
        expect(fetchImpl).toHaveBeenCalledWith('/vm-explorer-snippet.js');
        expect(controller.getEditorCode()).toContain('vmExplore();');

        await controller.injectCodeSnippet();
        expect(controller.getEditorCode()).not.toContain('vmExplore();');

        controller.setEditorCode('({ autoplay: false })');
        expect(controller.getEditorConfig()).toEqual({ autoplay: false });
    });

    it('reports missing files and missing snippets through the controller surface', async () => {
        document.body.innerHTML = '<div id="code-editor"></div>';

        const showError = vi.fn();
        const controller = createCodeEditorController({
            callbacks: {
                getTauriInvoker: () => null,
                loadRiveAnimation: vi.fn(),
                logEvent: vi.fn(),
                showError,
                updateInfo: vi.fn(),
            },
            fetchImpl: vi.fn(async () => ({ ok: false })),
            getCurrentFileName: () => null,
            getCurrentFileUrl: () => null,
            loadCodeMirror: async () => false,
        });

        expect(controller.setEditorCode('({ autoplay: false })')).toBe(false);
        expect(controller.getEditorConfig()).toEqual({});

        await controller.applyCodeAndReload();
        expect(showError).toHaveBeenCalledWith('Please load a Rive file first');

        await controller.setupCodeEditor();
        await controller.injectCodeSnippet();
        expect(showError).toHaveBeenCalledWith('Could not load VM explorer snippet');
    });

    it('can mount later when the editor container appears after the first setup attempt', async () => {
        document.body.innerHTML = '';

        const controller = createCodeEditorController({
            callbacks: {
                loadRiveAnimation: vi.fn(),
                logEvent: vi.fn(),
                showError: vi.fn(),
                updateInfo: vi.fn(),
            },
            loadCodeMirror: async () => false,
            setTimeoutFn: (callback) => {
                callback();
                return 1;
            },
        });

        await expect(controller.setupCodeEditor()).resolves.toBe(false);
        expect(controller.getEditorCode()).toBeUndefined();

        document.body.innerHTML = '<div id="code-editor"></div>';
        await expect(controller.ensureEditorReady()).resolves.toBe(true);
        expect(controller.getEditorCode()).toContain('autoplay: true');
    });

    it('boots the CodeMirror path and handles tab indentation commands', async () => {
        document.body.innerHTML = '<div id="code-editor"></div>';

        let editorInstance = null;
        class FakeEditorView {
            static lineWrapping = Symbol('lineWrapping');
            static updateListener = {
                of: (listener) => listener,
            };

            constructor({ doc, parent }) {
                this._doc = doc;
                this.dom = document.createElement('div');
                this.dom.className = 'cm-content';
                parent.appendChild(this.dom);
                this.state = {
                    doc: {
                        length: this._doc.length,
                        lineAt: () => ({ from: 0, text: '  foo' }),
                        toString: () => this._doc,
                    },
                    selection: {
                        ranges: [{ from: 0, anchor: 0, head: 0 }],
                    },
                };
                this.dispatch = vi.fn((transaction) => {
                    if (transaction?.changes && !Array.isArray(transaction.changes)) {
                        this._doc = transaction.changes.insert;
                        this.state.doc.length = this._doc.length;
                    }
                });
                editorInstance = this;
            }
        }

        const controller = createCodeEditorController({
            callbacks: {
                loadRiveAnimation: vi.fn(),
                logEvent: vi.fn(),
                showError: vi.fn(),
                updateInfo: vi.fn(),
            },
            codeMirrorModulesRef: () => ({
                EditorView: FakeEditorView,
                basicSetup: 'basic',
                javascript: () => 'javascript',
                oneDark: 'oneDark',
            }),
            loadCodeMirror: async () => true,
            setTimeoutFn: (callback) => {
                callback();
                return 1;
            },
        });

        await controller.setupCodeEditor();
        expect(controller.getEditorCode()).toContain('autoplay: true');

        editorInstance.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        editorInstance.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey: true }));

        expect(editorInstance.dispatch).toHaveBeenCalled();

        controller.setEditorCode('({ autoplay: false, autoBind: true })');
        expect(controller.getEditorCode()).toBe('({ autoplay: false, autoBind: true })');
    });
});
