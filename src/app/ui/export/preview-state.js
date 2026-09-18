export function createInstantiationPreviewState({ elements = {} } = {}) {
    let text = '';

    function render() {
        if (elements.instantiationPreviewOutput) {
            elements.instantiationPreviewOutput.textContent = text || '// Generate a snippet to preview it here.';
        }
        if (elements.instantiationPreviewStatus) {
            elements.instantiationPreviewStatus.textContent = text
                ? 'Snippet preview is ready.'
                : 'Snippet preview not generated yet.';
        }
        if (elements.copyInstantiationPreviewButton) {
            elements.copyInstantiationPreviewButton.disabled = !text;
        }
    }

    function clear() {
        text = '';
        render();
    }

    function setText(value) {
        text = String(value || '').trim();
        render();
        return text;
    }

    return { clear, getText: () => text, render, setText };
}
