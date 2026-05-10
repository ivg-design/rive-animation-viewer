export function normalizeConsoleEntries(entries, normalizeSerializable) {
    return entries.map((entry) => ({
        method: entry.method,
        timestamp: entry.timestamp,
        args: entry.args.map(normalizeSerializable),
    }));
}

function resolveEntryPayload(entry) {
    if (!entry || !Array.isArray(entry.args) || !entry.args.length) {
        return undefined;
    }
    if (entry.args.length === 1) {
        return entry.args[0];
    }
    return entry.args;
}

export function summarizeConsoleExecution({ code, entries, normalizeSerializable }) {
    const normalizedEntries = normalizeConsoleEntries(entries, normalizeSerializable);
    const resultEntry = normalizedEntries.findLast((entry) => entry.method === 'result');
    const errorEntry = normalizedEntries.find((entry) => entry.method === 'error');
    const ok = !errorEntry || !!resultEntry;

    return {
        ok,
        code,
        entries: normalizedEntries,
        ...(resultEntry ? { result: resolveEntryPayload(resultEntry) } : {}),
        ...(!ok && errorEntry ? { error: String(resolveEntryPayload(errorEntry) ?? 'Console execution failed') } : {}),
    };
}

export async function waitForConsoleTranscript(setTimeoutFn) {
    await Promise.resolve();
    if (typeof setTimeoutFn !== 'function') {
        return;
    }
    await new Promise((resolve) => setTimeoutFn(resolve, 0));
}
