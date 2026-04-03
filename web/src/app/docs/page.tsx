import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, BookOpen, Download, Monitor, Layers, Gamepad2, Terminal, Eye, FileCode, AppWindow, Keyboard, Settings, HelpCircle, Cable, LayoutGrid, RefreshCw } from "lucide-react";
import { asset } from "@/lib/config";
import { toCanonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "RAV Documentation | Rive Animation Viewer",
  description:
    "Complete RAV documentation for installation, ViewModel controls, unified consoles, MCP integration, standalone export, auto updates, and troubleshooting.",
  alternates: {
    canonical: toCanonicalUrl("/docs"),
  },
};

const sections = [
  { id: "getting-started", title: "Getting Started" },
  { id: "opening-files", title: "Opening Files" },
  { id: "ui-layout", title: "UI Layout" },
  { id: "viewmodel-controls", title: "ViewModel Controls" },
  { id: "artboard-switcher", title: "Artboard Switcher" },
  { id: "event-console", title: "Event Console" },
  { id: "script-console", title: "Script Console" },
  { id: "transparency-mode", title: "Transparency Mode" },
  { id: "standalone-export", title: "Standalone Export" },
  { id: "configuration", title: "Configuration" },
  { id: "mcp-integration", title: "MCP Integration" },
  { id: "automatic-updates", title: "Automatic Updates" },
  { id: "keyboard-shortcuts", title: "Keyboard Shortcuts" },
  { id: "troubleshooting", title: "Troubleshooting" },
];

const topicCards = [
  { icon: Download, title: "Getting Started", desc: "Installation & first launch", href: "#getting-started" },
  { icon: Layers, title: "Opening Files", desc: "Load .riv files", href: "#opening-files" },
  { icon: Monitor, title: "UI Layout", desc: "Toolbar, panels, and live status strips", href: "#ui-layout" },
  { icon: Gamepad2, title: "ViewModel Controls", desc: "Auto-discovered inputs", href: "#viewmodel-controls" },
  { icon: LayoutGrid, title: "Artboard Switcher", desc: "Switch artboards & animations", href: "#artboard-switcher" },
  { icon: Terminal, title: "Event Console", desc: "Newest-first runtime transcript", href: "#event-console" },
  { icon: Eye, title: "Transparency Mode", desc: "Click-through overlay", href: "#transparency-mode" },
  { icon: FileCode, title: "Standalone Export", desc: "Self-contained HTML", href: "#standalone-export" },
  { icon: AppWindow, title: "Script Console", desc: "REPL, timestamps, and follow mode", href: "#script-console" },
  { icon: Settings, title: "Configuration", desc: "Editor source modes, renderer, runtime, and layout", href: "#configuration" },
  { icon: Cable, title: "MCP Integration", desc: "Bundled sidecar, install detection, and Script Access", href: "#mcp-integration" },
  { icon: RefreshCw, title: "Automatic Updates", desc: "Built-in updater flow", href: "#automatic-updates" },
  { icon: Keyboard, title: "Keyboard Shortcuts", desc: "Actual implemented keys", href: "#keyboard-shortcuts" },
  { icon: HelpCircle, title: "Troubleshooting", desc: "Common issues", href: "#troubleshooting" },
];

