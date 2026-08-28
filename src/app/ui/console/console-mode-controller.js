export function createConsoleModeController({
    callbacks = {},
    elements,
    eventLogController,
    operationsDiagnosticsController,
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
        if (operationsDiagnosticsController?.isOpen?.()) return 'rav';
        return scriptConsoleController?.isOpen?.() ? 'js' : 'events';
    }

    function syncModeTabs() {
        const view = isConsoleOpen() ? currentConsoleView : 'events';
        [
            [elements?.eventConsoleTab, 'events'],
            [elements?.scriptConsoleTab, 'js'],
            [elements?.ravOperationsTab, 'rav'],
        ].forEach(([tab, mode]) => {
            if (!tab) return;
            const active = view === mode;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-pressed', String(active));
        });
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
        const normalizedMode = ['closed', 'events', 'js', 'rav'].includes(mode) ? mode : 'events';
        syncingConsoleMode = true;
        try {
            if (normalizedMode === 'closed') {
                operationsDiagnosticsController?.close?.();
                scriptConsoleController.close();
                eventLogController.setCollapsed(true);
                return;
            }

            currentConsoleView = normalizedMode;
            eventLogController.setCollapsed(false);
            if (normalizedMode === 'events') {
                operationsDiagnosticsController?.close?.();
                scriptConsoleController.close();
            } else if (normalizedMode === 'js') {
                operationsDiagnosticsController?.close?.();
                await scriptConsoleController.open();
            } else {
                scriptConsoleController.close();
                const shown = await operationsDiagnosticsController?.show?.();
                if (!shown) throw new Error('RAV operational diagnostics are unavailable in this build.');
            }
        } catch (error) {
            currentConsoleView = deriveConsoleViewFromControllers();
            showError(`Failed to open console: ${error.message}`);
            logEvent('ui', 'console-open-failed', error.message);
            throw error;
        } finally {
            syncingConsoleMode = false;
            syncModeTabs();
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
            operationsDiagnosticsController?.close?.();
            scriptConsoleController.close();
            eventLogController.setCollapsed(true);
        } finally {
            syncingConsoleMode = false;
            syncModeTabs();
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
            operationsDiagnosticsController?.close?.();
            if (scriptConsoleController?.isOpen()) {
                scriptConsoleController.close();
            }
        } else {
            currentConsoleView = deriveConsoleViewFromControllers();
        }
        syncModeTabs();
        updateConsoleModeChip();
    }

    function handleScriptConsoleOpenChange(isOpen) {
        if (syncingConsoleMode) {
            return;
        }

        currentConsoleView = isOpen ? 'js' : deriveConsoleViewFromControllers();
        syncModeTabs();
        updateConsoleModeChip();
    }

    function handleOperationsDiagnosticsOpenChange(isOpen) {
        if (syncingConsoleMode) return;
        currentConsoleView = isOpen ? 'rav' : deriveConsoleViewFromControllers();
        syncModeTabs();
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

    async function activateRavMode() {
        await setConsoleMode('rav');
    }

    return {
        activateEventsMode,
        activateJsMode,
        activateRavMode,
        handleEventLogCollapsedChange,
        handleOperationsDiagnosticsOpenChange,
        handleScriptConsoleOpenChange,
        handleScriptConsoleToggleRequest,
        setConsoleMode,
        setConsoleOpen,
        toggleConsoleOpen,
        updateConsoleModeChip,
    };
}
