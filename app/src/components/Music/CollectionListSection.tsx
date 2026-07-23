import { useState } from "react";
import { useT } from "@/hooks/useT";
import { coverGradient } from "@/features/music/cover";
import { Button } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ui/icons";
import { MusicCollection } from "./types";
import { TrackRows } from "./TrackRows";

/** List mode: every collection is a collapsible section of track rows —
 * header toggles the fold, everything is one scroll. */
export function CollectionListSection({
  collection,
  displayName,
  onOpen,
}: {
  collection: MusicCollection;
  displayName: string;
  onOpen: () => void;
}) {
  const t = useT();
  const cover = coverGradient(displayName);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section>
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left group"
          aria-expanded={!collapsed}
        >
          <ChevronIcon
            direction="right"
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          />
          <span className="w-8 h-8 rounded-lg shrink-0 shadow-sm" style={{ backgroundImage: cover.css }} />
          <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{displayName}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {t("music.tracksCount", { count: String(collection.tracks.length) })}
          </span>
        </button>
        <Button
          variant="ghost"
          onClick={onOpen}
          title={displayName}
          className="h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <ChevronIcon direction="right" className="w-3.5 h-3.5" />
        </Button>
      </div>
      {!collapsed && <TrackRows collection={collection} displayName={displayName} compact />}
    </section>
  );
}
