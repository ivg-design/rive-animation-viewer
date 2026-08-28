export function createRemoteInteractionGate({
    getBindings = () => [],
    renderTopology = () => {},
} = {}) {
    let pendingTopologyRender = false;

    function flushPendingTopology() {
        if (!pendingTopologyRender) return;
        pendingTopologyRender = false;
        renderTopology();
    }

    function registerBinding(binding) {
        binding?.setInteractionEndHandler?.(flushPendingTopology);
    }

    function renderTopologyWhenSafe() {
        const interactionActive = getBindings().some(
            (binding) => binding.isInteractionActive?.() === true,
        );
        if (interactionActive) {
            pendingTopologyRender = true;
            return false;
        }
        renderTopology();
        return true;
    }

    return { registerBinding, renderTopologyWhenSafe };
}
