import { getLatestRelease, formatBytes } from "@/lib/github";
import { Apple, Monitor, ExternalLink } from "lucide-react";

export default async function DownloadSection() {
  const release = await getLatestRelease();
  const macSilicon = release?.downloads.find(d => d.platform === 'mac-silicon');
  const macIntel = release?.downloads.find(d => d.platform === 'mac-intel');
  const windows = release?.downloads.find(d => d.platform === 'windows');

  return (
    <section id="downloads" className="relative w-full py-24 px-8 overflow-hidden">
      {/* Atmospheric glow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-[#C4F82A] opacity-[0.03] blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-[700px] mx-auto text-center">
        <p className="font-mono text-xs tracking-[0.2em] uppercase text-[var(--neon)] mb-4">
          Download
        </p>
        <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold text-[var(--text-white)] leading-[1.15] mb-3">
          Ready when you are
        </h2>
        <p className="text-base text-[var(--text-muted)] mb-10">
          Free, open source, and shipping for macOS and Windows.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
          <a
            href={macSilicon?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
            className="flex items-center gap-2.5 px-6 py-3 rounded-lg btn-neon text-sm font-semibold hover:shadow-[0_0_32px_var(--neon-glow)] transition-shadow duration-300"
          >
            <Apple className="w-4 h-4" />
            <span>Mac &middot; Apple Silicon</span>
            {macSilicon && <span className="text-[10px] opacity-50">{formatBytes(macSilicon.size)}</span>}
          </a>
          <a
            href={macIntel?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
            className="flex items-center gap-2 px-5 py-3 rounded-lg border border-[var(--border-light)] text-sm text-[var(--text-dim)] hover:text-[var(--text-white)] hover:border-[var(--neon-glow)] transition-colors duration-300"
          >
            <Apple className="w-3.5 h-3.5" />
            <span>Mac &middot; Intel</span>
          </a>
          <a
            href={windows?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
            className="flex items-center gap-2 px-5 py-3 rounded-lg border border-[var(--border-light)] text-sm text-[var(--text-dim)] hover:text-[var(--text-white)] hover:border-[var(--neon-glow)] transition-colors duration-300"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Windows</span>
          </a>
        </div>

        <a
          href="https://github.com/ivg-design/rive-animation-viewer/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-ghost)] hover:text-[var(--text-muted)] transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          All releases on GitHub
        </a>
      </div>
    </section>
  );
}
