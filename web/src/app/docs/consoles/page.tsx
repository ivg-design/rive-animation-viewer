import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Consoles" };

export default function Consoles() {
  return (
    <>
      <h1>Consoles</h1>

      <p>
        The bottom panel has two modes that share the same layout: Event Console and
        JavaScript Console. A compact header toggle switches between <strong>Events</strong>
        and <strong>JS</strong>.
      </p>

      <h2>Event Console</h2>

      <Image src={asset("/docs/event-console.webp")} alt="Event console showing mixed source entries with filter toggles and action buttons" width={800} height={200} className="rounded-xl border border-[var(--border-dark)] my-4" />

      <h3>Event Sources</h3>
      <table>
        <thead><tr><th>Source</th><th>Badge</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td>Native</td><td><code>NATIVE</code></td><td>Runtime events: load, play, pause, state change</td></tr>
          <tr><td>Rive User</td><td><code>RIVE USER</code></td><td>Custom events fired from the animation</td></tr>
          <tr><td>UI</td><td><code>UI</code></td><td>App UI events: settings changes, panel toggles</td></tr>
          <tr><td>MCP</td><td><code>MCP</code></td><td>MCP bridge events: commands, responses, connections</td></tr>
        </tbody>
      </table>

      <h3>Filtering</h3>
      <p>
        Each source has an independent toggle. A text search field filters across all
        visible events. Multiple sources can be active simultaneously.
      </p>

      <h3>Actions</h3>
      <ul>
        <li><strong>FOLLOW</strong> &mdash; amber toggle that keeps the newest event pinned in view</li>
        <li><strong>COPY</strong> &mdash; copies the current visible transcript</li>
        <li><strong>CLEAR</strong> &mdash; clears the transcript</li>
      </ul>

      <h3>Ordering</h3>
      <p>Events are listed newest-first. FOLLOW keeps the latest entry in view. Scrolling away turns follow off automatically.</p>

      <hr />

      <h2>JavaScript Console</h2>

      <Image src={asset("/docs/js-console.webp")} alt="JavaScript console showing REPL command, result with object expansion, timestamps and level filters" width={800} height={200} className="rounded-xl border border-[var(--border-dark)] my-4" />

      <h3>REPL</h3>
      <p>
        The input bar at the bottom executes JavaScript against the live runtime context.
        Press <strong>Enter</strong> to execute, <strong>Arrow Up/Down</strong> for command
        history.
      </p>

      <h3>Output</h3>
      <p>
        Commands, results, warnings, errors, and app log lines all render with the same
        timestamp-and-badge treatment. Eruda&apos;s lazy object inspection is preserved
        for complex objects like <code>riveInst</code>.
      </p>

      <h3>Level Filters</h3>
      <p>
        ALL, INFO, WARNING, ERROR toggle buttons filter the visible transcript. Filters
        apply to REPL entries and app-generated log lines equally.
      </p>

      <h3>Available Globals</h3>
      <pre><code>{`window.riveInst    // The active Rive instance

// Available after injecting VM Explorer:
vmExplore()        // Show root VM properties
vmGet("path")      // Get a VM property value
vmSet("path", val) // Set a VM property value
vmTree             // View full VM hierarchy (property, not function)
vmPaths            // List all property paths (property, not function)`}</code></pre>
    </>
  );
}
