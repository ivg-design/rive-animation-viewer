"use client";

import { useState } from "react";
import Link from "next/link";
import { asset } from "@/lib/config";
import { Menu, X } from "lucide-react";
import ResponsiveImage from "./ResponsiveImage";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Interface", href: "#screenshots" },
  { label: "Download", href: "#downloads" },
  { label: "Changelog", href: "/changelog", internal: true },
  { label: "Docs", href: "/docs", internal: true },
];

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const scrollTo = (id: string) => {
    setMobileOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      history.replaceState(null, "", `#${id}`);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--border-dark)] bg-[var(--bg-void)]/80 backdrop-blur-md">
      <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <Link href={asset("/")} className="flex items-center gap-2.5">
          <ResponsiveImage
            image="appIcon"
            alt=""
            width={32}
            height={32}
            sizes="32px"
            className="rounded-lg"
          />
          <span className="font-mono text-sm font-bold tracking-wider text-[var(--text-white)]">
            RAV
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) =>
            link.internal ? (
              <Link key={link.label} href={asset(link.href)} className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors">
                {link.label}
              </Link>
            ) : (
              <button key={link.label} onClick={() => scrollTo(link.href.slice(1))} className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors">
                {link.label}
              </button>
            )
          )}
        </nav>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-white)] hover:bg-[var(--bg-elevated)] transition-colors"
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <nav id="mobile-navigation" className="md:hidden border-t border-[var(--border-dark)] bg-[var(--bg-void)] px-6 py-4 flex flex-col gap-3">
          {navLinks.map((link) =>
            link.internal ? (
              <Link key={link.label} href={asset(link.href)} onClick={() => setMobileOpen(false)} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] py-1.5 transition-colors">
                {link.label}
              </Link>
            ) : (
              <button key={link.label} onClick={() => scrollTo(link.href.slice(1))} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] py-1.5 text-left transition-colors">
                {link.label}
              </button>
            )
          )}
        </nav>
      )}
    </header>
  );
}
