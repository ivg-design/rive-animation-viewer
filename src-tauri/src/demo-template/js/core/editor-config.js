function resolveStandaloneEditorConfig(code, sourceMode, onError) {
    if (sourceMode !== 'editor' || typeof code !== 'string' || !code.trim()) return {};
    try {
        var config = (new Function('return (' + code + '\n);'))();
        return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    } catch (error) {
        if (typeof onError === 'function') onError(error);
        return {};
    }
}

function invokeStandaloneEditorCallback(callback, instance, args, onError) {
    if (typeof callback !== 'function') return;
    try {
        callback.apply(instance, args || []);
    } catch (error) {
        if (typeof onError === 'function') onError(error);
    }
}
