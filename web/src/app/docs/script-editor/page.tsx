import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Script Editor" };

export default function ScriptEditor() {
  return (
    <>
      <h1>Script Editor</h1>

      <p>
        The left panel is a CodeMirror editor for a <strong>Rive instantiation config</strong>
        &mdash; the JavaScript object passed to <code>new Rive(...)</code>. The buffer is a draft
        while RAV is in internal mode; it becomes the live source only after you click APPLY
        and enter editor mode.
      </p>

      {/* Editorial: editor states image left, explanation right */}
      <div className="flex flex-col md:flex-row gap-6 my-6">
        <div className="md:w-2/5 flex-shrink-0">
          <Image src={asset("/docs/editor-live-states.webp")} alt="Editor header in internal and editor-active states" width={400} height={60} className="rounded-lg border border-[var(--border-dark)] w-full" />
        </div>
        <div className="md:w-3/5 flex flex-col justify-center gap-3">
          <div className="flex gap-2 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[10px] font-bold flex items-center justify-center">1</span>
            <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Internal</strong> &mdash; dim dot, RAV&apos;s built-in wiring is driving the runtime; the buffer is just a draft</p>
          </div>
          <div className="flex gap-2 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[10px] font-bold flex items-center justify-center">2</span>
            <p className="text-sm text-[var(--text-dim)]"><strong className="text-[var(--text-white)]">Editor mode</strong> &mdash; green pulsing dot, the last applied editor config is driving the runtime</p>
          </div>
        </div>
      </div>

      <h2>What goes in the editor</h2>

      <p>
        The editor accepts a JavaScript object literal &mdash; not JSON. Comments,
        trailing commas, unquoted keys, template strings, arrow functions, and
        async lifecycle callbacks are all valid:
      </p>
      <pre><code>{`({
  // Automatically bind the file's default ViewModel instance
  autoBind: true,

  // State machine activation (string or array)
  stateMachines: "MainSM",

  // Layout
  layout: { fit: "contain", alignment: "center" },

  // Pinned canvas pixels
  canvasSize: {
    mode: "fixed",
    width: 1920,
    height: 1080,
    lockAspectRatio: true
  },

  // Lifecycle hooks — RAV exposes the live instance on window.riveInst
  onLoad: () => {
    window.riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  },
  onStateChange: (event) => console.log("state:", event),
  onAdvance:     (event) => console.log("advance:", event),
  onPlay:        ()      => console.log("play"),
  onPause:       ()      => console.log("pause"),
  onStop:        ()      => console.log("stop"),
  onLoop:        (event) => console.log("loop:", event),
})`}</code></pre>

      <h2>Supported config keys</h2>
      <ul>
        <li><code>artboard</code> &mdash; specific artboard by name (defaults to file&apos;s default artboard)</li>
        <li><code>stateMachines</code> &mdash; state machine name (string or array)</li>
        <li><code>animations</code> &mdash; timeline animation name (string or array). Mutually exclusive with <code>stateMachines</code></li>
        <li><code>autoplay</code> &mdash; start playback immediately (default <code>true</code>)</li>
        <li><code>autoBind</code> &mdash; bind the default ViewModel instance automatically. Explicit VM selection uses <code>false</code>, then binds the selected instance before restoring controls</li>
        <li><code>layout</code> &mdash; <code>{`{ fit, alignment }`}</code>; both surfaced in the toolbar</li>
        <li><code>canvasSize</code> &mdash; <code>{`{ mode: "fixed" | "auto", width, height, lockAspectRatio }`}</code></li>
        <li><code>useOffscreenRenderer</code> &mdash; can improve glow / shadow quality when rendering to a transparent canvas, at a small performance cost</li>
        <li><code>onLoad</code>, <code>onPlay</code>, <code>onPause</code>, <code>onStop</code>, <code>onLoop</code>, <code>onAdvance</code>, <code>onStateChange</code> &mdash; lifecycle callbacks</li>
      </ul>

      <h2>Apply &amp; Reload</h2>
      <p>
        The yellow <strong>APPLY</strong> button in the editor header evaluates the buffer,
        tears down the current Rive instance, and creates a new one with the parsed config.
        The artboard, playback target, and bound control values are preserved as far as the
        runtime allows.
      </p>
      <p>
        Edits to the buffer do <strong>nothing</strong> to the running animation until you
        click APPLY. Exports, snippets, MCP status, and the runtime strip all reflect the
        active live mode &mdash; not the unsaved buffer.
      </p>

      <h2>Internal vs Editor live mode</h2>
      <p>
        RAV draws a sharp line between the editable draft and the source actually driving
        the runtime:
      </p>
      <ul>
        <li>
          <strong>Internal</strong> &mdash; RAV&apos;s built-in wiring (toolbar selections,
          artboard switcher, control panel inputs) drives the animation. The editor buffer
          is a draft; nobody is reading it.
        </li>
        <li>
          <strong>Editor</strong> &mdash; the last applied editor config drives the animation.
          Toolbar changes are layered on top, but lifecycle callbacks, custom canvas sizing,
          and any non-toolbar config in the buffer are now authoritative.
        </li>
      </ul>
      <p>
        The runtime strip&apos;s <strong>SOURCE</strong> chip and the editor header dot both
        reflect this state, and you can flip it from MCP via{" "}
        <code>rav_configure_workspace</code> with <code>source_mode: &quot;editor&quot;</code>{" "}
        or <code>&quot;internal&quot;</code>.
      </p>

      <h2>Standalone export preservation</h2>
      <p>
        When editor mode is active, standalone export carries the raw <strong>applied</strong>
        editor object and its lifecycle callbacks into the self-contained HTML file. The exported
        runtime executes that config after its own ViewModel binding and snapshot restoration, so
        callbacks and non-toolbar settings survive outside RAV. Draft edits that have not been
        applied are not treated as live export configuration.
      </p>
      <p>
        Candidate acceptance included a live exported marker test: an applied editor script was
        exported, opened as a standalone page, and observed executing there.
      </p>

      <h2>The live instance: <code>window.riveInst</code></h2>
      <p>
        RAV always exposes the active Rive instance on{" "}
        <code>window.riveInst</code>. Lifecycle callbacks should reach for that global rather
        than capturing a local <code>rive</code> variable &mdash; after every APPLY the
        instance is replaced, and a captured local will go stale. Helpers worth knowing:
      </p>
      <ul>
        <li><code>window.riveInst.resizeDrawingSurfaceToCanvas()</code> &mdash; call inside <code>onLoad</code> to lock the drawing buffer to the current canvas pixel size</li>
        <li><code>window.refreshVmInputControls?.()</code> &mdash; tells the right-panel control list to re-render after a runtime change</li>
        <li><code>window.vmGet / vmSet / vmFire</code> &mdash; convenience wrappers installed only when the VM Explorer snippet is injected</li>
        <li><code>window.ravRive</code> &mdash; exposed by generated CDN and local snippets when helper bindings are emitted; RAV itself does not use it internally</li>
      </ul>

      <h2>VM Explorer snippet</h2>
      <p>
        The editor toolbar exposes an <strong>Inject VM Explorer</strong> action that
        prepends a small read-only snippet to the buffer. The snippet introspects the loaded
        ViewModel hierarchy on <code>onLoad</code> and prints a tree of paths, types, and
        current values to the console. Useful when you don&apos;t know the shape of a file&apos;s
        bindings yet.
      </p>
      <p>
        The same toggle is available from MCP via{" "}
        <code>rav_configure_workspace</code> with <code>vm_explorer: &quot;inject&quot;</code>{" "}
        or <code>&quot;remove&quot;</code>.
      </p>

      <h2>MCP from the editor</h2>
      <p>
        Every editor action has an MCP equivalent for agent-driven workflows:
      </p>
      <ul>
        <li><code>rav_get_editor_code</code> &mdash; read the current buffer (returns whatever is in the editor, dirty or not)</li>
        <li><code>rav_set_editor_code</code> &mdash; replace the buffer (does <strong>not</strong> apply &mdash; call <code>rav_apply_code</code> next)</li>
        <li><code>rav_apply_code</code> &mdash; equivalent to clicking APPLY (requires <strong>Script Access</strong>)</li>
        <li><code>generate_web_instantiation_code</code> &mdash; emit a copy-paste snippet that mirrors the live mode currently running in RAV (CDN or local, compact or scaffold)</li>
        <li><code>rav_status</code> &mdash; surfaces <code>sourceMode</code> and a <code>draftDirty</code> flag so an agent can tell whether unsaved buffer changes exist</li>
      </ul>

      <h2>Build &amp; runtime info</h2>
      <p>
        The editor panel&apos;s footer shows the current RAV release, build hash, runtime
        package, runtime version, and which version was actually requested. These are baked
        into every standalone export so you can later confirm exactly which combination
        produced a given demo file.
      </p>
    </>
  );
}
