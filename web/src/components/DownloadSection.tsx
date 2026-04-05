import { getLatestRelease, formatBytes } from "@/lib/github";
import { Apple, Monitor, Download, ExternalLink } from "lucide-react";

export default async function DownloadSection() {
  const release = await getLatestRelease();

  const macSilicon = release?.downloads.find(d => d.platform === 'mac-silicon');
  const macIntel = release?.downloads.find(d => d.platform === 'mac-intel');
  const windows = release?.downloads.find(d => d.platform === 'windows');

  const platforms = [
    macSilicon ? {
      icon: Apple,
      label: "macOS",
      subtitle: "Apple Silicon",
      chip: ".dmg",
      size: formatBytes(macSilicon.size),
      url: macSilicon.url,
    } : null,
    macIntel ? {
      icon: Apple,
      label: "macOS",
      subtitle: "Intel",
      chip: ".dmg",
      size: formatBytes(macIntel.size),
      url: macIntel.url,
    } : null,
    windows ? {
      icon: Monitor,
      label: "Windows",
      subtitle: "x64",
      chip: ".msi",
      size: formatBytes(windows.size),
      url: windows.url,
    } : null,
  ].filter(Boolean);

  return (
    <section id="downloads" className="flex flex-col items-center gap-12 py-24 px-8 bg-[var(--bg-zinc)] w-full">
      <div className="flex flex-col items-center gap-4">
        <span className="font-mono text-xs font-medium tracking-[3px] uppercase text-[var(--neon)]">
          Downloads
        </span>
        <h2 className="font-sans font-bold text-4xl text-[var(--text-white)]">
          Get RAV
        </h2>
        {release && (
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-md bg-[var(--neon-dim)] border border-[var(--neon-glow)] font-mono text-xs text-[var(--neon)]">
              v{release.version}
            </span>
            <span className="text-sm text-[var(--text-muted)]">
              {new Date(release.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        )}
      </div>

      {/* Platform Cards */}
      <div className="flex flex-col sm:flex-row gap-6 max-w-[900px] w-full justify-center">
        {platforms.map((platform) => platform && (
          <a
            key={platform.subtitle}
            href={platform.url}
            className="group flex flex-col items-center gap-4 p-8 rounded-2xl bg-[var(--bg-void)] border border-[var(--border-dark)] hover:border-[var(--neon)] hover:shadow-[0_0_40px_var(--neon-glow)] transition-all duration-300 flex-1 min-w-[240px]"
          >
            <platform.icon className="w-8 h-8 text-[var(--text-dim)] group-hover:text-[var(--neon)] transition-colors duration-300" />
            <div className="flex flex-col items-center gap-1">
              <span className="text-lg font-semibold text-[var(--text-white)]">
                {platform.label}
              </span>
              <span className="text-sm text-[var(--text-muted)]">
                {platform.subtitle}
              </span>
            </div>
            <span className="font-mono text-xs text-[var(--text-ghost)]">
              {platform.chip} &middot; {platform.size}
            </span>
            <div className="flex items-center gap-2 px-5 py-2.5 rounded-lg btn-neon text-sm group-hover:scale-105 transition-transform duration-300">
              <Download className="w-4 h-4" />
              Download
            </div>
          </a>
        ))}
      </div>

      {platforms.length === 0 && (
        <a
          href="https://github.com/ivg-design/rive-animation-viewer/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-7 py-3.5 rounded-xl btn-neon text-[15px] hover:scale-105 transition-all duration-300"
        >
          <Download className="w-5 h-5" />
          Browse Releases on GitHub
        </a>
      )}

      {/* GitHub link */}
      <a
        href="https://github.com/ivg-design/rive-animation-viewer/releases"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--neon)] transition-colors duration-300"
      >
        <ExternalLink className="w-4 h-4" />
        Or browse all releases on GitHub
      </a>
    </section>
  );
}
