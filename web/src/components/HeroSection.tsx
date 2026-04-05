import { asset } from "@/lib/config";
import { getLatestRelease, formatBytes } from "@/lib/github";
import { Apple, Monitor } from "lucide-react";
import InteractiveDemo from "./InteractiveDemo";

export default async function HeroSection() {
  const release = await getLatestRelease();
  const macSilicon = release?.downloads.find(d => d.platform === 'mac-silicon');
  const macIntel = release?.downloads.find(d => d.platform === 'mac-intel');
  const winDownload = release?.downloads.find(d => d.platform === 'windows');

  return (
    <section className="relative flex flex-col items-center pt-32 pb-8 px-8 w-full overflow-hidden">
      {/* Atmospheric glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-[#C4F82A] opacity-[0.04] blur-[120px] pointer-events-none" />
      <div className="absolute top-40 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-[#C4F82A] opacity-[0.06] blur-[80px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-6 max-w-[900px]">
        {/* Version badge */}
        {release && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--border-light)] bg-[var(--bg-zinc)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--neon)]" />
            <span className="text-[11px] font-mono text-[var(--text-muted)]">
              v{release.version}
            </span>
          </div>
        )}

        {/* Staccato headline */}
        <h1 className="font-sans font-bold text-[clamp(2.5rem,5vw,4.5rem)] text-center text-[var(--text-white)] leading-[1.1] tracking-tight">
          Open. Inspect. Ship.
        </h1>

        {/* Subtitle — what it actually does */}
        <p className="text-[clamp(1rem,1.8vw,1.25rem)] text-center text-[var(--text-muted)] leading-relaxed max-w-[600px]">
          The standalone desktop tool for Rive animations. Load
          any <code className="text-[var(--neon)] bg-[var(--neon-dim)] px-1.5 py-0.5 rounded text-[0.9em]">.riv</code>,
          bind ViewModels, drive state machines, and export production-ready code.
        </p>

        {/* Download row */}
        <div className="flex flex-col sm:flex-row items-center gap-3 mt-2">
          <a
            href={macSilicon?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
            className="group flex items-center gap-2.5 px-5 py-2.5 rounded-lg btn-neon text-sm font-semibold hover:shadow-[0_0_32px_var(--neon-glow)] transition-shadow duration-300"
          >
            <Apple className="w-4 h-4" />
            <span>Download for Mac</span>
            {macSilicon && <span className="text-[10px] opacity-50">{formatBytes(macSilicon.size)}</span>}
          </a>

          <div className="flex items-center gap-2">
            <a
              href={macIntel?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-light)] text-sm text-[var(--text-dim)] hover:text-[var(--text-white)] hover:border-[var(--neon-glow)] transition-colors duration-300"
            >
              <Apple className="w-3.5 h-3.5" />
              <span>Intel</span>
            </a>
            <a
              href={winDownload?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-light)] text-sm text-[var(--text-dim)] hover:text-[var(--text-white)] hover:border-[var(--neon-glow)] transition-colors duration-300"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Windows</span>
            </a>
          </div>
        </div>

        <p className="text-[11px] text-[var(--text-ghost)] font-mono">
          macOS 11+ &middot; Windows 10+ &middot; Free &amp; open source
        </p>
      </div>

      {/* Interactive demo — the live app IS the hero */}
      <div className="relative z-10 mt-12 w-full px-4">
        <InteractiveDemo />
      </div>
    </section>
  );
}
