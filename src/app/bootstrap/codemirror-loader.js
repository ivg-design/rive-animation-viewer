export function createCodeMirrorLoader({ isTauriEnvironment } = {}) {
    let codeMirrorModules = null;

    async function loadCodeMirror() {
        try {
            let modules;

            try {
                modules = await import('/vendor/codemirror-bundle.js');
            } catch (bundleError) {
                if (isTauriEnvironment()) {
                    throw bundleError;
                }
                const [cm, js, theme] = await Promise.all([
                    import('/node_modules/codemirror/dist/index.js'),
                    import('/node_modules/@codemirror/lang-javascript/dist/index.js'),
                    import('/node_modules/@codemirror/theme-one-dark/dist/index.js'),
                ]);
                modules = {
                    basicSetup: cm.basicSetup,
                    EditorView: cm.EditorView,
                    javascript: js.javascript,
                    oneDark: theme.oneDark,
                };
            }

            codeMirrorModules = modules;
            return true;
        } catch (error) {
            console.warn('CodeMirror not available, using fallback textarea', error);
            return false;
        }
    }

    return {
        getModules: () => codeMirrorModules,
        loadCodeMirror,
    };
}
