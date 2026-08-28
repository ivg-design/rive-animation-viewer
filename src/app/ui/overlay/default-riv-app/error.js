export function describeDefaultRivAppFailure(status = {}) {
    const reason = String(status.reason || '').trim();
    if (reason) return reason;
    const handlerName = String(status.handlerName || '').trim();
    const canonicalPath = String(status.canonicalHandlerPath || '').trim();
    const legacyPath = String(status.legacyHandlerPath || '').trim();
    const handler = handlerName || canonicalPath || legacyPath;
    if (handler) return `macOS still reports ${handler} as the default .riv app.`;
    return 'macOS did not confirm RAV as the default .riv app.';
}
