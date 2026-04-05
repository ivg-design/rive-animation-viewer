import Image from "next/image";
import { asset } from "@/lib/config";
import { getLatestRelease, formatBytes } from "@/lib/github";
import { Apple, Monitor, Download } from "lucide-react";

export default async function HeroSection() {
  const release = await getLatestRelease();
  const macSilicon = release?.downloads.find(d => d.platform === 'mac-silicon');
  const macIntel = release?.downloads.find(d => d.platform === 'mac-intel');
  const winDownload = release?.downloads.find(d => d.platform === 'windows');

  return (
    <section className="flex flex-col items-center gap-12 py-24 px-8 hero-gradient w-full">
      <div className="flex flex-col items-center gap-8 max-w-[800px]">
        {/* App Icon */}
        <Image
          src={asset("/images/app-icon.png")}
          alt="Rive Animation Viewer"
          width={120}
          height={120}
          className="rounded-[28px] shadow-2xl animate-pulse-glow"
          priority
        />

        {/* Version badge */}
        {release && (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--neon-dim)] border border-[var(--neon-glow)]">
            <div className="w-2 h-2 rounded-full bg-[var(--neon)]" />
            <span className="text-xs font-mono font-medium text-[var(--neon)]">
              v{release.version} available
            </span>
          </div>
        )}

        {/* Title */}
        <h1 className="font-sans font-bold text-5xl md:text-[56px] text-center text-[var(--text-white)] leading-tight tracking-tight">
          Rive Animation Viewer
        </h1>

        {/* Tagline */}
        <p className="text-lg text-center text-[var(--text-dim)] leading-relaxed max-w-[600px]">
          Inspect, debug, and test Rive animations on desktop. ViewModel controls,
          event console, transparency overlay, and standalone export.
        </p>

        {/* Three Platform Download Links */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {/* Apple Silicon */}
          <a
            href={macSilicon?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
            className="group flex items-center gap-2.5 px-6 py-3 rounded-xl btn-neon text-[14px] hover:scale-105 transition-all duration-300"
          >
            <Apple className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" />
            <div className="flex flex-col items-start">
              <span className="font-semibold">macOS &middot; Apple Silicon</span>
              {macSilicon && <span className="text-[11px] opacity-60">.dmg &middot; {formatBytes(macSilicon.size)}</span>}
            </div>
          </a>

          {/* Intel */}
          <a
            href={macIntel?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
            className="group flex items-center gap-2.5 px-6 py-3 rounded-xl bg-[var(--bg-zinc)] border border-[var(--border-light)] text-[14px] font-semibold text-[var(--text-white)] hover:border-[var(--neon)] hover:scale-105 transition-all duration-300"
          >
            <Apple className="w-5 h-5 text-[var(--text-dim)] group-hover:text-[var(--neon)] transition-colors duration-300" />
            <div className="flex flex-col items-start">
              <span>macOS &middot; Intel</span>
              {macIntel && <span className="text-[11px] text-[var(--text-muted)]">.dmg &middot; {formatBytes(macIntel.size)}</span>}
            </div>
          </a>

          {/* Windows */}
          <a
            href={winDownload?.url || "https://github.com/ivg-design/rive-animation-viewer/releases/latest"}
            className="group flex items-center gap-2.5 px-6 py-3 rounded-xl bg-[var(--bg-zinc)] border border-[var(--border-light)] text-[14px] font-semibold text-[var(--text-white)] hover:border-[var(--neon)] hover:scale-105 transition-all duration-300"
          >
            <Monitor className="w-5 h-5 text-[var(--text-dim)] group-hover:text-[var(--neon)] transition-colors duration-300" />
            <div className="flex flex-col items-start">
              <span>Windows</span>
              {winDownload && <span className="text-[11px] text-[var(--text-muted)]">.msi &middot; {formatBytes(winDownload.size)}</span>}
            </div>
          </a>
        </div>

        {/* Requirements */}
        <p className="text-[13px] text-[var(--text-ghost)]">
          macOS 11+ (Apple Silicon or Intel) &middot; Windows 10+
        </p>
      </div>
    </section>
  );
}
