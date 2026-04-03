export function registerConsoleBindings({
    copyVisibleRows = async () => {},
    elements,
    onClear = () => {},
    onFilterSearch = () => {},
    onFollowToggle = () => {},
    onLevelChange = () => {},
    onScroll = () => {},
    onToggle = () => {},
} = {}) {
    const cleanupFns = [];

    elements.toggleScriptConsoleButton?.addEventListener('click', onToggle);
    cleanupFns.push(() => elements.toggleScriptConsoleButton?.removeEventListener('click', onToggle));

    [
        [elements.scriptConsoleFilterAll, 'all'],
        [elements.scriptConsoleFilterInfo, 'info'],
        [elements.scriptConsoleFilterWarning, 'warning'],
        [elements.scriptConsoleFilterError, 'error'],
    ].forEach(([element, level]) => {
        if (!element) {
            return;
        }
        const handler = () => onLevelChange(level);
        element.addEventListener('click', handler);
        cleanupFns.push(() => element.removeEventListener('click', handler));
    });

    if (elements.scriptConsoleFilterSearch) {
        elements.scriptConsoleFilterSearch.value = '';
        elements.scriptConsoleFilterSearch.addEventListener('input', onFilterSearch);
        cleanupFns.push(() => elements.scriptConsoleFilterSearch?.removeEventListener('input', onFilterSearch));
    }

    if (elements.scriptConsoleFollowButton) {
        elements.scriptConsoleFollowButton.addEventListener('click', onFollowToggle);
        cleanupFns.push(() => elements.scriptConsoleFollowButton?.removeEventListener('click', onFollowToggle));
    }

    if (elements.scriptConsoleCopyButton) {
        elements.scriptConsoleCopyButton.addEventListener('click', copyVisibleRows);
        cleanupFns.push(() => elements.scriptConsoleCopyButton?.removeEventListener('click', copyVisibleRows));
    }

    if (elements.scriptConsoleClearButton) {
        elements.scriptConsoleClearButton.addEventListener('click', onClear);
        cleanupFns.push(() => elements.scriptConsoleClearButton?.removeEventListener('click', onClear));
    }

    return {
        cleanupFns,
        onScroll,
    };
}
