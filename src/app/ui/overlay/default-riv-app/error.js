export function describeDefaultRivAppFailure(status = {}) {
    const reason = String(status.reason || '').trim();
    if (reason) return reason;
    const handlerName = String(status.handlerName || '').trim();
    const resolvedPath = String(status.resolvedHandlerPath || '').trim();
    const dynamicPath = Array.isArray(status.contentTypeHandlers)
        ? status.contentTypeHandlers
            .map((entry) => String(entry?.handlerPath || '').trim())
            .find(Boolean)
        : '';
    const canonicalPath = String(status.canonicalHandlerPath || '').trim();
    const riviewPath = String(status.riviewHandlerPath || '').trim();
    const playPath = String(status.playHandlerPath || '').trim();
    const legacyPath = String(status.legacyHandlerPath || '').trim();
    const handler = handlerName || resolvedPath || dynamicPath || canonicalPath
        || riviewPath || playPath || legacyPath;
    if (handler) return `macOS still reports ${handler} as the default .riv app.`;
    return 'macOS did not confirm RAV as the default .riv app.';
}
