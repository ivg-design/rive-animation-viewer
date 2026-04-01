import { getElements } from '../../../src/app/core/elements.js';

describe('core/elements', () => {
    it('collects the expected DOM nodes by id', () => {
        document.body.innerHTML = `
            <button id="file-trigger-btn"></button>
            <div id="event-log-list"></div>
            <button id="mcp-setup-btn"></button>
            <button id="reset-btn"></button>
            <button id="play-btn"></button>
            <button id="pause-btn"></button>
            <button id="apply-editor-config-btn"></button>
        `;

        const elements = getElements(document);

        expect(elements.fileTriggerButton?.id).toBe('file-trigger-btn');
        expect(elements.eventLogList?.id).toBe('event-log-list');
        expect(elements.mcpSetupButton?.id).toBe('mcp-setup-btn');
        expect(elements.resetButton?.id).toBe('reset-btn');
        expect(elements.playButton?.id).toBe('play-btn');
        expect(elements.pauseButton?.id).toBe('pause-btn');
        expect(elements.applyEditorConfigButton?.id).toBe('apply-editor-config-btn');
    });

    it('returns null for missing nodes without throwing', () => {
        const elements = getElements(document);
        expect(elements.fileTriggerButton).toBeNull();
        expect(elements.eventFilterSearch).toBeNull();
    });
});
