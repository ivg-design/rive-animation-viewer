export function createHiddenPlumbingTransactionController({
    cleanupRiveInstance,
    elements,
    getRiveInstance,
    populateArtboardSwitcher,
    refreshInfoStrip,
    renderVmInputControls,
    riveEventBridge,
    setRiveInstance,
    windowRef,
} = {}) {
    let activeTransaction = null;

    function begin(previousRuntime) {
        const transaction = {
            candidateCanvas: null,
            previousCanvas: windowRef.document?.getElementById?.('rive-canvas') || null,
            previousInstance: getRiveInstance(),
            previousRuntime,
            settled: false,
        };
        activeTransaction = transaction;
        riveEventBridge.clear();
        transaction.previousCanvas?.remove?.();
        if (!transaction.previousCanvas) elements.canvasContainer.innerHTML = '';
        return transaction;
    }

    function commit(transaction) {
        if (!transaction || activeTransaction !== transaction || transaction.settled) return;
        transaction.settled = true;
        cleanupRiveInstance(transaction.previousInstance);
        transaction.previousCanvas?.remove?.();
        activeTransaction = null;
    }

    function rollback(transaction) {
        if (!transaction || activeTransaction !== transaction || transaction.settled) return;
        transaction.settled = true;
        riveEventBridge.clear();
        const currentInstance = getRiveInstance();
        if (currentInstance && currentInstance !== transaction.previousInstance) cleanupRiveInstance(currentInstance);
        transaction.candidateCanvas?.remove?.();
        if (transaction.previousCanvas && !transaction.previousCanvas.isConnected) {
            transaction.previousCanvas.id = 'rive-canvas';
            elements.canvasContainer?.appendChild?.(transaction.previousCanvas);
        }
        setRiveInstance(transaction.previousInstance || null);
        if (transaction.previousInstance && transaction.previousRuntime) {
            riveEventBridge.attach(transaction.previousRuntime, transaction.previousInstance);
        }
        activeTransaction = null;
        renderVmInputControls();
        populateArtboardSwitcher();
        refreshInfoStrip();
    }

    function disposeRetained() {
        if (!activeTransaction) return;
        const transaction = activeTransaction;
        activeTransaction = null;
        cleanupRiveInstance(transaction.previousInstance);
        transaction.previousCanvas?.remove?.();
    }

    return {
        begin,
        commit,
        disposeRetained,
        rollback,
        setCandidateCanvas: (transaction, canvas) => {
            if (transaction && activeTransaction === transaction) transaction.candidateCanvas = canvas;
        },
    };
}
