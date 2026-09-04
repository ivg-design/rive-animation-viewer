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
        reports bridge health and turns blue for 30 seconds after an agent command arrives.
      </p>

      <div className="grid sm:grid-cols-2 gap-3 my-6">
        <div className="rounded-lg border border-[var(--border-dark)] bg-[var(--bg-zinc)] p-3 flex gap-3 items-start">
          <span className="mt-1 flex-shrink-0 w-3 h-3 rounded-full bg-[#34d399] shadow-[0_0_9px_#34d39966]" />
          <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Ready</strong> &mdash; green, the bridge is healthy and available</p>
        </div>
        <div className="rounded-lg border border-[var(--border-dark)] bg-[var(--bg-zinc)] p-3 flex gap-3 items-start">
          <span className="mt-1 flex-shrink-0 w-3 h-3 rounded-full bg-[#60a5fa] shadow-[0_0_10px_#3b82f699]" />
          <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Recent command</strong> &mdash; blue for 30 seconds after MCP activity</p>
        </div>
        <div className="rounded-lg border border-[var(--border-dark)] bg-[var(--bg-zinc)] p-3 flex gap-3 items-start">
          <span className="mt-1 flex-shrink-0 w-3 h-3 rounded-full bg-[#fbbf24] shadow-[0_0_8px_#fbbf2455]" />
          <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Connecting</strong> &mdash; yellow while the bridge starts or reconnects</p>
        </div>
        <div className="rounded-lg border border-[var(--border-dark)] bg-[var(--bg-zinc)] p-3 flex gap-3 items-start">
          <span className="mt-1 flex-shrink-0 w-3 h-3 rounded-full bg-[#ff5d73] shadow-[0_0_8px_#ff5d7355]" />
          <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Error</strong> &mdash; red after a bridge failure while retrying</p>
        </div>
        <div className="rounded-lg border border-[var(--border-dark)] bg-[var(--bg-zinc)] p-3 flex gap-3 items-start sm:col-span-2">
          <span className="mt-1 flex-shrink-0 w-3 h-3 rounded-full bg-[#7d8799]" />
          <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Off</strong> &mdash; muted and crossed out when MCP is disabled</p>
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

      <h2>Available Tools (57)</h2>
      <p>
        The bundled native sidecar advertises 57 unique tools. Root ViewModel paths
        use the regular <code>rav_vm_*</code> tools; global ViewModels use a separate global
        name plus property path. Eight desktop media tools expose the same export and
        recording service as the <strong>EXPORT</strong> menu.
      </p>
      <table>
        <thead><tr><th>Tool</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>rav_status</code></td><td>App status: file, runtime, playback, canvas sizing, ViewModel summary</td></tr>
          <tr><td><code>rav_set_anonymous_usage</code></td><td>Enable or disable Anonymous Usage reporting</td></tr>
          <tr><td><code>rav_open_file</code></td><td>Open a .riv file by absolute path</td></tr>
          <tr><td><code>rav_play</code> / <code>rav_pause</code> / <code>rav_reset</code></td><td>Playback controls</td></tr>
          <tr><td><code>rav_get_artboards</code></td><td>List artboard names</td></tr>
          <tr><td><code>rav_get_state_machines</code></td><td>List state machine names</td></tr>
          <tr><td><code>rav_switch_artboard</code> / <code>rav_reset_artboard</code></td><td>Switch artboard/playback or reset to default</td></tr>
          <tr><td><code>rav_switch_vm_instance</code></td><td>Switch the active artboard-bound ViewModel instance</td></tr>
          <tr><td><code>rav_get_vm_tree</code></td><td>Current live root ViewModel hierarchy with paths, types, values, and dynamic list bounds</td></tr>
          <tr><td><code>rav_vm_get</code></td><td>Read a root ViewModel property, including zero-based list paths such as <code>rows/0/name</code></td></tr>
          <tr><td><code>rav_vm_set</code></td><td>Write a root ViewModel property</td></tr>
          <tr><td><code>rav_vm_set_image</code></td><td>Set a root ViewModel image property</td></tr>
          <tr><td><code>rav_vm_clear_image</code></td><td>Clear a root ViewModel image property</td></tr>
          <tr><td><code>rav_vm_fire</code></td><td>Fire a root ViewModel trigger property</td></tr>
          <tr><td><code>rav_get_global_vm_tree</code></td><td>List named global ViewModels and their independent live trees</td></tr>
          <tr><td><code>rav_global_vm_get</code></td><td>Read a property from a named global ViewModel</td></tr>
          <tr><td><code>rav_global_vm_set</code></td><td>Write a property on a named global ViewModel</td></tr>
          <tr><td><code>rav_global_vm_set_image</code></td><td>Set an image property on a named global ViewModel</td></tr>
          <tr><td><code>rav_global_vm_clear_image</code></td><td>Clear an image property on a named global ViewModel</td></tr>
          <tr><td><code>rav_global_vm_fire</code></td><td>Fire a trigger property on a named global ViewModel</td></tr>
          <tr><td><code>rav_get_event_log</code></td><td>Recent event log entries (filterable by source)</td></tr>
          <tr><td><code>rav_get_editor_code</code> / <code>rav_set_editor_code</code></td><td>Read and write the script editor</td></tr>
          <tr><td><code>rav_apply_code</code></td><td>Apply editor code and reload (Script Access required)</td></tr>
          <tr><td><code>rav_set_runtime</code></td><td>Switch runtime (webgl2 or canvas)</td></tr>
          <tr><td><code>rav_set_layout</code></td><td>Set layout fit mode</td></tr>
          <tr><td><code>rav_set_alignment</code></td><td>Set art alignment within the canvas</td></tr>
          <tr><td><code>rav_set_canvas_color</code></td><td>Set background color</td></tr>
          <tr><td><code>rav_set_canvas_size</code></td><td>Set canvas sizing mode, dimensions, and aspect lock</td></tr>
          <tr><td><code>rav_capture_canvas</code></td><td>Capture the currently rendered RAV canvas as PNG image content</td></tr>
          <tr><td><code>rav_media_capabilities</code></td><td>Inspect verified encoders, formats, alpha support, limits, and production distribution state</td></tr>
          <tr><td><code>rav_export_media</code></td><td>Start an asynchronous whole/segment timeline export or current/timed still capture</td></tr>
          <tr><td><code>rav_record_start</code></td><td>Start live state-machine recording, optionally timed and supplied with recording-clock interactions</td></tr>
          <tr><td><code>rav_record_stop</code></td><td>Seal a manual recording and begin finalization; continue polling its job</td></tr>
          <tr><td><code>rav_media_status</code></td><td>Read capture, encoding, verification, warnings, resolved settings, and output details</td></tr>
          <tr><td><code>rav_media_cancel</code></td><td>Cancel an active media job and clean that job&apos;s temporary capture</td></tr>
          <tr><td><code>rav_step_frames</code></td><td>Advance and draw an exact number of frames while not recording</td></tr>
          <tr><td><code>rav_pointer</code></td><td>Send normalized mouse down, move, up, or exit input to the live canvas</td></tr>
          <tr><td><code>rav_open_isolated_playback</code></td><td>Open playback in an isolated surface</td></tr>
          <tr><td><code>rav_export_demo</code></td><td>Export standalone HTML demo (programmatic, no dialog)</td></tr>
          <tr><td><code>rav_export_demo_visual</code></td><td>Visibly orchestrate the export dialog (selection, package, snippet mode) and save &mdash; for screen recordings or non-default selections</td></tr>
          <tr><td><code>generate_web_instantiation_code</code></td><td>Generate canonical web snippet with helpers and control values</td></tr>
          <tr><td><code>rav_toggle_instantiation_controls_dialog</code></td><td>Open/close the export controls dialog</td></tr>
          <tr><td><code>rav_configure_workspace</code></td><td>Set sidebar visibility, live source mode, and VM Explorer state</td></tr>
          <tr><td><code>rav_get_sm_inputs</code> / <code>rav_set_sm_input</code></td><td>State machine input access</td></tr>
          <tr><td><code>rav_eval</code></td><td>Evaluate JS in browser context (Script Access required)</td></tr>
          <tr><td><code>rav_console_open</code></td><td>Open the bottom console panel, optionally setting <code>mode</code>, <code>level</code>, <code>sources</code>, and <code>search</code></td></tr>
          <tr><td><code>rav_console_close</code></td><td>Close the bottom console panel</td></tr>
          <tr><td><code>rav_console_set_mode</code></td><td>Flip between Event Console, JS REPL, or closed without re-opening</td></tr>
          <tr><td><code>rav_console_set_filter</code></td><td>Drive the on-screen filter toggles: <code>level</code> for JS, <code>sources</code> for Events, plus <code>search</code> on either</td></tr>
          <tr><td><code>rav_console_clear</code></td><td>Clear the visible transcript of the active mode (or a specified mode); panel stays open</td></tr>
          <tr><td><code>rav_console_read</code> / <code>rav_console_exec</code></td><td>Read console output or run REPL code (exec requires Script Access)</td></tr>
        </tbody>
      </table>

      <h2>Media automation</h2>
      <p>
        Media tools are desktop-only and asynchronous. Call <code>rav_media_capabilities</code>
        before selecting a codec, then poll <code>rav_media_status</code> until the returned job
        is completed, failed, or cancelled. Omitting <code>output_path</code> opens the native Save
        dialog; unattended agents should supply an absolute path with the matching extension.
      </p>
      <p>
        <code>rav_record_start</code> accepts scheduled typed ViewModel sets, trigger fires, image
        changes, and normalized pointer events. Operations run on the recording clock before the
        corresponding frame is drawn, and completion reports requested and applied times. Existing
        ViewModel and global-ViewModel tools can also be used interactively while a manual recording
        is active. See <a href={asset("/docs/media-export")}>Media Export &amp; Recording</a> for formats,
        settings, GIF size controls, and recording behavior.
      </p>

      <h2>GLOBAL VM in RAV</h2>
      <p>
        When a file provides globals, the sidebar labels their collection <strong>GLOBAL VM</strong>{" "}
        above <strong>ROOT VM</strong>. <strong>GLOBAL VM</strong> starts collapsed, and each named
        global has its own independent expandable tree; opening one does not expand another.
      </p>

      <h2>Script Access</h2>
      <p>
        By default, MCP can read state and drive safe control operations. Enable
        <strong> Script Access</strong> in the MCP Setup dialog to unlock <code>rav_eval</code>,
        <code>rav_console_exec</code>, and <code>rav_apply_code</code>.
      </p>
    </>
  );
}
