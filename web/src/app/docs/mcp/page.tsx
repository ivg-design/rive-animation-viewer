import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "MCP Integration" };

export default function McpIntegration() {
  return (
    <>
      <h1>MCP Integration</h1>

      <p>
        RAV includes a bundled native <strong>MCP (Model Context Protocol)</strong> sidecar
        that lets Claude Code, Claude Desktop, Codex, or any MCP client control the viewer
        remotely.
      </p>

      <h2>How it works</h2>
      <pre><code>MCP Client &lt;-(stdio)-&gt; rav-mcp sidecar &lt;-(WebSocket)-&gt; RAV App</code></pre>
      <p>
        The sidecar starts automatically with the app. The runtime strip MCP indicator
        brightens when a client is actively connected.
      </p>

      {/* Editorial: indicators left, legend right */}
      <div className="flex flex-col md:flex-row gap-6 my-6">
        <div className="md:w-2/5 flex-shrink-0">
          <Image src={asset("/docs/mcp-indicators.webp")} alt="MCP indicator in three states" width={300} height={100} className="rounded-lg border border-[var(--border-dark)] w-full" />
        </div>
        <div className="md:w-3/5 flex flex-col justify-center gap-2">
          <div className="flex gap-2 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[10px] font-bold flex items-center justify-center">1</span>
            <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Connected</strong> &mdash; bright indigo, client actively communicating</p>
          </div>
          <div className="flex gap-2 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[10px] font-bold flex items-center justify-center">2</span>
            <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Idle</strong> &mdash; dim indigo, bridge ready but no active client</p>
          </div>
          <div className="flex gap-2 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[10px] font-bold flex items-center justify-center">3</span>
            <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Disabled</strong> &mdash; red with strikethrough, bridge stopped</p>
          </div>
        </div>
      </div>

      <h2>Setup</h2>

      <Image src={asset("/docs/mcp-setup.webp")} alt="MCP Setup dialog showing status, client detection, and copy snippets" width={500} height={700} className="rounded-xl border border-[var(--border-dark)] my-4" />

      <p>
        Open the <strong>MCP Setup</strong> dialog from the toolbar cable icon. It provides:
      </p>
      <ul>
        <li><strong>Status row</strong> &mdash; MCP ready or disabled</li>
        <li><strong>Script Access</strong> &mdash; safety gate for JS execution tools</li>
        <li><strong>MCP Port</strong> &mdash; editable bridge port with immediate snippet regeneration</li>
        <li><strong>Client detection</strong> &mdash; checks Claude Code, Claude Desktop, and Codex</li>
        <li><strong>Install actions</strong> &mdash; ADD, REINSTALL, or REMOVE based on detected state</li>
        <li><strong>Manual snippets</strong> &mdash; copy-paste configurations for any MCP client</li>
      </ul>

      <h2>Available Tools (36)</h2>
      <table>
        <thead><tr><th>Tool</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>rav_status</code></td><td>App status: file, runtime, playback, canvas sizing, ViewModel summary</td></tr>
          <tr><td><code>rav_open_file</code></td><td>Open a .riv file by absolute path</td></tr>
          <tr><td><code>rav_play</code> / <code>rav_pause</code> / <code>rav_reset</code></td><td>Playback controls</td></tr>
          <tr><td><code>rav_get_artboards</code></td><td>List artboard names</td></tr>
          <tr><td><code>rav_get_state_machines</code></td><td>List state machine names</td></tr>
          <tr><td><code>rav_switch_artboard</code> / <code>rav_reset_artboard</code></td><td>Switch artboard/playback or reset to default</td></tr>
          <tr><td><code>rav_get_vm_tree</code></td><td>Full ViewModel hierarchy with paths, types, and values</td></tr>
          <tr><td><code>rav_vm_get</code> / <code>rav_vm_set</code> / <code>rav_vm_fire</code></td><td>Read, write, and fire ViewModel properties</td></tr>
          <tr><td><code>rav_get_event_log</code></td><td>Recent event log entries (filterable by source)</td></tr>
          <tr><td><code>rav_get_editor_code</code> / <code>rav_set_editor_code</code></td><td>Read and write the script editor</td></tr>
          <tr><td><code>rav_apply_code</code></td><td>Apply editor code and reload (Script Access required)</td></tr>
          <tr><td><code>rav_set_runtime</code></td><td>Switch runtime (webgl2 or canvas)</td></tr>
          <tr><td><code>rav_set_layout</code></td><td>Set layout fit mode</td></tr>
          <tr><td><code>rav_set_canvas_color</code></td><td>Set background color</td></tr>
          <tr><td><code>rav_set_canvas_size</code></td><td>Set canvas sizing mode, dimensions, and aspect lock</td></tr>
          <tr><td><code>rav_export_demo</code></td><td>Export standalone HTML demo (programmatic, no dialog)</td></tr>
          <tr><td><code>rav_export_demo_visual</code></td><td>Visibly orchestrate the export dialog (selection, package, snippet mode) and save &mdash; for screen recordings or non-default selections</td></tr>
          <tr><td><code>generate_web_instantiation_code</code></td><td>Generate canonical web snippet with helpers and control values</td></tr>
          <tr><td><code>rav_toggle_instantiation_controls_dialog</code></td><td>Open/close the export controls dialog</td></tr>
          <tr><td><code>rav_configure_workspace</code></td><td>Set sidebar visibility, live source mode, and VM Explorer state</td></tr>
          <tr><td><code>rav_get_sm_inputs</code> / <code>rav_set_sm_input</code></td><td>State machine input access</td></tr>
          <tr><td><code>rav_eval</code></td><td>Evaluate JS in browser context (Script Access required)</td></tr>
          <tr><td><code>rav_console_open</code> / <code>rav_console_close</code></td><td>Toggle the bottom console panel. <code>open</code> accepts optional <code>mode</code>, <code>level</code>, <code>sources</code>, and <code>search</code> to apply a filter on open</td></tr>
          <tr><td><code>rav_console_set_mode</code></td><td>Flip between Event Console, JS REPL, or closed without re-opening</td></tr>
          <tr><td><code>rav_console_set_filter</code></td><td>Drive the on-screen filter toggles: <code>level</code> for JS, <code>sources</code> for Events, plus <code>search</code> on either</td></tr>
          <tr><td><code>rav_console_clear</code></td><td>Clear the visible transcript of the active mode (or a specified mode); panel stays open</td></tr>
          <tr><td><code>rav_console_read</code> / <code>rav_console_exec</code></td><td>Read console output or run REPL code (exec requires Script Access)</td></tr>
        </tbody>
      </table>

      <h2>Script Access</h2>
      <p>
        By default, MCP can read state and drive safe control operations. Enable
        <strong> Script Access</strong> in the MCP Setup dialog to unlock <code>rav_eval</code>,
        <code>rav_console_exec</code>, and <code>rav_apply_code</code>.
      </p>
    </>
  );
}
