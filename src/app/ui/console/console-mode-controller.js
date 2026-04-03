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

    let currentConsoleMode = 'closed';
    let syncingConsoleMode = false;

    function deriveConsoleModeFromControllers() {
        if (eventLogController?.isCollapsed?.()) {
            return 'closed';
        }
        if (scriptConsoleController?.isOpen?.()) {
            return 'js';
        }
        return 'events';
    }

    function updateConsoleModeChip() {
        const chip = elements?.consoleModeChip;
        if (!chip) {
            return;
        }

        const labels = {
            closed: 'OPEN CONSOLE',
            events: 'EVENTS',
            js: 'JS',
        };
        const titles = {
            closed: 'Console closed (click to open the event console)',
            events: 'Event console open (click to open JavaScript console)',
            js: 'JavaScript console open (click to close console)',
        };

        chip.dataset.consoleMode = currentConsoleMode;
        chip.title = titles[currentConsoleMode] || titles.closed;
        if (elements.consoleModeChipLabel) {
            elements.consoleModeChipLabel.textContent = labels[currentConsoleMode] || labels.closed;
        } else {
            chip.textContent = labels[currentConsoleMode] || labels.closed;
        }
    }

    async function setConsoleMode(mode) {
        const normalizedMode = ['closed', 'events', 'js'].includes(mode) ? mode : 'events';
        syncingConsoleMode = true;
        try {
            if (normalizedMode === 'closed') {
                scriptConsoleController.close();
                eventLogController.setCollapsed(true);
            } else if (normalizedMode === 'events') {
                eventLogController.setCollapsed(false);
                scriptConsoleController.close();
            } else {
                eventLogController.setCollapsed(false);
                await scriptConsoleController.open();
            }
            currentConsoleMode = normalizedMode;
        } catch (error) {
            currentConsoleMode = deriveConsoleModeFromControllers();
            showError(`Failed to open JavaScript console: ${error.message}`);
            logEvent('ui', 'console-open-failed', error.message);
            throw error;
        } finally {
            syncingConsoleMode = false;
            updateConsoleModeChip();
        }
    }

    function handleEventLogCollapsedChange(collapsed) {
        if (syncingConsoleMode) {
            return;
        }

        if (collapsed && scriptConsoleController?.isOpen()) {
            scriptConsoleController.close();
        }

        currentConsoleMode = collapsed
            ? 'closed'
            : (scriptConsoleController?.isOpen() ? 'js' : 'events');
        updateConsoleModeChip();
    }

    function handleScriptConsoleOpenChange(isOpen) {
        if (syncingConsoleMode) {
            return;
        }

        currentConsoleMode = isOpen
            ? 'js'
            : (eventLogController?.isCollapsed?.() ? 'closed' : 'events');
        updateConsoleModeChip();
    }

    function handleScriptConsoleToggleRequest() {
        const nextMode = deriveConsoleModeFromControllers() === 'js' ? 'events' : 'js';
        setConsoleMode(nextMode).catch(() => {
            /* setConsoleMode already reports errors */
        });
    }

    async function cycleConsoleMode() {
        const modeOrder = ['closed', 'events', 'js'];
        currentConsoleMode = deriveConsoleModeFromControllers();
        const currentIndex = modeOrder.indexOf(currentConsoleMode);
        const nextMode = modeOrder[(currentIndex + 1) % modeOrder.length];
        await setConsoleMode(nextMode);
    }

    return {
        cycleConsoleMode,
        handleEventLogCollapsedChange,
        handleScriptConsoleOpenChange,
        handleScriptConsoleToggleRequest,
        setConsoleMode,
        updateConsoleModeChip,
    };
}
