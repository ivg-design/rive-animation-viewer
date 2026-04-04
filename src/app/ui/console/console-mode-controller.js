export function createConsoleModeController({
    callbacks = {},
    elements,
    eventLogController,
    scriptConsoleController,
} = {}) {
    const {
        logEvent = () => {},
        showError = () => {},
    } = callbacks;

    let currentConsoleView = 'events';
    let syncingConsoleMode = false;

    function isConsoleOpen() {
        return !eventLogController?.isCollapsed?.();
    }

    function deriveConsoleViewFromControllers() {
        return scriptConsoleController?.isOpen?.() ? 'js' : 'events';
    }

    function updateConsoleModeChip() {
        const chip = elements?.consoleModeChip;
        if (!chip) {
            return;
        }

        const open = isConsoleOpen();
        chip.dataset.consoleMode = open ? 'open' : 'closed';
        chip.title = open ? 'Console open (click to close)' : 'Console closed (click to open)';
        if (elements.consoleModeChipLabel) {
            elements.consoleModeChipLabel.textContent = open ? 'CLOSE' : 'OPEN';
        } else {
            chip.textContent = open ? 'CLOSE' : 'OPEN';
        }
    }

    async function setConsoleMode(mode) {
        const normalizedMode = ['closed', 'events', 'js'].includes(mode) ? mode : 'events';
        syncingConsoleMode = true;
        try {
            if (normalizedMode === 'closed') {
                scriptConsoleController.close();
                eventLogController.setCollapsed(true);
                return;
            }

            currentConsoleView = normalizedMode;
            eventLogController.setCollapsed(false);
            if (normalizedMode === 'events') {
                scriptConsoleController.close();
            } else {
                await scriptConsoleController.open();
            }
        } catch (error) {
            currentConsoleView = deriveConsoleViewFromControllers();
            showError(`Failed to open JavaScript console: ${error.message}`);
            logEvent('ui', 'console-open-failed', error.message);
            throw error;
        } finally {
            syncingConsoleMode = false;
            updateConsoleModeChip();
        }
    }

    async function setConsoleOpen(open) {
        if (open) {
            await setConsoleMode(currentConsoleView);
            return;
        }
        syncingConsoleMode = true;
        try {
            scriptConsoleController.close();
            eventLogController.setCollapsed(true);
        } finally {
            syncingConsoleMode = false;
            updateConsoleModeChip();
        }
    }

    async function toggleConsoleOpen() {
        await setConsoleOpen(!isConsoleOpen());
    }

    function handleEventLogCollapsedChange(collapsed) {
        if (syncingConsoleMode) {
            return;
        }

        if (collapsed) {
            if (scriptConsoleController?.isOpen()) {
                scriptConsoleController.close();
            }
        } else {
            currentConsoleView = deriveConsoleViewFromControllers();
        }
        updateConsoleModeChip();
    }

    function handleScriptConsoleOpenChange(isOpen) {
        if (syncingConsoleMode) {
            return;
        }

        currentConsoleView = isOpen ? 'js' : 'events';
        updateConsoleModeChip();
    }

    function handleScriptConsoleToggleRequest() {
        const nextMode = deriveConsoleViewFromControllers() === 'js' ? 'events' : 'js';
        setConsoleMode(nextMode).catch(() => {
            /* setConsoleMode already reports errors */
        });
    }

    async function activateEventsMode() {
        await setConsoleMode('events');
    }

    async function activateJsMode() {
        await setConsoleMode('js');
    }

    return {
        activateEventsMode,
        activateJsMode,
        handleEventLogCollapsedChange,
        handleScriptConsoleOpenChange,
        handleScriptConsoleToggleRequest,
        setConsoleMode,
        setConsoleOpen,
        toggleConsoleOpen,
        updateConsoleModeChip,
    };
}
