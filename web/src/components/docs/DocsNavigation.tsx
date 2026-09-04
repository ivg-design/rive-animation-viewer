"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { asset } from "@/lib/config";

type DocsPage = { id: string; title: string; keywords?: string };

export const docsGroups: { title: string; pages: DocsPage[] }[] = [
  { title: "Getting started", pages: [
    { id: "getting-started", title: "Installation & First Launch" },
    { id: "opening-files", title: "Opening Files" },
    { id: "ui-layout", title: "UI Layout" },
  ] },
  { title: "Playback & controls", pages: [
    { id: "viewmodel-controls", title: "ViewModel Controls", keywords: "global root vm gvm properties inputs" },
    { id: "artboard-switcher", title: "Artboard Switcher" },
  ] },
  { title: "Build & debug", pages: [
    { id: "script-editor", title: "Script Editor" },
    { id: "consoles", title: "Consoles" },
    { id: "media-export", title: "Media Export & Recording", keywords: "video h264 h265 webm apng gif png jpg webp timeline state machine recording" },
    { id: "export", title: "Export + Snippets" },
  ] },
  { title: "Reference", pages: [
    { id: "configuration", title: "Configuration" },
    { id: "mcp", title: "MCP Integration", keywords: "global vm gvm tools capture screenshot claude codex" },
    { id: "updates", title: "Auto Updates" },
    { id: "shortcuts", title: "Keyboard Shortcuts" },
    { id: "troubleshooting", title: "Troubleshooting" },
  ] },
];

export const docsSections = docsGroups.flatMap((group) => group.pages);

export default function DocsNavigation({ currentId }: { currentId: string }) {
  const [query, setQuery] = useState("");
  const router = useRouter();
  const search = query.trim().toLowerCase();
  const groups = docsGroups.map((group) => ({
    ...group,
    pages: group.pages.filter((page) => `${group.title} ${page.title} ${page.keywords ?? ""}`.toLowerCase().includes(search)),
  })).filter((group) => group.pages.length > 0);

  return (
    <>
      <aside className="docs-rail" aria-label="Documentation pages">
        <label className="docs-filter">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Filter documentation pages</span>
          <input type="search" placeholder="Filter pages…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <nav aria-label="Documentation topics">
          <Link href={asset("/docs")} className="docs-nav-page" aria-current={!currentId ? "page" : undefined}>Overview</Link>
          {groups.map((group) => (
            <section key={group.title} className="docs-nav-group">
              <h2>{group.title}</h2>
              {group.pages.map((page) => (
                <Link key={page.id} href={asset(`/docs/${page.id}`)} className="docs-nav-page" aria-current={currentId === page.id ? "page" : undefined}>
                  {page.title}
                </Link>
              ))}
            </section>
          ))}
          {groups.length === 0 && <p className="docs-nav-empty" role="status">No matching pages.</p>}
        </nav>
      </aside>
      <label className="docs-mobile-picker">
        Documentation
        <select value={currentId} onChange={(event) => router.push(asset(event.target.value ? `/docs/${event.target.value}` : "/docs"))}>
          <option value="">Overview</option>
          {docsGroups.map((group) => (
            <optgroup key={group.title} label={group.title}>
              {group.pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
    </>
  );
}
