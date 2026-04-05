import { readFileSync } from 'fs';
import { join } from 'path';

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

export function parseChangelog(): ChangelogEntry[] {
  // Try web dir first (Vercel build), then parent dir (local dev)
  const candidates = [
    join(process.cwd(), 'CHANGELOG.md'),
    join(process.cwd(), '..', 'CHANGELOG.md'),
  ];
  let content: string | null = null;

  for (const candidate of candidates) {
    try {
      content = readFileSync(candidate, 'utf-8');
      break;
    } catch {
      continue;
    }
  }

  if (!content) return [];

  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let currentSection: 'added' | 'changed' | 'fixed' | null = null;

  for (const line of content.split('\n')) {
    const versionMatch = line.match(/^## \[(.+?)\] - (\d{4}-\d{2}-\d{2})/);
    if (versionMatch) {
      if (current) entries.push(current);
      current = {
        version: versionMatch[1],
        date: versionMatch[2],
        added: [],
        changed: [],
        fixed: [],
      };
      currentSection = null;
      continue;
    }

    if (!current) continue;

    const sectionMatch = line.match(/^### (Added|Changed|Fixed)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase() as 'added' | 'changed' | 'fixed';
      continue;
    }

    if (currentSection && line.match(/^- /)) {
      const item = line.replace(/^- /, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
      if (item) {
        current[currentSection].push(item);
      }
    }
  }

  if (current) entries.push(current);
  return entries;
}
