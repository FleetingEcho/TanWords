import React from "react";
import { useT } from "@/hooks/useT";
import { coverGradient } from "@/features/music/cover";
import { MusicIcon, PlayIcon } from "@/components/ui/icons";
import { MusicCollection } from "./types";
import { startQueue } from "./musicLib";

export function CollectionCard({
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

  const playAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    startQueue(collection, displayName, 0);
  };

  return (
    <button
      onClick={onOpen}
      className="group text-left rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className="relative aspect-square rounded-2xl shadow-sm overflow-hidden transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-lg"
        style={{ backgroundImage: cover.css }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
        <MusicIcon className="absolute bottom-3 left-3 w-5 h-5 text-white/60" />
        <span
          onClick={playAll}
          role="button"
          title={t("music.playAll")}
          className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-white/90 text-black flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 shadow-md hover:scale-105"
        >
          <PlayIcon className="w-5 h-5 ml-0.5" />
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold truncate">{displayName}</p>
      <p className="text-xs text-muted-foreground">{t("music.tracksCount", { count: String(collection.tracks.length) })}</p>
    </button>
  );
}
