import {
    createAboutRenderer,
    createMcpRenderer,
} from '../../../src/app/ui/overlay/purpose-renderers.js';

describe('native UI overlay purpose renderers', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('renders About metadata and routes link actions through the injected client', () => {
        document.body.innerHTML = `
            <h1 data-overlay-about-name></h1>
            <span data-overlay-about-version></span>
            <span data-overlay-about-build></span>
            <span data-overlay-about-runtime></span>
            <dl data-overlay-about-build-grid></dl>
            <dl data-overlay-about-credits></dl>
            <div data-overlay-about-links></div>
            <div data-overlay-about-dependencies></div>
            <span data-overlay-about-dependency-status></span>
        `;
        const emitAction = vi.fn();
        const renderAbout = createAboutRenderer({ documentRef: document, emitAction });

        renderAbout({
            appName: 'Rive Animation Viewer',
            build: 'b0193',
            credits: [{ label: 'Design', value: 'IVG' }],
            dependencies: [{ name: 'Rive', version: '2.40.0' }],
            license: 'MIT',
            links: [{ label: 'Documentation', url: 'https://example.com/docs' }],
            runtime: '2.40.0',
            version: '2.5.2',
        });

        expect(document.querySelector('[data-overlay-about-name]').textContent)
            .toBe('Rive Animation Viewer');
        expect(document.querySelector('[data-overlay-about-build-grid]').textContent)
            .toContain('LicenseMIT');
        expect(document.querySelector('[data-overlay-about-credits]').textContent)
            .toBe('DesignIVG');
        expect(document.querySelector('[data-overlay-about-dependencies]').textContent)
            .toBe('Rive2.40.0');
        expect(document.querySelector('[data-overlay-about-dependency-status]').textContent)
            .toBe('1 deps');

        document.querySelector('.about-dialog-link-btn').click();
        expect(emitAction).toHaveBeenCalledWith('open-link', 'https://example.com/docs');
    });

    it('renders MCP clients and preserves every injected action callback', () => {
        document.body.innerHTML = `
            <div data-overlay-mcp-node><span data-overlay-mcp-node-label></span></div>
            <button data-overlay-mcp-script-access></button>
            <span data-overlay-mcp-script-note></span>
            <input id="overlay-mcp-port">
            <code data-overlay-mcp-path></code>
            <div data-overlay-mcp-targets></div>
        `;
        const emitAction = vi.fn();
        const renderMcp = createMcpRenderer({ documentRef: document, emitAction });

        renderMcp({
            genericSnippet: '{ "manual": true }',
            node: {
                className: 'mcp-node-status is-connected',
                label: 'Connected',
                path: '/tmp/rav-mcp',
                port: 9278,
            },
            scriptAccess: { enabled: true, note: 'Restart required' },
            targets: [{
                id: 'codex',
                installDisabled: false,
                installLabel: 'REINSTALL',
                label: 'Codex',
                removeHidden: false,
                snippet: '{ "command": "rav-mcp" }',
                status: 'Installed',
                statusClassName: 'mcp-client-status is-installed',
            }],
        });

        expect(document.querySelector('[data-overlay-mcp-node]').className)
            .toBe('mcp-node-status is-connected');
        expect(document.querySelector('[data-overlay-mcp-script-access]').getAttribute('aria-pressed'))
            .toBe('true');
        expect(document.getElementById('overlay-mcp-port').value).toBe('9278');
        expect(document.querySelectorAll('.mcp-snippet-section')).toHaveLength(2);
        expect(document.querySelectorAll('.mcp-snippet-section')[1].textContent)
            .toContain('Generic MCP Client');

        const client = document.querySelector('.mcp-snippet-section');
        client.querySelector('.mcp-install-btn').click();
        client.querySelector('.mcp-remove-btn').click();
        client.querySelector('.mcp-copy-btn').click();
        expect(emitAction.mock.calls).toEqual([
            ['client-install', 'codex'],
            ['client-remove', 'codex'],
            ['copy', 'codex'],
        ]);
    });
});
