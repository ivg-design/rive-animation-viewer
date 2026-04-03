export function createReplHistoryController({
    commandHistoryLimit,
    elements,
    exec,
    state,
} = {}) {
    function wire() {
        const input = elements.scriptConsoleReplInput;
        if (!input) {
            return;
        }

        if (state.replKeydownHandler) {
            input.removeEventListener('keydown', state.replKeydownHandler);
        }

        input.placeholder = 'Type JS and press Enter';
        state.replKeydownHandler = async (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                const code = input.value.trim();
                if (!code) {
                    return;
                }

                if (state.commandHistory[0] !== code) {
                    state.commandHistory.unshift(code);
                }
                if (state.commandHistory.length > commandHistoryLimit) {
                    state.commandHistory.length = commandHistoryLimit;
                }

                state.historyIndex = -1;
                state.historyPending = '';
                input.value = '';
                await exec(code);
                return;
            }

            if (event.key === 'ArrowUp') {
                if (!state.commandHistory.length) {
                    return;
                }
                event.preventDefault();
                if (state.historyIndex === -1) {
                    state.historyPending = input.value;
                }
                if (state.historyIndex < state.commandHistory.length - 1) {
                    state.historyIndex += 1;
                    input.value = state.commandHistory[state.historyIndex];
                }
                return;
            }

            if (event.key === 'ArrowDown') {
                if (state.historyIndex < 0) {
                    return;
                }
                event.preventDefault();
                state.historyIndex -= 1;
                input.value = state.historyIndex >= 0
                    ? state.commandHistory[state.historyIndex]
                    : state.historyPending;
            }
        };

        input.addEventListener('keydown', state.replKeydownHandler);
    }

    function destroy() {
        if (elements.scriptConsoleReplInput && state.replKeydownHandler) {
            elements.scriptConsoleReplInput.removeEventListener('keydown', state.replKeydownHandler);
        }
        state.replKeydownHandler = null;
    }

    return {
        destroy,
        wire,
    };
}
