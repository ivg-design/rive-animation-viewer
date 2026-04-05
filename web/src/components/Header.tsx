"use client";

import Image from "next/image";
import Link from "next/link";
import { asset } from "@/lib/config";

export default function Header() {
  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    e.preventDefault();
    const element = document.getElementById(targetId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <header className="flex items-center justify-between px-8 md:px-20 py-4 bg-[var(--bg-void)]/90 w-full sticky top-0 z-40 backdrop-blur-sm border-b border-[var(--border-dark)] transition-all duration-300">
      {/* Logo */}
      <Link href={asset("/")} className="flex items-center gap-3">
        <Image
          src={asset("/images/app-icon.png")}
          alt="RAV Logo"
          width={40}
          height={40}
          className="rounded-xl transition-transform duration-300 hover:scale-105"
        />
        <span className="font-mono text-lg font-bold tracking-wider text-[var(--text-white)]">
          RAV - Rive Animation Viewer
        </span>
      </Link>

      {/* Navigation */}
      <nav className="hidden md:flex items-center gap-8">
        <a
          href="#features"
          onClick={(e) => handleNavClick(e, "features")}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors duration-300"
        >
          Features
        </a>
        <a
          href="#screenshots"
          onClick={(e) => handleNavClick(e, "screenshots")}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors duration-300"
        >
          Screenshots
        </a>
        <a
          href="#downloads"
          onClick={(e) => handleNavClick(e, "downloads")}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors duration-300"
        >
          Downloads
        </a>
        <Link
          href={asset("/changelog")}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors duration-300"
        >
          Changelog
        </Link>
        <Link
          href={asset("/docs")}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-white)] transition-colors duration-300"
        >
          Docs
        </Link>
      </nav>
    </header>
  );
}
