import Link from "next/link";
import { asset } from "@/lib/config";
import { parseChangelog } from "@/lib/changelog";
import { ChevronRight, Sparkles, Bug, Wrench } from "lucide-react";

function CategoryBullets({ icon: Icon, title, items, color }: {
  icon: typeof Sparkles;
  title: string;
  items: string[];
  color: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{title}</span>
      </div>
      <ul className="flex flex-col gap-1 pl-5">
        {items.slice(0, 4).map((item, i) => (
          <li key={i} className="text-sm text-[var(--text-dim)] list-disc">
            {item}
          </li>
        ))}
        {items.length > 4 && (
          <li className="text-xs text-[var(--text-ghost)]">
            +{items.length - 4} more
          </li>
        )}
      </ul>
    </div>
  );
}

export default function ChangelogPreview() {
  const entries = parseChangelog();
  const recent = entries.slice(0, 3);

  if (recent.length === 0) {
    return null;
  }

  return (
    <section id="changelog" className="flex flex-col items-center gap-12 py-24 px-8 w-full">
      <div className="flex flex-col items-center gap-4">
        <span className="font-mono text-xs font-medium tracking-[3px] uppercase text-[var(--neon)]">
          Changelog
        </span>
        <h2 className="font-sans font-bold text-4xl text-[var(--text-white)]">
          Recent updates
        </h2>
      </div>

      <div className="flex flex-col gap-6 max-w-[700px] w-full">
        {recent.map((entry, index) => (
          <div
            key={entry.version}
            className="relative pl-8 border-l border-[var(--border-dark)]"
          >
            {/* Timeline dot */}
            <div className={`absolute left-0 -translate-x-1/2 w-3 h-3 rounded-full border-[3px] border-[var(--bg-void)] ${
              index === 0 ? 'bg-[var(--neon)]' : 'bg-[var(--border-light)]'
            }`} />

            <div className="flex flex-col gap-3 pb-8">
              <div className="flex items-center gap-3">
                <h3 className="font-mono text-lg font-bold text-[var(--text-white)]">
                  v{entry.version}
                </h3>
                {index === 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-[var(--neon-dim)] text-[var(--neon)]">
                    LATEST
                  </span>
                )}
              </div>
              <span className="text-xs text-[var(--text-ghost)]">
                {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>

              <div className="flex flex-col gap-4 p-5 rounded-xl bg-[var(--bg-zinc)] border border-[var(--border-dark)]">
                <CategoryBullets icon={Sparkles} title="Added" items={entry.added} color="text-green-400" />
                <CategoryBullets icon={Wrench} title="Changed" items={entry.changed} color="text-amber-400" />
                <CategoryBullets icon={Bug} title="Fixed" items={entry.fixed} color="text-blue-400" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Link
        href={asset("/changelog")}
        className="flex items-center gap-2 text-sm font-medium text-[var(--neon)] hover:underline"
      >
        View full changelog ({entries.length} releases)
        <ChevronRight className="w-4 h-4" />
      </Link>
    </section>
  );
}
