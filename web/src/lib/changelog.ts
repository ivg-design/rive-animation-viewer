import { readFileSync } from 'fs';
import { join } from 'path';

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  performance: string[];
  fixed: string[];
  validation: string[];
}

export function parseChangelog(): ChangelogEntry[] {
  // The website package always builds from web/. Keep this path statically
  // scoped so Turbopack traces only the website changelog into server output.
  let content: string;
  try {
    content = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf-8');
  } catch {
    return [];
  }

  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let currentSection: 'added' | 'changed' | 'performance' | 'fixed' | 'validation' | null = null;

  for (const line of content.split('\n')) {
    const versionMatch = line.match(/^## \[(.+?)\] - (Unreleased|\d{4}-\d{2}-\d{2})/);
    if (versionMatch) {
      if (current) entries.push(current);
      current = {
        version: versionMatch[1],
        date: versionMatch[2],
        added: [],
        changed: [],
        performance: [],
        fixed: [],
        validation: [],
      };
      currentSection = null;
      continue;
    }

    if (!current) continue;

    const sectionMatch = line.match(/^### (Added|Changed|Performance|Fixed|Validation)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase() as 'added' | 'changed' | 'performance' | 'fixed' | 'validation';
      continue;
    }

    if (line.startsWith('### ')) {
      currentSection = null;
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
