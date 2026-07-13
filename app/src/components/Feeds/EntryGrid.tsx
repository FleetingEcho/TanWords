import React from "react";
import { useT } from "@/hooks/useT";
import type { RssEntryRow, RssFeed } from "@/hooks/useDB.types";
import { EntryCard } from "./EntryCard";
import { dateGroupOf, type DateGroup } from "./feedUtils";

interface Props {
  entries: RssEntryRow[];
  feedsById: Map<number, RssFeed>;
  /** Entry id currently being fetched for one-click learn, if any. */
  learningId: number | null;
  onOpen: (entry: RssEntryRow) => void;
  onLearn: (entry: RssEntryRow) => void;
  /** Podcast playback — only wired onto cards whose entry has an audio_url. */
  onPlay: (entry: RssEntryRow) => void;
}

const GROUP_ORDER: DateGroup[] = ["today", "yesterday", "thisWeek", "earlier"];

function GroupHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Magazine flow: date-grouped sections; the very first entry renders as a hero card. */
export function EntryGrid({ entries, feedsById, learningId, onOpen, onLearn, onPlay }: Props) {
  const t = useT();

  const groups = new Map<DateGroup, RssEntryRow[]>();
  for (const e of entries) {
    const g = dateGroupOf(e.published);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(e);
  }

  const heroId = entries[0]?.id;
  const labels: Record<DateGroup, string> = {
    today: t("feeds.group.today"),
    yesterday: t("feeds.group.yesterday"),
    thisWeek: t("feeds.group.thisWeek"),
    earlier: t("feeds.group.earlier"),
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-5 space-y-4">
      {GROUP_ORDER.filter((g) => groups.has(g)).map((g) => {
        const items = groups.get(g)!;
        const hero = items.find((e) => e.id === heroId);
        const rest = items.filter((e) => e.id !== heroId);
        return (
          <section key={g} className="space-y-3">
            <GroupHeader label={labels[g]} />
            {hero && (
              <EntryCard
                entry={hero}
                feedTitle={feedsById.get(hero.feed_id)?.title ?? ""}
                hero
                learning={learningId === hero.id}
                onOpen={() => onOpen(hero)}
                onLearn={() => onLearn(hero)}
                onPlay={hero.audio_url ? () => onPlay(hero) : undefined}
              />
            )}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {rest.map((e) => (
                  <EntryCard
                    key={e.id}
                    entry={e}
                    feedTitle={feedsById.get(e.feed_id)?.title ?? ""}
                    learning={learningId === e.id}
                    onOpen={() => onOpen(e)}
                    onLearn={() => onLearn(e)}
                    onPlay={e.audio_url ? () => onPlay(e) : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
