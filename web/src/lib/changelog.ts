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
  removed: string[];
  documentation: string[];
  knownLimits: string[];
}

type SectionKey = 'added' | 'changed' | 'performance' | 'fixed' | 'validation' | 'removed' | 'documentation' | 'knownLimits';

const SECTION_KEYS: Record<string, SectionKey> = {
  Added: 'added',
  Changed: 'changed',
  Performance: 'performance',
  Fixed: 'fixed',
  Validation: 'validation',
  Removed: 'removed',
  Documentation: 'documentation',
  'Known limits': 'knownLimits',
};

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
  let currentSection: SectionKey | null = null;

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
        removed: [],
        documentation: [],
        knownLimits: [],
      };
      currentSection = null;
      continue;
    }

    if (!current) continue;

    const sectionMatch = line.match(/^### (.+?)\s*$/);
    if (sectionMatch && SECTION_KEYS[sectionMatch[1]]) {
      currentSection = SECTION_KEYS[sectionMatch[1]];
      continue;
    }

    if (line.startsWith('### ')) {
      currentSection = null;
      continue;
    }

    if (currentSection && line.match(/^- /)) {
      const item = cleanItem(line.replace(/^- /, ''));
      if (item) {
        current[currentSection].push(item);
      }
      continue;
    }

    // Bullets are hard-wrapped at 80 columns in CHANGELOG.md; an indented
    // non-empty line continues the previous bullet.
    if (currentSection && /^\s+\S/.test(line) && current[currentSection].length) {
      const items = current[currentSection];
      const nested = line.match(/^\s+- (.*)$/);
      const text = nested ? `\u2022 ${cleanItem(nested[1])}` : cleanItem(line);
      items[items.length - 1] = `${items[items.length - 1]} ${text}`;
    }
  }

  if (current) entries.push(current);
  return entries;
}

function cleanItem(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
}
