export default function AnswerSection() {
  return (
    <section className="w-full max-w-[1200px] px-8 py-12">
      <div className="rounded-2xl border border-[var(--border-dark)] bg-[var(--bg-zinc)] p-6 md:p-8 flex flex-col gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--neon)] font-semibold mb-3">
            Why I Made This?
          </p>
          <h2 className="text-3xl font-bold text-[var(--text-white)] mb-3">What is RAV?</h2>
          <p className="text-[var(--text-dim)] leading-relaxed">
            RAV (Rive Animation Viewer) is a standalone desktop application for inspecting and
            debugging <code>.riv</code> files. It runs locally, auto-discovers ViewModel inputs,
            logs runtime events, and can export self-contained HTML demos.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--border-dark)]">
          <table className="w-full min-w-[680px] text-left">
            <caption className="sr-only">RAV capability summary</caption>
            <thead>
              <tr className="border-b border-[var(--border-dark)] bg-[var(--bg-elevated)]">
                <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                  Metric
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                  Value
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--border-dark)]">
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">Supported platforms</td>
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">3</td>
                <td className="px-4 py-3 text-sm text-[var(--text-dim)]">macOS Apple Silicon, macOS Intel, Windows 64-bit</td>
              </tr>
              <tr className="border-b border-[var(--border-dark)]">
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">Layout modes</td>
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">8</td>
                <td className="px-4 py-3 text-sm text-[var(--text-dim)]">cover, contain, fill, fitWidth, fitHeight, scaleDown, none, layout</td>
              </tr>
              <tr className="border-b border-[var(--border-dark)]">
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">ViewModel input types</td>
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">6</td>
                <td className="px-4 py-3 text-sm text-[var(--text-dim)]">boolean, number, string, trigger, enum, color</td>
              </tr>
              <tr className="border-b border-[var(--border-dark)]">
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">Console source filters</td>
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">4</td>
                <td className="px-4 py-3 text-sm text-[var(--text-dim)]">Native, Rive User, UI, and MCP in the Event Console, plus a separate JS REPL mode</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">MCP tools</td>
                <td className="px-4 py-3 text-sm text-[var(--text-white)]">30</td>
                <td className="px-4 py-3 text-sm text-[var(--text-dim)]">Remote inspection, playback control, JS execution, snippet generation, and export automation</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
