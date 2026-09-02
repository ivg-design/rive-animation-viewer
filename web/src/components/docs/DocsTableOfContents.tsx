"use client";

import { useEffect, useState } from "react";

type Heading = { id: string; title: string; level: number };

export default function DocsTableOfContents() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const content = document.getElementById("docs-content");
    if (!content) return;
    let elements: HTMLElement[] = [];
    let frame = 0;
    let initialHashHandled = false;

    const updateActive = () => {
      const current = elements.filter((heading) => heading.getBoundingClientRect().top <= 128).at(-1);
      setActiveId(current?.id ?? "");
    };
    const readHeadings = () => {
      const ids = new Set<string>();
      elements = Array.from(content.querySelectorAll<HTMLElement>("h2, h3"));
      const items = elements.map((heading, index) => {
        const title = heading.textContent?.trim() ?? "";
        const base = heading.id || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `section-${index + 1}`;
        let id = base;
        let suffix = 2;
        while (ids.has(id)) id = `${base}-${suffix++}`;
        ids.add(id);
        heading.id = id;
        return { id, title, level: Number(heading.tagName.slice(1)) };
      });
      setHeadings(items);
      if (!initialHashHandled && elements.length) {
        initialHashHandled = true;
        const target = elements.find((heading) => `#${heading.id}` === window.location.hash);
        target?.scrollIntoView();
      }
      updateActive();
    };
    const scheduleActive = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActive);
    };
    // Navigation can stream the article after the surrounding layout mounts.
    const observer = new MutationObserver(readHeadings);
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    const initialFrame = requestAnimationFrame(readHeadings);
    window.addEventListener("scroll", scheduleActive, { passive: true });
    window.addEventListener("resize", scheduleActive);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(initialFrame);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleActive);
      window.removeEventListener("resize", scheduleActive);
    };
  }, []);

  return (
    <aside className="docs-toc" aria-label="On this page">
      {headings.length > 0 && <>
        <h2>On this page</h2>
        <nav aria-label="Page sections">
          {headings.map((heading) => (
            <a key={heading.id} href={`#${heading.id}`} className={heading.level === 3 ? "docs-toc-subsection" : undefined} aria-current={activeId === heading.id ? "location" : undefined}>
              {heading.title}
            </a>
          ))}
        </nav>
      </>}
    </aside>
  );
}
