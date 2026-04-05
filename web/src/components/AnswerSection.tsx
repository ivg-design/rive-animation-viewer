export default function AnswerSection() {
  return (
    <section className="w-full max-w-[1200px] px-8 py-12">
      <div className="rounded-2xl border border-[var(--border-dark)] bg-[var(--bg-zinc)] p-6 md:p-8 flex flex-col gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--neon)] font-semibold mb-3">
            Why RAV
          </p>
          <h2 className="text-3xl font-bold text-[var(--text-white)] mb-3">
            Test runtime behavior without standing up a web project
          </h2>
          <p className="text-[var(--text-dim)] leading-relaxed max-w-[720px]">
            Rive files are designed in the browser editor, but verifying how they behave
            in a real runtime &mdash; with ViewModels bound, state machines running, and
            controls responding &mdash; requires integration code. RAV removes that step.
            Open the <code>.riv</code>, inspect every property live, then export the exact
            snippet your codebase needs.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-[var(--border-dark)] bg-[var(--bg-void)] p-5 flex flex-col gap-2">
            <span className="text-2xl font-bold text-[var(--neon)]">32</span>
            <span className="text-sm font-semibold text-[var(--text-white)]">MCP Tools</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">
              Open files, inspect ViewModels, drive playback, edit scripts, generate snippets,
              and export demos &mdash; all from Claude, Codex, or any MCP client.
            </span>
          </div>
          <div className="rounded-xl border border-[var(--border-dark)] bg-[var(--bg-void)] p-5 flex flex-col gap-2">
            <span className="text-2xl font-bold text-[var(--neon)]">6</span>
            <span className="text-sm font-semibold text-[var(--text-white)]">Control Types</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">
              Boolean, number, string, enum, color, and trigger inputs auto-discovered
              from ViewModels and state machines with live two-way sync.
            </span>
          </div>
          <div className="rounded-xl border border-[var(--border-dark)] bg-[var(--bg-void)] p-5 flex flex-col gap-2">
            <span className="text-2xl font-bold text-[var(--neon)]">3</span>
            <span className="text-sm font-semibold text-[var(--text-white)]">Platforms</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">
              macOS Apple Silicon, macOS Intel, and Windows 64-bit with signed releases,
              auto-updates, and native window chrome.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
