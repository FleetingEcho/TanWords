import { useT } from "@/hooks/useT";
import { coverGradient } from "@/features/music/cover";
import { Button } from "@/components/ui/button";
import { ChevronIcon, PlayIcon } from "@/components/ui/icons";
import { MusicCollection } from "./types";
import { startQueue } from "./musicLib";
import { TrackRows } from "./TrackRows";

export function CollectionView({
  collection,
  displayName,
  onBack,
}: {
  collection: MusicCollection;
  displayName: string;
  onBack: () => void;
}) {
  const t = useT();
  const cover = coverGradient(displayName);

  return (
    <div className="h-full overflow-y-auto animate-fade-in">
      {/* Gradient hero banner — the collection's cover, stretched wide */}
      <div className="relative px-8 pt-8 pb-10" style={{ backgroundImage: cover.css }}>
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
        <div className="relative max-w-4xl mx-auto">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-8 px-2 -ml-2 mb-8 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1"
          >
            <ChevronIcon direction="left" className="w-3.5 h-3.5" />
            {t("music.back")}
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-sm">{displayName}</h1>
          <p className="text-sm text-white/80 mt-1 mb-6">
            {t("music.tracksCount", { count: String(collection.tracks.length) })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => startQueue(collection, displayName, 0)}
              className="h-9 px-5 rounded-full text-sm font-semibold bg-white text-black hover:bg-white/90 transition-colors flex items-center gap-2"
            >
              <PlayIcon className="w-4 h-4" />
              {t("music.playAll")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => startQueue(collection, displayName, Math.floor(Math.random() * collection.tracks.length), true)}
              className="h-9 px-5 rounded-full text-sm font-medium text-white bg-white/15 hover:bg-white/25 transition-colors"
            >
              {t("music.shuffle")}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 pt-6 pb-28">
        <TrackRows collection={collection} displayName={displayName} />
      </div>
    </div>
  );
}
