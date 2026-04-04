const APP_DIALOGS_HTML = `
<dialog id="mcp-setup-dialog" class="mcp-setup-dialog">
  <div class="mcp-setup-content">
    <div class="mcp-setup-header">
      <h2>MCP Setup</h2>
      <button type="button" id="mcp-setup-close-btn" class="icon-btn icon-btn-ghost" aria-label="Close">
        <i data-lucide="x" class="lucide-18"></i>
      </button>
    </div>
    <div class="mcp-setup-body">
      <p class="mcp-setup-intro">
        Connect AI tools to RAV using the Model Context Protocol. The MCP server is bundled
        with this app &mdash; no Node install or repo clone required. Use the one-click install
        buttons when available, or copy the snippet for your AI tool below.
      </p>
      <div class="mcp-node-status" id="mcp-node-status">
        <span class="mcp-node-dot"></span>
        <span class="mcp-node-label" id="mcp-node-label">Checking bundled MCP sidecar...</span>
      </div>
      <div class="mcp-setup-port-row">
        <label class="mcp-setup-port-label" for="mcp-script-access-toggle">Script Access</label>
        <div class="mcp-setup-port-controls">
          <button type="button" id="mcp-script-access-toggle" class="mcp-install-btn">OFF</button>
        </div>
      </div>
      <p class="mcp-script-access-note" id="mcp-script-access-note">
        Read-only MCP mode. Enable this to allow MCP clients to run JavaScript with <code>rav_eval</code>,
        <code>rav_console_exec</code>, and <code>rav_apply_code</code>.
      </p>
      <div class="mcp-setup-port-row">
        <label class="mcp-setup-port-label" for="mcp-port-input">MCP Port</label>
        <div class="mcp-setup-port-controls">
          <input
            type="number"
            id="mcp-port-input"
            class="settings-input mcp-port-input"
            min="1"
            max="65535"
            step="1"
            placeholder="9274"
            inputmode="numeric"
          >
          <button type="button" id="mcp-port-apply-btn" class="mcp-install-btn">SET</button>
        </div>
      </div>
      <div class="mcp-setup-path-section">
        <h3>Server path</h3>
        <div class="mcp-snippet-block">
          <div class="mcp-snippet-block-header">
            <button type="button" class="mcp-copy-btn" data-target="mcp-server-path-display">COPY</button>
          </div>
          <pre id="mcp-server-path-display" class="mcp-setup-path-code">Resolving...</pre>
        </div>
      </div>
      <div class="mcp-setup-snippets" id="mcp-setup-snippets">
        <div class="mcp-snippet-section">
          <h3>Claude Code (CLI)</h3>
          <p>Run this once in your terminal:</p>
          <div class="mcp-snippet-block">
            <div class="mcp-snippet-block-header">
              <span class="mcp-client-status" id="mcp-client-status-claude-code">Detecting...</span>
              <button type="button" class="mcp-install-btn" id="mcp-install-claude-code-btn" data-install-target="claude-code">INSTALL</button>
              <button type="button" class="mcp-remove-btn" id="mcp-remove-claude-code-btn" data-remove-target="claude-code">REMOVE</button>
              <button type="button" class="mcp-copy-btn" data-target="snippet-claude-code">COPY</button>
            </div>
            <pre id="snippet-claude-code"></pre>
          </div>
        </div>
        <div class="mcp-snippet-section">
          <h3>Claude Desktop</h3>
          <p id="mcp-claude-desktop-copy">Add to the Claude Desktop MCP config file:</p>
          <div class="mcp-snippet-block">
            <div class="mcp-snippet-block-header">
              <span class="mcp-client-status" id="mcp-client-status-claude-desktop">Detecting...</span>
              <button type="button" class="mcp-install-btn" id="mcp-install-claude-desktop-btn" data-install-target="claude-desktop">INSTALL</button>
              <button type="button" class="mcp-remove-btn" id="mcp-remove-claude-desktop-btn" data-remove-target="claude-desktop">REMOVE</button>
              <button type="button" class="mcp-copy-btn" data-target="snippet-claude-desktop">COPY</button>
            </div>
            <pre id="snippet-claude-desktop"></pre>
          </div>
        </div>
        <div class="mcp-snippet-section">
          <h3>Codex (CLI/Desktop)</h3>
          <p>Shared Codex config entry:</p>
          <div class="mcp-snippet-block">
            <div class="mcp-snippet-block-header">
              <span class="mcp-client-status" id="mcp-client-status-codex">Detecting...</span>
              <button type="button" class="mcp-install-btn" id="mcp-install-codex-btn" data-install-target="codex">INSTALL</button>
              <button type="button" class="mcp-remove-btn" id="mcp-remove-codex-btn" data-remove-target="codex">REMOVE</button>
              <button type="button" class="mcp-copy-btn" data-target="snippet-codex">COPY</button>
            </div>
            <pre id="snippet-codex"></pre>
          </div>
        </div>
        <div class="mcp-snippet-section">
          <h3>Generic MCP Client</h3>
          <p>Standard stdio transport configuration for any MCP-compatible agent:</p>
          <div class="mcp-snippet-block">
            <div class="mcp-snippet-block-header">
              <button type="button" class="mcp-copy-btn" data-target="snippet-generic">COPY</button>
            </div>
            <pre id="snippet-generic"></pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</dialog>

<dialog id="instantiation-controls-dialog" class="instantiation-controls-dialog">
  <div class="instantiation-controls-content">
    <div class="instantiation-controls-header">
      <div>
        <h2>Snippet &amp; Export Controls</h2>
        <p>Choose exactly which bound ViewModel and state-machine values should be serialized into generated snippets and exported demos.</p>
      </div>
      <button type="button" id="instantiation-controls-close-btn" class="icon-btn icon-btn-ghost" aria-label="Close">
        <i data-lucide="x" class="lucide-18"></i>
      </button>
    </div>
    <div class="instantiation-controls-body">
      <div class="instantiation-controls-toolbar">
        <span id="instantiation-selection-summary" class="instantiation-selection-summary">Loading controls…</span>
        <div class="instantiation-controls-toolbar-actions">
          <button type="button" id="instantiation-preset-changed-btn" class="btn-compact">CHANGED ONLY</button>
          <button type="button" id="instantiation-preset-all-btn" class="btn-compact">SELECT ALL</button>
          <button type="button" id="instantiation-preset-none-btn" class="btn-compact">CLEAR</button>
          <select id="instantiation-package-source-select" class="header-select header-select-compact" aria-label="Snippet package source">
            <option value="cdn" selected>SNIPPET: CDN</option>
            <option value="local">SNIPPET: LOCAL</option>
          </select>
          <select id="instantiation-snippet-mode-select" class="header-select header-select-compact" aria-label="Snippet mode">
            <option value="compact" selected>MODE: COMPACT</option>
            <option value="scaffold">MODE: SCAFFOLD</option>
          </select>
        </div>
      </div>
      <div class="instantiation-controls-grid">
        <section class="instantiation-controls-panel">
          <p class="instantiation-controls-note">Branch checkboxes select every nested control. Individual line items only affect that one serialized value.</p>
          <div id="instantiation-controls-tree" class="instantiation-controls-tree"></div>
        </section>
        <section class="instantiation-preview-panel">
          <div class="instantiation-preview-header">
            <span id="instantiation-preview-status" class="instantiation-preview-status">Snippet preview not generated yet.</span>
            <button type="button" id="copy-instantiation-preview-btn" class="btn-compact" disabled>COPY</button>
          </div>
          <pre id="instantiation-preview-output" class="instantiation-preview-output">// Generate a snippet to preview it here.</pre>
        </section>
      </div>
    </div>
    <div class="instantiation-controls-footer">
      <button type="button" id="instantiation-dialog-snippet-btn" class="btn btn-muted">GENERATE SNIPPET</button>
      <button type="button" id="instantiation-dialog-export-btn" class="btn btn-primary">EXPORT</button>
    </div>
  </div>
</dialog>
`;

export function installAppDialogs(documentRef = globalThis.document) {
    if (!documentRef?.body) {
        return;
    }
    if (documentRef.getElementById('mcp-setup-dialog') && documentRef.getElementById('instantiation-controls-dialog')) {
        return;
    }
    documentRef.body.insertAdjacentHTML('beforeend', APP_DIALOGS_HTML);
}
