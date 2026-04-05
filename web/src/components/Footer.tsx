"use client";

import Image from "next/image";
import Link from "next/link";
import { asset } from "@/lib/config";

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

export default function Footer() {
  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "Screenshots", href: "#screenshots" },
        { label: "Downloads", href: "#downloads" },
        { label: "Changelog", href: "/changelog" },
        { label: "Documentation", href: "/docs" },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "GitHub Repository", href: "https://github.com/ivg-design/rive-animation-viewer", external: true },
        { label: "Report an Issue", href: "https://github.com/ivg-design/rive-animation-viewer/issues", external: true },
        { label: "Rive Community", href: "https://rive.app/community", external: true },
      ],
    },
    {
      title: "IVG Design",
      links: [
        { label: "Forge Hub", href: "https://forge.mograph.life", external: true },
        { label: "RWPP", href: "https://forge.mograph.life/apps/rwpp/", external: true },
      ],
    },
  ];

  return (
    <footer className="flex flex-col gap-8 py-12 px-8 md:px-20 bg-[var(--bg-zinc)] border-t border-[var(--border-dark)] w-full">
      <div className="flex flex-col md:flex-row justify-between gap-12 w-full max-w-[1100px] mx-auto">
        {/* Logo */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <Image
              src={asset("/images/app-icon.png")}
              alt="RAV Logo"
              width={28}
              height={28}
              className="rounded-lg"
            />
            <span className="font-mono text-base font-bold tracking-wider text-[var(--text-white)]">
              RAV
            </span>
          </div>
          <span className="text-sm text-[var(--text-muted)]">
            Rive Animation Viewer
          </span>
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-12 md:gap-16">
          {columns.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <span className="text-[13px] font-semibold text-[var(--text-white)]">
                {column.title}
              </span>
              {column.links.map((link) =>
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors"
                  >
                    {link.label}
                  </a>
                ) : link.href.startsWith("/") ? (
                  <Link
                    key={link.label}
                    href={asset(link.href)}
                    className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors"
                  >
                    {link.label}
                  </Link>
                ) : (
                  <a
                    key={link.label}
                    href={link.href}
                    className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors"
                  >
                    {link.label}
                  </a>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="w-full max-w-[1100px] mx-auto h-px bg-[var(--border-dark)]" />

      <div className="flex items-center justify-center w-full">
        <span className="text-xs text-[var(--text-ghost)]">
          &copy; {new Date().getFullYear()} IVG Design. MIT License.
        </span>
      </div>
    </footer>
  );
}