function SectionSidebar() {
  return (
    <nav className="hidden lg:block fixed left-8 top-1/2 -translate-y-1/2 z-30">
      <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--bg-zinc)]/80 backdrop-blur-sm border border-[var(--border-light)]">
        <span className="text-[10px] font-medium text-[var(--text-ghost)] uppercase tracking-wider px-2 mb-1">
          Sections
        </span>
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-white)] hover:bg-[var(--bg-void)] transition-all duration-200"
          >
            {section.title}
          </a>
        ))}
      </div>
    </nav>
  );
}

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-void)]">
      <SectionSidebar />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[var(--bg-void)]/90 backdrop-blur-sm border-b border-[var(--border-dark)]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href={asset("/")}
            className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            <span>Back to RAV</span>
          </Link>
          <div className="flex items-center gap-3">
            <Image
              src={asset("/images/app-icon.png")}
              alt="RAV"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <BookOpen className="w-5 h-5 text-[var(--neon)]" />
            <span className="font-semibold text-[var(--text-white)]">Documentation</span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-6 border-b border-[var(--border-dark)]">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-[var(--text-white)] mb-4">
            RAV Documentation
          </h1>
          <p className="text-lg text-[var(--text-dim)] max-w-2xl mx-auto">
            Complete guide to using Rive Animation Viewer, including the script editor,
            unified consoles, MCP setup, export snippets, live runtime controls, and updater flow.
          </p>
        </div>
      </section>

      {/* Topic Grid */}
      <section className="py-12 px-6 border-b border-[var(--border-dark)]">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {topicCards.map((card) => (
              <a
                key={card.title}
                href={card.href}
                className="group flex flex-col items-center gap-3 p-5 rounded-xl bg-[var(--bg-zinc)] border border-[var(--border-dark)] hover:border-[var(--neon-glow)] hover:bg-[var(--bg-elevated)] transition-all duration-300 text-center"
              >
                <card.icon className="w-6 h-6 text-[var(--text-muted)] group-hover:text-[var(--neon)] transition-colors" />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-white)]">{card.title}</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{card.desc}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Documentation Content */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto docs-content">

          {/* Getting Started */}
          <h2 id="getting-started" className="scroll-mt-24">Getting Started</h2>

          <h3>Installation</h3>
          <p>
            RAV is available as a desktop application for macOS (Apple Silicon and Intel) and Windows.
            Download the latest release from the <a href="#downloads">downloads section</a> or from{" "}
            <a href="https://github.com/ivg-design/rive-animation-viewer/releases" target="_blank" rel="noopener noreferrer">
              GitHub Releases
            </a>.
          </p>

          <h3>macOS</h3>
          <ol>
            <li>Download the <code>.dmg</code> file for your architecture (Apple Silicon or Intel)</li>
            <li>Open the DMG and drag RAV to your Applications folder</li>
            <li>On first launch, right-click the app and select &quot;Open&quot; to bypass Gatekeeper</li>
            <li>RAV registers as the default handler for <code>.riv</code> files &mdash; you can double-click any <code>.riv</code> file to open it directly</li>
          </ol>

          <h3>Windows</h3>
          <ol>
            <li>Download the <code>.msi</code> installer</li>
            <li>Run the installer and follow the setup wizard</li>
            <li>RAV will be available from the Start menu</li>
          </ol>

          <h3>Browser Mode</h3>
          <p>
            RAV can also run as a local web server for quick inspection without installing:
          </p>
          <pre><code>git clone https://github.com/ivg-design/rive-animation-viewer.git{"\n"}cd rive-animation-viewer{"\n"}npm install{"\n"}npm start  # Opens browser at http://localhost:1420</code></pre>

          <hr />

          {/* Opening Files */}
          <h2 id="opening-files" className="scroll-mt-24">Opening Files</h2>

          <h3>Drag and Drop</h3>
          <p>
            Drag any <code>.riv</code> file onto the RAV window to load it. The animation begins playing immediately
            using the default playback target (or your configured state machine / animation).
          </p>

          <h3>File Dialog</h3>
          <p>
            Click the file input area in the toolbar to browse your filesystem and select a <code>.riv</code> file.
          </p>

          <h3>Double-Click (Desktop)</h3>
          <p>
            On macOS, RAV registers as a handler for <code>.riv</code> files. Double-click any <code>.riv</code> file
            in Finder to open it directly in RAV. If RAV is already running, the file is loaded into the existing
            window. On Windows, right-click a <code>.riv</code> file and choose &quot;Open with&quot; to associate RAV
            with the file type.
          </p>

          <h3>Supported Formats</h3>
          <p>
            RAV supports Rive runtime files (<code>.riv</code>). These are the compiled binary output from the{" "}
            <a href="https://rive.app" target="_blank" rel="noopener noreferrer">Rive Editor</a>.
            Source <code>.rev</code> project files cannot be opened directly.
          </p>

          <hr />

          {/* UI Layout */}
          <h2 id="ui-layout" className="scroll-mt-24">UI Layout</h2>

          <p>
            RAV uses a three-panel layout optimized for animation inspection:
          </p>

          <p>
            In <strong>2.0.2</strong>, the default startup state was tightened so the right properties
            panel opens by default while the editor and console stay closed until you explicitly open them.
          </p>

          <h3>Left Panel &mdash; Animation Canvas</h3>
          <p>
            The primary animation viewport. Renders the loaded Rive animation with the selected renderer
            (Canvas or WebGL2). Fit and alignment are controlled from the main toolbar so you can change
            composition without opening a secondary settings panel.
          </p>

          <h3>Top Toolbar</h3>
          <p>
            The top toolbar is split into three working clusters:
          </p>
          <ul>
            <li><strong>Left</strong> &mdash; app identity and the bright green <strong>OPEN</strong> button for file loading</li>
            <li><strong>Center</strong> &mdash; reset, play, pause, renderer, fit, alignment, and FPS status</li>
            <li><strong>Right</strong> &mdash; <strong>EXPORT</strong>, Settings, and the MCP Setup dialog</li>
          </ul>
          <p>
            Renderer selection now lives in the central controls cluster next to playback and layout controls,
            not beside the file-open action.
          </p>

          <h3>Right Panel &mdash; Controls</h3>
          <p>
            Contains ViewModel controls, state machine inputs, and playback settings.
            The panel is resizable by dragging the divider and can be collapsed entirely.
            Controls are organized in collapsible sections:
          </p>
          <ul>
            <li><strong>ViewModel inputs</strong> &mdash; auto-discovered from the loaded animation</li>
            <li><strong>State machine inputs</strong> &mdash; legacy number, boolean, and trigger controls</li>
            <li><strong>Player settings</strong> &mdash; renderer, layout, runtime semver, background color</li>
          </ul>

          <h3>Bottom Panel &mdash; Event Console</h3>
          <p>
            Collapsible transcript panel with two modes: Event Console and JavaScript Console.
            Both modes are resizable, timestamped, newest-first, and expose a sticky <strong>FOLLOW</strong>
            control that keeps the latest message pinned in view.
          </p>

          <p>
            The console action row now uses outlined icon buttons for <strong>FOLLOW</strong>,
            <strong>COPY</strong>, and <strong>CLEAR</strong> so both console modes share the same
            visual language and behavior.
          </p>

          <h3>Runtime Strip</h3>
          <p>
            When the console is closed, only the runtime strip remains visible. It shows the MCP indicator,
            console state, runtime version, loaded file, update status, and refresh state. The console chip
            cycles between <strong>closed</strong>, <strong>event console</strong>, and <strong>JS console</strong>.
          </p>

          <h3>Code Editor Panel</h3>
          <p>
            An optional panel (toggled from the toolbar) with a CodeMirror 6 editor for writing
            JavaScript configuration objects. Useful for advanced initialization options, custom
            callbacks, artboard/state machine selection, and live runtime re-instantiation.
          </p>
          <p>
            The <strong>EDITOR</strong> title block is also the live-source indicator. A faint neutral outline means
            RAV&apos;s internal wiring is driving the runtime. When the applied editor config is live, that same title
            block switches to green and its status dot pulses. The yellow outlined <strong>APPLY</strong> button
            promotes the current editor code to the active runtime configuration.
          </p>

          <hr />

          {/* ViewModel Controls */}
          <h2 id="viewmodel-controls" className="scroll-mt-24">ViewModel Controls</h2>

          <p>
            RAV automatically discovers ViewModel inputs from loaded animations and renders them as native
            controls in the right panel.
          </p>

          <h3>Supported Input Types</h3>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Control</th>
                <th>Behavior</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Boolean</td>
                <td>Toggle switch</td>
                <td>Immediately updates the runtime value</td>
              </tr>
              <tr>
                <td>Number</td>
                <td>Text input</td>
                <td>Accepts decimal values, updates on blur or Enter</td>
              </tr>
              <tr>
                <td>String</td>
                <td>Text input</td>
                <td>Updates on blur or Enter</td>
              </tr>
              <tr>
                <td>Trigger</td>
                <td>Button</td>
                <td>Fires the trigger once per click</td>
              </tr>
              <tr>
                <td>Enum</td>
                <td>Dropdown</td>
                <td>Lists all enum values, selects immediately</td>
              </tr>
              <tr>
                <td>Color</td>
                <td>Color picker</td>
                <td>Native color input with immediate preview</td>
              </tr>
            </tbody>
          </table>

          <h3>Nested ViewModels</h3>
          <p>
            When a ViewModel contains nested ViewModel properties, RAV renders them as collapsible
            sections with indentation. The root ViewModel starts expanded, nested ViewModels start
            collapsed. Click the section header to expand or collapse.
          </p>

          <h3>Live Sync</h3>
          <p>
            ViewModel controls continuously sync with the runtime. If a value is changed by the
            animation logic (e.g., a listener or state change), the control UI updates automatically.
            Active focused inputs are skipped during sync to avoid disrupting user edits.
          </p>

          <h3>Value Persistence</h3>
          <p>
            When you reset/restart an animation, RAV captures the current values of all ViewModel
            and state machine properties and restores them after reload. Trigger inputs are excluded
            from persistence since they are one-shot actions.
          </p>

          <hr />

          {/* Artboard Switcher */}
          <h2 id="artboard-switcher" className="scroll-mt-24">Artboard Switcher</h2>

          <p>
            RAV can display any artboard in a <code>.riv</code> file and switch between them
            without reloading the file. The Artboard / Animation control section appears in the
            Properties panel when a file is loaded.
          </p>

          <h3>Artboard Dropdown</h3>
          <p>
            Lists every artboard in the loaded file. Selecting a different artboard tears down the
            current Rive instance and creates a new one for the chosen artboard. Playback starts
            automatically.
          </p>

          <h3>Playback Dropdown</h3>
          <p>
            Shows the exact authored state machine and timeline animation names available on the selected
            artboard. Labels preserve original capitalization and formatting. Selecting a different playback
            target reloads the artboard with that target. State machines are listed first, but the viewer no
            longer rewrites names with visible prefixes.
          </p>

          <h3>VM Instance Selector</h3>
          <p>
            When the selected artboard&apos;s ViewModel definition has multiple named instances,
            an additional <strong>VM Instance</strong> dropdown appears. Selecting a different
            instance binds it to the runtime and re-renders the ViewModel controls with that
            instance&apos;s values. This is useful for inspecting per-instance data such as card
            variants or color presets.
          </p>

          <h3>Reset to Default</h3>
          <p>
            The <strong>DEFAULT</strong> button returns to the artboard and state machine that were
            detected when the file was first loaded. This is the quickest way to get back to the
            primary artboard after exploring other artboards or animations.
          </p>

          <h3>ViewModel Labels</h3>
          <p>
            ViewModel section headers display the exact name from the Rive file, preserving
            original casing, dashes, and special characters.
          </p>

          <h3>Export Behavior</h3>
          <p>
            The standalone export always captures the exact artboard, playback target, and ViewModel
            state currently shown in the viewer. If you are viewing a secondary artboard with a
            specific animation, the export will embed that configuration.
          </p>

          <hr />

          {/* Event Console */}
          <h2 id="event-console" className="scroll-mt-24">Event Console</h2>

          <p>
            The event console captures and displays events from multiple sources in real time.
          </p>

          <h3>Event Sources</h3>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Tag</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Native</td>
                <td><code>NATIVE</code></td>
                <td>Low-level runtime events (load, play, pause, state change)</td>
              </tr>
              <tr>
                <td>Rive User</td>
                <td><code>RIVE USER</code></td>
                <td>Custom events fired from the Rive animation (RiveEvent)</td>
              </tr>
              <tr>
                <td>UI</td>
                <td><code>UI</code></td>
                <td>Player UI events (settings changes, panel toggles)</td>
              </tr>
              <tr>
                <td>MCP</td>
                <td><code>MCP</code></td>
                <td>MCP bridge events (commands, responses, connections)</td>
              </tr>
            </tbody>
          </table>

          <h3>Filtering</h3>
          <p>
            Each source has an independent toggle button. Click to enable/disable events from
            that source. Multiple sources can be active simultaneously. A text search field
            provides additional filtering across all visible events.
          </p>

          <h3>Console Actions</h3>
          <p>
            The console toolbar places search first, followed by outlined icon actions for:
          </p>
          <ul>
            <li><strong>FOLLOW</strong> &mdash; amber toggle that keeps the newest event in view</li>
            <li><strong>COPY</strong> &mdash; green action that copies the current transcript</li>
            <li><strong>CLEAR</strong> &mdash; red action that clears the current console transcript</li>
          </ul>

          <h3>Ordering and Follow Mode</h3>
          <p>
            Events are listed newest-first. The <strong>FOLLOW</strong> toggle keeps the latest
            entry pinned in view. If you scroll away from the top, follow mode turns off automatically.
            Scroll back to the latest event or toggle <strong>FOLLOW</strong> to re-enable it.
          </p>

          <hr />

          {/* Script Console */}
          <h2 id="script-console" className="scroll-mt-24">Script Console</h2>

          <p>
            Script Console mode transforms the bottom panel into a REPL for live JavaScript
            evaluation against the running animation.
          </p>

          <h3>Activating Console Mode</h3>
          <p>
            Use the runtime-strip console control to cycle between closed, Event Console, and JavaScript
            Console. When the JS console is active, the bottom panel shows a command input and output
            stream while preserving the same transcript styling as the Event Console.
          </p>

          <h3>REPL Behavior</h3>
          <p>
            The JavaScript console is a true REPL against the live runtime. Commands execute against the current
            page context, results appear with timestamps in the shared newest-first transcript, and command history
            is available from the input. The input stays at the bottom of the panel while the transcript above it
            follows the same ordering and follow-mode semantics as the Event Console.
          </p>

          <h3>Consistent Row Chrome</h3>
          <p>
            As of <strong>2.0.5</strong>, the JavaScript console uses one consistent visual language for every row and the bundled MCP launcher path ships cleanly across macOS and Windows releases.
            REPL commands, REPL results, warnings, errors, and app-generated log lines all render with the same
            timestamp-and-badge treatment. This keeps the console readable without giving up Eruda&apos;s native
            lazy object inspection for complex runtime objects like <code>riveInst</code>.
          </p>

          <h3>Available Globals</h3>
          <pre><code>window.riveInst    // The active Rive instance{"\n"}window.canvas      // The animation canvas element{"\n"}vmExplore()        // Show root VM properties{"\n"}vmGet(&quot;path&quot;)      // Get a VM property value{"\n"}vmSet(&quot;path&quot;, val) // Set a VM property value{"\n"}vmTree             // View full VM hierarchy{"\n"}vmPaths            // List all property paths</code></pre>

          <h3>Output</h3>
          <p>
            The console displays timestamped command, result, warning, info, and error rows. Results are
            inserted at the top like event entries, and the shared <strong>FOLLOW</strong> behavior works
            the same way as in the Event Console.
          </p>

          <h3>Filtering and Copy</h3>
          <p>
            Level filters and search operate on the visible JavaScript console transcript itself, not a separate
            hidden logger state. That means command/result rows obey the same filter rules as normal log lines.
            The <strong>COPY</strong> action also mirrors exactly what is currently visible on screen, in the same
            newest-first order.
          </p>

          <hr />

          {/* Transparency Mode */}
          <h2 id="transparency-mode" className="scroll-mt-24">Transparency Mode</h2>

          <p>
            Transparency mode removes the canvas background and window chrome, allowing you to
            overlay the animation on top of other content.
          </p>

          <h3>Enabling Transparency</h3>
          <ol>
            <li>Click the <strong>Transparency</strong> toggle in player settings</li>
            <li>The canvas background becomes transparent</li>
            <li>On desktop, the window background also becomes transparent</li>
          </ol>

          <h3>Click-Through (Desktop Only)</h3>
          <p>
            When transparency mode is active on the desktop app, enable <strong>Click Through</strong>
            to allow mouse events to pass through transparent pixels to the window below. RAV uses
            continuous cursor-position sync to sample pixel transparency and forward clicks when
            the cursor is over a fully transparent area.
          </p>

          <h3>Background Reset</h3>
          <p>
            Use the <strong>No BG</strong> button to return the canvas to transparent mode after
            selecting a solid background color.
          </p>

          <blockquote>
            <p>
              Transparency mode is a desktop-only feature. Exported standalone demos disable the
              transparency toggle to avoid exposing a non-functional control.
            </p>
          </blockquote>

          <hr />

          {/* Standalone Export */}
          <h2 id="standalone-export" className="scroll-mt-24">Standalone Export</h2>

          <p>
            RAV can export self-contained HTML demo files that embed the animation, runtime,
            and ViewModel controls into a single portable file.
          </p>

          <h3>What Gets Exported</h3>
          <ul>
            <li>The <code>.riv</code> binary, base64-encoded and embedded</li>
            <li>The selected runtime package (Canvas or WebGL2) bundled inline</li>
            <li>The selected runtime semver baked into the exported file</li>
            <li>The current artboard, playback target, and active live source mode</li>
            <li>Only the checked or changed ViewModel / state-machine values from the export dialog</li>
            <li>ViewModel control UI matching the current hierarchy</li>
            <li>The generated canonical instantiation snippets (`cdn` and `local` variants)</li>
            <li>Current player layout state (panel sizes, visibility, toolbar layout state)</li>
            <li>Complete styling for standalone viewing</li>
          </ul>

          <h3>Exporting</h3>
          <ol>
            <li>Load and configure your animation in RAV</li>
            <li>Adjust panels, playback, runtime, and controls to the desired live state</li>
            <li>Click the <strong>Export</strong> button in the toolbar</li>
            <li>Use the <strong>Snippet &amp; Export Controls</strong> dialog to choose CDN or local-package output and curate which controls should be serialized</li>
            <li>Copy the generated snippet directly from the dialog if you only need the code</li>
            <li>Choose a save location for the HTML file if you want a standalone export</li>
          </ol>

          <h3>Snippet &amp; Export Controls</h3>
          <p>
            The export dialog is shared by both in-app snippet generation and standalone export. Branch
            checkboxes select entire nested ViewModel sections, while individual leaf checkboxes select
            just one control. The dialog defaults to the changed-control set, but you can switch to
            <strong>SELECT ALL</strong> or <strong>CLEAR</strong> as needed.
          </p>
          <p>
            Branch expansion state is preserved while you select nested controls, so you can work deeply inside
            a ViewModel tree without the dialog collapsing back to the root after each checkbox change.
          </p>

          <h3>Limitations</h3>
          <ul>
            <li>Transparency mode toggle is disabled in exports (desktop-only feature)</li>
            <li>The exported file requires a modern browser that supports the selected runtime (WebGL2 exports require WebGL2)</li>
            <li>File size depends on the embedded <code>.riv</code> animation size</li>
          </ul>

          <hr />

          {/* Configuration */}
          <h2 id="configuration" className="scroll-mt-24">Configuration</h2>

          <h3>Code Editor</h3>
          <p>
            The code editor panel accepts JavaScript objects (not JSON) for advanced Rive initialization.
            You can use comments, trailing commas, and unquoted keys:
          </p>
          <pre><code>{`{
  // Select a specific artboard
  artboard: "MyArtboard",
  stateMachines: ["StateMachine1"],
  autoplay: true,
  layout: {
    fit: "contain",
    alignment: "center"
  },
  onLoad: () => {
    console.log("Animation loaded!");
  }
}`}</code></pre>

          <p>
            The editor header itself indicates which configuration source is driving the live runtime.
            A faint neutral outline means RAV&apos;s internal wiring is active. A green pulsing state means
            the applied editor config is live. Unsaved draft edits do not affect playback until applied.
          </p>

          <h3>Apply &amp; Reload</h3>
          <p>
            The <strong>APPLY</strong> button in the script editor toolbar takes the JavaScript config
            object you&apos;ve written, evaluates it, tears down the current Rive instance, and creates
            a new one with that configuration.
            This is how you apply any changes you make in the editor &mdash; artboard selection,
            state machine targeting, autoplay settings, custom callbacks, and layout options.
            The refresh path preserves the active artboard/playback context and other live state as
            far as the runtime allows instead of resetting back to defaults.
          </p>
          <p>
            The config object supports all Rive constructor options including:
          </p>
          <ul>
            <li><code>artboard</code> &mdash; select a specific artboard by name</li>
            <li><code>stateMachines</code> &mdash; target a state machine (string or array)</li>
            <li><code>animations</code> &mdash; target a timeline animation (string or array)</li>
            <li><code>autoplay</code> &mdash; start playback immediately (default true)</li>
            <li><code>autoBind</code> &mdash; bind ViewModels automatically (default true, required for VM controls)</li>
            <li><code>layout</code> &mdash; set fit and alignment (<code>{`{ fit: "contain", alignment: "center" }`}</code>)</li>
            <li><code>useOffscreenRenderer</code> &mdash; improves glow/shadow quality for transparent overlays</li>
            <li><code>onLoad</code>, <code>onPlay</code>, <code>onPause</code>, <code>onStateChange</code> &mdash; lifecycle callbacks</li>
          </ul>

          <h3>Internal vs Editor Live Mode</h3>
          <p>
            RAV distinguishes between your editable draft and the live runtime source:
          </p>
          <ul>
            <li><strong>Internal</strong> &mdash; the app is using its built-in default instantiation wiring</li>
            <li><strong>Editor</strong> &mdash; the last applied script editor config is driving the runtime</li>
          </ul>
          <p>
            Draft changes in the editor do nothing until you click <strong>APPLY</strong>. Exports, generated snippets,
            and MCP status all reflect the active live mode, not the unsaved editor buffer.
          </p>

          <h3>Renderer Selection</h3>
          <p>
            Choose between <strong>Canvas</strong> and <strong>WebGL2</strong> renderers.
            WebGL2 is recommended for vector feathering and complex animations. Canvas provides
            better compatibility on older hardware.
          </p>

          <h3>Runtime Version (Semver) Selection</h3>
          <p>
            In Settings, use <strong>Runtime Ver</strong> to choose which runtime semver to load.
            RAV provides <strong>Latest (auto)</strong>, the latest 4 concrete versions, and a
            <strong>Custom</strong> entry for manual semver input.
          </p>
          <ul>
            <li><strong>Latest (auto)</strong> resolves to a concrete semver before loading</li>
            <li><strong>Custom</strong> reveals the version input + <strong>Set</strong> button (hidden otherwise)</li>
            <li>Selected runtime semver is persisted per file and restored when that file is opened again</li>
            <li>Exported standalone demos embed the currently selected runtime semver</li>
          </ul>

          <h3>Layout Options</h3>
          <p>
            Fit and alignment are surfaced directly in the main toolbar, so the viewer layout is always
            visible while you work. Those selections are mirrored into generated snippets and exports.
          </p>
          <table>
            <thead>
              <tr>
                <th>Option</th>
                <th>Behavior</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>contain</code></td><td>Fit entirely within canvas, preserving aspect ratio</td></tr>
              <tr><td><code>cover</code></td><td>Fill canvas, cropping as needed</td></tr>
              <tr><td><code>fill</code></td><td>Stretch to fill canvas (may distort)</td></tr>
              <tr><td><code>fitWidth</code></td><td>Match canvas width, overflow height</td></tr>
              <tr><td><code>fitHeight</code></td><td>Match canvas height, overflow width</td></tr>
              <tr><td><code>scaleDown</code></td><td>Only shrink if larger than canvas</td></tr>
            </tbody>
          </table>

          <hr />

          {/* MCP Integration */}
          <h2 id="mcp-integration" className="scroll-mt-24">MCP Integration</h2>

          <p>
            RAV includes a built-in <strong>MCP (Model Context Protocol)</strong> sidecar that lets{" "}
            <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer">Claude Code</a>{" "}
            , Claude Desktop, Codex, or any MCP client control the viewer remotely &mdash; open files,
            inspect ViewModels, drive playback, manipulate inputs, read event logs, edit scripts,
            execute JS, generate web snippets, and export demos.
          </p>

          <h3>What is MCP?</h3>
          <p>
            <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">MCP (Model Context Protocol)</a>{" "}
            is an open standard that lets AI tools like{" "}
            <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer">Claude Code</a>{" "}
            connect to external applications. With RAV&apos;s MCP server, Claude can open your .riv
            files, inspect their structure, drive playback, modify ViewModel values, and export demos
            &mdash; all through natural language commands.
          </p>

          <h3>How it works</h3>
          <p>
            RAV includes a bundled native <code>rav-mcp</code> sidecar that acts as a bridge between
            your MCP client and the RAV desktop app. When both are running, the client can control RAV remotely:
          </p>
          <pre><code>MCP Client &lt;-(stdio)-&gt; rav-mcp sidecar &lt;-(WebSocket)-&gt; RAV App</code></pre>
          <p>
            The RAV app starts its bridge automatically when it launches. The MCP dialog reports
            <strong>MCP ready</strong> when the bundled sidecar path and bridge are healthy, and the
            runtime-strip MCP indicator brightens when a client is actively connected.
          </p>

          <h3>Setup (one-time)</h3>
          <p>
            The desktop app ships with the MCP sidecar already bundled inside the app resources and exposes
            a stable launcher path for external clients. Open the in-app <strong>MCP Setup</strong> dialog to copy
            that launcher path, detect supported
            clients, and use one-click installation where available.
          </p>
          <ol>
            <li>
              <strong>Open the MCP Setup dialog</strong> from the toolbar cable icon.
            </li>
            <li>
              <strong>Install for your client</strong> using the dialog&apos;s one-click buttons
              for Codex, Claude Code, or Claude Desktop when those clients are detected. Existing
              installs show <strong>REINSTALL</strong> and <strong>REMOVE</strong>.
            </li>
            <li>
              <strong>Choose the bridge port and Script Access mode</strong> if you want something
              other than the default read-only MCP on port <code>9274</code>.
            </li>
            <li>
              <strong>Or copy a snippet manually</strong>:
              <pre><code>{`claude mcp add-json -s user rav-mcp '{"type":"stdio","command":"/Users/you/.local/bin/rav-mcp-rav","args":["--stdio-only","--port","9274"]}'`}</code></pre>
            </li>
            <li>
              <strong>Open RAV</strong> &mdash; launch the desktop app. The <strong>MCP</strong>{" "}
              indicator in the runtime strip turns indigo when a client connection is established.
            </li>
          </ol>
          <p>
            That&apos;s it. From now on, whenever both RAV and Claude Code are running, Claude can
            control the viewer. Try asking Claude: &quot;Open my animation file in RAV and show me
            the ViewModel tree.&quot;
          </p>

          <h3>MCP Setup Dialog</h3>
          <ul>
            <li><strong>Status row</strong> &mdash; simplified to <code>MCP ready</code> or <code>MCP disabled</code></li>
            <li><strong>Server path</strong> &mdash; the stable <code>rav-mcp-rav</code> launcher path generated for the current machine</li>
            <li><strong>Script Access</strong> &mdash; explicit safety gate for JS execution tools</li>
            <li><strong>MCP Port</strong> &mdash; editable bridge port with immediate snippet regeneration</li>
            <li><strong>Client detection</strong> &mdash; checks whether supported clients are installed and whether the RAV MCP entry is already present in their config</li>
            <li><strong>Install actions</strong> &mdash; shows <strong>ADD</strong>, <strong>REINSTALL</strong>, or <strong>REMOVE</strong> based on the actual detected state</li>
          </ul>

          <h3>Available Tools (31)</h3>
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>rav_status</code></td><td>App status: loaded file, runtime, playback, ViewModel summary</td></tr>
              <tr><td><code>rav_open_file</code></td><td>Open a .riv file by absolute path</td></tr>
              <tr><td><code>rav_play</code> / <code>rav_pause</code> / <code>rav_reset</code></td><td>Playback controls</td></tr>
              <tr><td><code>rav_get_artboards</code></td><td>List artboard names in the loaded file</td></tr>
              <tr><td><code>rav_get_state_machines</code></td><td>List state machine names on the current artboard</td></tr>
              <tr><td><code>rav_switch_artboard</code></td><td>Switch artboard and/or playback target</td></tr>
              <tr><td><code>rav_reset_artboard</code></td><td>Reset to default artboard and state machine</td></tr>
              <tr><td><code>rav_get_vm_tree</code></td><td>Full ViewModel hierarchy with paths and types</td></tr>
              <tr><td><code>rav_vm_get</code> / <code>rav_vm_set</code> / <code>rav_vm_fire</code></td><td>Read, write, and fire ViewModel properties by path</td></tr>
              <tr><td><code>rav_get_event_log</code></td><td>Recent event log entries (filterable by source)</td></tr>
              <tr><td><code>rav_get_editor_code</code> / <code>rav_set_editor_code</code></td><td>Read and write the script editor contents</td></tr>
              <tr><td><code>rav_apply_code</code></td><td>Apply editor code and reload the animation (<strong>Script Access</strong> required)</td></tr>
              <tr><td><code>rav_set_runtime</code></td><td>Switch runtime engine (webgl2 or canvas)</td></tr>
              <tr><td><code>rav_set_layout</code></td><td>Set canvas layout fit mode</td></tr>
              <tr><td><code>rav_set_canvas_color</code></td><td>Set background color or transparent</td></tr>
              <tr><td><code>rav_export_demo</code></td><td>Export a standalone HTML demo</td></tr>
              <tr><td><code>generate_web_instantiation_code</code></td><td>Generate the live canonical web snippet for <code>cdn</code> or <code>local</code> usage, including <code>window.ravRive</code> helpers and current control values</td></tr>
              <tr><td><code>rav_toggle_instantiation_controls_dialog</code></td><td>Open or close the in-app Snippet &amp; Export Controls dialog for manual control curation</td></tr>
              <tr><td><code>rav_configure_workspace</code></td><td>Open or close sidebars, switch the live source between <code>internal</code> and <code>editor</code>, and inject or remove the VM Explorer snippet</td></tr>
              <tr><td><code>rav_get_sm_inputs</code> / <code>rav_set_sm_input</code></td><td>State machine input access</td></tr>
              <tr><td><code>rav_eval</code></td><td>Evaluate JavaScript in RAV&apos;s browser context (<strong>Script Access</strong> required)</td></tr>
              <tr><td><code>rav_console_open</code> / <code>rav_console_close</code></td><td>Toggle the JS console panel</td></tr>
              <tr><td><code>rav_console_read</code> / <code>rav_console_exec</code></td><td>Read captured console output or run REPL code (<code>rav_console_exec</code> requires <strong>Script Access</strong>)</td></tr>
            </tbody>
          </table>

          <h3>Instantiation and Export Semantics</h3>
          <ul>
            <li><code>rav_status</code> reports whether the live runtime is using internal wiring or the applied editor config</li>
            <li><code>rav_apply_code</code> switches the live runtime to the last applied editor config</li>
            <li><code>generate_web_instantiation_code</code> always mirrors what is actually running, not the unsaved draft buffer</li>
            <li><code>generate_web_instantiation_code</code> defaults to the CDN form unless you explicitly request <code>package_source: &quot;local&quot;</code></li>
            <li>Generated snippets restore only the checked ViewModel/state-machine values on load, round numbers to 2 decimals, and expose helper methods on <code>window.ravRive</code></li>
            <li>The <strong>Snippet &amp; Export Controls</strong> dialog lets you choose exactly which values are serialized; if you never touch it, RAV defaults to the changed-control set</li>
            <li>Exported demos mirror the active live mode, surface fit/alignment in the main toolbar, and expose a <strong>Copy Instantiation Code</strong> toolbar button</li>
          </ul>

          <h3>Script Access</h3>
          <p>
            By default, MCP can read state and drive safe control operations. If you want an agent to
            run JavaScript or apply editor code, enable <strong>Script Access</strong> in the MCP Setup
            dialog. That unlocks <code>rav_eval</code>, <code>rav_console_exec</code>, and
            <code>rav_apply_code</code>.
          </p>

          <h3>Event Console</h3>
          <p>
            All MCP commands, responses, and connection events appear in the event console
            with the <code>MCP</code> source tag (indigo). Messages are formatted as human-readable
            summaries with elapsed time &mdash; no raw JSON. Use the <strong>MCP</strong> filter
            toggle to show or hide MCP traffic.
          </p>

          <h3>Connection Indicator</h3>
          <p>
            The runtime strip shows an <strong>MCP</strong> chip with a status dot. Connected is bright
            indigo. Disconnected is dim but still visible. Disabled is red with a strike-through.
          </p>

          <p>
            The MCP Setup dialog now opens immediately and performs its install-state checks in the
            background so detection of Codex, Claude Code, and Claude Desktop no longer blocks the modal.
          </p>

          <h3>Configuration</h3>
          <p>
            For normal use, the MCP surface is configured from the <strong>MCP Setup</strong> dialog inside the app.
            The only user-facing setting exposed there is the bridge port. Internal timeout and watchdog settings exist,
            but they are implementation details and are not part of the public UI contract.
          </p>

          <hr />

          {/* Automatic Updates */}
          <h2 id="automatic-updates" className="scroll-mt-24">Automatic Updates</h2>

          <p>
            Desktop builds include Tauri&apos;s updater plugin. On launch, RAV checks the configured
            GitHub Releases feed in the background. If a newer signed release is available, the runtime
            strip exposes an update chip.
          </p>

          <p>
            As of the 2.0.1 release path, the published updater feed is merged across all supported
            desktop targets. One <code>latest.json</code> now carries Apple Silicon, Intel macOS, and
            Windows updater entries together, so the updater no longer depends on whichever platform
            job published last.
          </p>

          <h3>Update Chip States</h3>
          <ul>
            <li><strong>Hidden</strong> &mdash; no update is available</li>
            <li><strong>UPDATE &lt;version&gt;</strong> &mdash; a newer version is ready to install</li>
            <li><strong>UPDATING &lt;version&gt;</strong> &mdash; the update archive is downloading and installing</li>
            <li><strong>RESTARTING</strong> &mdash; the update is installed and the app is relaunching</li>
            <li><strong>UPDATE RETRY</strong> &mdash; the last check or install failed and can be retried</li>
          </ul>

          <h3>How Installation Works</h3>
          <p>
            Clicking the update chip downloads the signed updater artifact for your platform, installs it,
            and relaunches the app. Release builds publish updater archives and signatures alongside the
            normal desktop installers.
          </p>

          <p>
            This flow was validated against the installed app itself: a local <code>2.0.0</code> build
            placed in <code>/Applications</code> successfully updated to <code>2.0.1</code>, relaunched,
            and then reported that no newer update was available.
          </p>

          <h3>Release Feed Semantics</h3>
          <p>
            The updater only surfaces a new version after the full multi-platform release finishes and the
            final merged <code>latest.json</code> feed is published. A partially complete GitHub release is
            not enough for the in-app updater to advance.
          </p>

          <hr />

          {/* Keyboard Shortcuts */}
          <h2 id="keyboard-shortcuts" className="scroll-mt-24">Keyboard Shortcuts</h2>

          <p>
            RAV is still primarily a pointer-driven desktop tool. The current build does
            <strong> not</strong> ship global playback shortcuts for play, pause, reset, fullscreen,
            or DevTools. The available keybindings are contextual and tied to the control that has focus.
          </p>

          <table>
            <thead>
              <tr>
                <th>Shortcut</th>
                <th>Context</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>Tab</code></td><td>Code editor</td><td>Indent by 2 spaces</td></tr>
              <tr><td><code>Shift+Tab</code></td><td>Code editor</td><td>Outdent by 2 spaces</td></tr>
              <tr><td><code>Enter</code></td><td>JavaScript Console REPL</td><td>Run the current command</td></tr>
              <tr><td><code>ArrowUp</code></td><td>JavaScript Console REPL</td><td>Recall the previous command from history</td></tr>
              <tr><td><code>ArrowDown</code></td><td>JavaScript Console REPL</td><td>Move forward through command history</td></tr>
              <tr><td><code>Enter</code></td><td>Runtime version custom field</td><td>Apply the custom runtime semver</td></tr>
              <tr><td><code>Enter</code></td><td>MCP port field</td><td>Apply the typed MCP port</td></tr>
              <tr><td><code>Escape</code></td><td>Settings popover</td><td>Close the open settings popover</td></tr>
            </tbody>
          </table>

          <hr />

          {/* Troubleshooting */}
          <h2 id="troubleshooting" className="scroll-mt-24">Troubleshooting</h2>

          <h3>Animation won&apos;t load</h3>
          <ul>
            <li>Verify the file is a valid <code>.riv</code> file (not a <code>.rev</code> project file)</li>
            <li>Check the event console for error messages</li>
            <li>Try switching between Canvas and WebGL2 renderers</li>
            <li>Ensure the file isn&apos;t corrupted &mdash; try opening it in the Rive Editor first</li>
          </ul>

          <h3>Configuration won&apos;t apply</h3>
          <ul>
            <li>Ensure you&apos;re writing valid JavaScript syntax (not JSON)</li>
            <li>Check the red error banner for syntax error details</li>
            <li>Errors auto-dismiss after 5 seconds; check the console for persistent errors</li>
          </ul>

          <h3>ViewModel controls missing</h3>
          <ul>
            <li>The animation must have ViewModelInstances defined in the Rive Editor</li>
            <li>Check that <code>autoBind: true</code> is set (default behavior)</li>
            <li>Try reloading the animation</li>
          </ul>

          <h3>Desktop build fails</h3>
          <ul>
            <li>Run <code>rustup update</code> to ensure latest Rust toolchain</li>
            <li>Check <code>npm run tauri info</code> for missing dependencies</li>
            <li>On macOS, verify Xcode Command Line Tools are installed</li>
          </ul>

          <h3>MCP not connecting</h3>
          <ul>
            <li>Verify the MCP server is registered: <code>claude mcp list</code> or <code>codex mcp list</code></li>
            <li>Check that RAV is running and the browser console shows <code>[rav-mcp-bridge] Connected</code></li>
            <li>Ensure port 9274 is available (or set <code>RAV_MCP_PORT</code> to a different port)</li>
            <li>The bridge auto-reconnects with exponential backoff &mdash; if the MCP server started after RAV, wait a few seconds</li>
          </ul>

          <h3>CSP Warnings (Desktop)</h3>
          <p>
            The desktop app may show harmless CSP warnings about <code>blob://</code> URLs in the
            console. These are WebKit quirks and do not affect functionality.
          </p>

          <h3>Getting Help</h3>
          <p>
            If you encounter an issue not covered here,{" "}
            <a href="https://github.com/ivg-design/rive-animation-viewer/issues" target="_blank" rel="noopener noreferrer">
              open an issue on GitHub
            </a>{" "}
            with your OS version, RAV version, and the <code>.riv</code> file if possible.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-[var(--border-dark)]">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link
            href={asset("/")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg btn-neon text-sm transition-all hover:scale-105"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to RAV
          </Link>
          <a
            href="https://github.com/ivg-design/rive-animation-viewer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--neon)] transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}
