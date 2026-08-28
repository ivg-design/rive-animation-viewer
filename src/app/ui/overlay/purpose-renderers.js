function replaceDefinitionList(documentRef, target, rows = []) {
    if (!target) return;
    const fragment = documentRef.createDocumentFragment();
    rows.forEach(({ label, value }) => {
        const term = documentRef.createElement('dt');
        const detail = documentRef.createElement('dd');
        term.textContent = String(label || '');
        detail.textContent = String(value || '');
        fragment.append(term, detail);
    });
    target.replaceChildren(fragment);
}

export function createAboutRenderer({ documentRef, emitAction }) {
    return function renderAbout(state = {}) {
        const setText = (selector, value) => {
            const target = documentRef.querySelector(selector);
            if (target) target.textContent = String(value || '');
        };
        setText('[data-overlay-about-name]', state.appName);
        setText('[data-overlay-about-version]', state.version);
        setText('[data-overlay-about-build]', state.build);
        setText('[data-overlay-about-runtime]', state.runtime);
        replaceDefinitionList(documentRef, documentRef.querySelector('[data-overlay-about-build-grid]'), [
            { label: 'Version', value: state.version },
            { label: 'Build', value: state.build },
            { label: 'Runtime', value: state.runtime },
            { label: 'License', value: state.license },
        ]);
        replaceDefinitionList(
            documentRef,
            documentRef.querySelector('[data-overlay-about-credits]'),
            state.credits || [],
        );
        const links = documentRef.querySelector('[data-overlay-about-links]');
        if (links) {
            links.replaceChildren(...(state.links || []).map((entry) => {
                const button = documentRef.createElement('button');
                button.type = 'button';
                button.className = 'about-dialog-link-btn';
                button.textContent = String(entry.label || '');
                button.addEventListener('click', () => void emitAction('open-link', entry.url));
                return button;
            }));
        }
        const dependencies = documentRef.querySelector('[data-overlay-about-dependencies]');
        if (dependencies) {
            if (state.dependencyError) {
                const error = documentRef.createElement('p');
                error.className = 'about-dialog-dependency-error';
                error.textContent = `Could not load dependency metadata: ${state.dependencyError}`;
                dependencies.replaceChildren(error);
            } else {
                dependencies.replaceChildren(...(state.dependencies || []).map((entry) => {
                    const row = documentRef.createElement('div');
                    row.className = 'about-dialog-dependency-row';
                    const name = documentRef.createElement('span');
                    const version = documentRef.createElement('span');
                    name.textContent = String(entry.name || '');
                    version.textContent = String(entry.version || '');
                    row.append(name, version);
                    return row;
                }));
            }
        }
        setText('[data-overlay-about-dependency-status]', state.dependencyError
            ? 'Load failed'
            : `${(state.dependencies || []).length} deps`);
    };
}

function createMcpSnippetSection(documentRef, emitAction, {
    id,
    installDisabled,
    installLabel,
    label,
    removeHidden,
    snippet,
    status,
    statusClassName,
}) {
    const section = documentRef.createElement('div');
    section.className = 'mcp-snippet-section';
    const heading = documentRef.createElement('h3');
    heading.textContent = String(label || id || 'MCP Client');
    const block = documentRef.createElement('div');
    block.className = 'mcp-snippet-block';
    const header = documentRef.createElement('div');
    header.className = 'mcp-snippet-block-header';
    const statusElement = documentRef.createElement('span');
    statusElement.className = String(statusClassName || 'mcp-client-status');
    statusElement.textContent = String(status || 'Detecting…');
    const install = documentRef.createElement('button');
    install.type = 'button';
    install.className = 'mcp-install-btn';
    install.disabled = Boolean(installDisabled);
    install.textContent = String(installLabel || 'INSTALL');
    install.addEventListener('click', () => void emitAction('client-install', id));
    const remove = documentRef.createElement('button');
    remove.type = 'button';
    remove.className = 'mcp-remove-btn';
    remove.hidden = Boolean(removeHidden);
    remove.textContent = 'REMOVE';
    remove.addEventListener('click', () => void emitAction('client-remove', id));
    const copy = documentRef.createElement('button');
    copy.type = 'button';
    copy.className = 'mcp-copy-btn';
    copy.textContent = 'COPY';
    copy.addEventListener('click', () => void emitAction('copy', id));
    const code = documentRef.createElement('pre');
    code.textContent = String(snippet || '');
    header.append(statusElement, install, remove, copy);
    block.append(header, code);
    section.append(heading, block);
    return section;
}

export function createMcpRenderer({ documentRef, emitAction }) {
    return function renderMcp(state = {}) {
        const node = state.node || {};
        const nodeElement = documentRef.querySelector('[data-overlay-mcp-node]');
        if (nodeElement) nodeElement.className = node.className || 'mcp-node-status';
        const nodeLabel = documentRef.querySelector('[data-overlay-mcp-node-label]');
        if (nodeLabel) nodeLabel.textContent = String(node.label || 'MCP unavailable');
        const scriptAccess = documentRef.querySelector('[data-overlay-mcp-script-access]');
        if (scriptAccess) {
            scriptAccess.textContent = state.scriptAccess?.enabled ? 'ON' : 'OFF';
            scriptAccess.classList.toggle('is-enabled', Boolean(state.scriptAccess?.enabled));
            scriptAccess.setAttribute('aria-pressed', String(Boolean(state.scriptAccess?.enabled)));
        }
        const scriptNote = documentRef.querySelector('[data-overlay-mcp-script-note]');
        if (scriptNote) scriptNote.textContent = String(state.scriptAccess?.note || '');
        const port = documentRef.getElementById('overlay-mcp-port');
        if (port && documentRef.activeElement !== port) {
            port.value = String(node.portDraft ?? node.port ?? 9274);
        }
        const path = documentRef.querySelector('[data-overlay-mcp-path]');
        if (path) path.textContent = String(node.path || '');
        const targets = documentRef.querySelector('[data-overlay-mcp-targets]');
        if (targets) {
            const entries = [...(state.targets || []), {
                id: 'generic',
                installDisabled: true,
                installLabel: 'UNAVAILABLE',
                label: 'Generic MCP Client',
                removeHidden: true,
                snippet: state.genericSnippet || '',
                status: 'Manual',
                statusClassName: 'mcp-client-status',
            }];
            targets.replaceChildren(...entries.map((entry) => (
                createMcpSnippetSection(documentRef, emitAction, entry)
            )));
        }
    };
}
