export function buildVisibleConsoleCopyText({
    classifyRow,
    getRows,
    getText,
    root,
} = {}) {
    return getRows(root)
        .filter((row) => !row.hidden)
        .map((row) => {
            const timestamp = row.querySelector('.rav-console-time')?.textContent || '';
            const rowLevel = classifyRow(row);
            const badge = rowLevel === 'command' ? 'CMD'
                : rowLevel === 'result' ? 'RESULT'
                    : rowLevel === 'warning' ? 'WARN'
                        : rowLevel === 'error' ? 'ERROR'
                            : 'LOG';
            const message = getText(row);
            return timestamp ? `[${timestamp}] ${badge} ${message}` : `${badge} ${message}`;
        })
        .join('\n');
}
