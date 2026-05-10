export function configureErudaConsoleTool({
    captureController,
    consoleTool,
    elements,
    isSuppressed,
    maxErudaLogs,
}) {
    captureController.restoreConsoleMethods();

    const config = consoleTool.config;
    if (config?.set) {
        config.set('overrideConsole', true);
        config.set('jsExecution', true);
        config.set('catchGlobalErr', true);
        config.set('asyncRender', false);
        config.set('lazyEvaluation', true);
    }

    if (consoleTool._logger?.setOption) {
        consoleTool._logger.setOption('asyncRender', false);
        consoleTool._logger.setOption('maxNum', maxErudaLogs);
        consoleTool._logger.setOption('lazyEvaluation', true);
    } else if (consoleTool._logger?.options) {
        consoleTool._logger.options.asyncRender = false;
        consoleTool._logger.options.maxNum = maxErudaLogs;
        consoleTool._logger.options.lazyEvaluation = true;
    }

    const lunaElement = elements.scriptConsoleOutput?.querySelector('.luna-console');
    if (lunaElement) {
        lunaElement.classList.remove('luna-console-theme-light');
        lunaElement.classList.add('luna-console-theme-dark');
    }

    if (consoleTool._logger?.warn) {
        const originalWarn = consoleTool._logger.warn.bind(consoleTool._logger);
        consoleTool._logger.warn = (...args) => {
            if (!isSuppressed(args)) {
                originalWarn(...args);
            }
        };
    }
}
