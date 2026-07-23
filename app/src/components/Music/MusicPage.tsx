import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { coverGradient } from "@/features/music/cover";
import { Button } from "@/components/ui/button";
import { MusicIcon, RefreshIcon, GridIcon, ListIcon, FolderIcon, SearchIcon } from "@/components/ui/icons";
import { MusicCollection, ViewMode } from "./types";
import { fillMissingDurations, pickMusicFolder } from "./musicLib";
import { TrackRows } from "./TrackRows";
import { CollectionCard } from "./CollectionCard";
import { CollectionListSection } from "./CollectionListSection";
import { CollectionView } from "./CollectionView";

export default function MusicPage() {
  const t = useT();
  const musicFolderPath = useSettingsStore((s) => s.musicFolderPath);
  const isLoaded = useSettingsStore((s) => s.isLoaded);

  const [collections, setCollections] = useState<MusicCollection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openName, setOpenName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("tanwords_music_view") as ViewMode) || "cards"
  );

  const switchView = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("tanwords_music_view", mode);
  };

  const scan = useCallback(async () => {
    if (!musicFolderPath) return;
    setLoading(true);
    setError(null);
    try {
      const scanned = await invoke<MusicCollection[]>("music_scan_library", { root: musicFolderPath });
      setCollections(scanned);
      setCollections(await fillMissingDurations(scanned));
    } catch (e) {
      setCollections(null);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [musicFolderPath]);

  useEffect(() => {
    if (isLoaded) scan();
  }, [isLoaded, scan]);

  if (!isLoaded) return null;

  if (!musicFolderPath) {
    return (
      <div className="h-full flex items-center justify-center animate-fade-in">
        <div className="text-center max-w-sm px-6">
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-primary/10 flex items-center justify-center">
            <MusicIcon className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-lg font-semibold mb-2">{t("music.emptyTitle")}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">{t("music.emptyBody")}</p>
          <Button
            onClick={pickMusicFolder}
            className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("music.setFolder")}
          </Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center animate-fade-in">
        <div className="text-center max-w-md px-6">
          <h2 className="text-lg font-semibold mb-2">{t("music.scanErrorTitle")}</h2>
          <p className="text-xs font-mono text-muted-foreground break-all mb-6">{error}</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={scan} className="h-9 px-4 rounded-lg text-sm border border-input hover:bg-muted">
              {t("music.refresh")}
            </Button>
            <Button
              onClick={pickMusicFolder}
              className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {t("music.changeFolder")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const open = collections?.find((c) => c.name === openName);
  if (open) {
    return (
      <CollectionView
        collection={open}
        onBack={() => setOpenName(null)}
        displayName={open.name || t("music.uncategorized")}
      />
    );
  }

  const totalTracks = collections?.reduce((n, c) => n + c.tracks.length, 0) ?? 0;

  // A non-empty query flattens both view modes into one result list: a match
  // keeps a track if its title/artist — or its whole collection's name — hits.
  const q = query.trim().toLowerCase();
  const results = q
    ? (collections ?? [])
        .map((c) => {
          const displayName = c.name || t("music.uncategorized");
          const wholeCollection = displayName.toLowerCase().includes(q);
          return {
            collection: c,
            displayName,
            indices: c.tracks
              .map((tr, i) => ({ tr, i }))
              .filter(
                ({ tr }) =>
                  wholeCollection ||
                  tr.title.toLowerCase().includes(q) ||
                  (tr.artist ?? "").toLowerCase().includes(q)
              )
              .map(({ i }) => i),
          };
        })
        .filter((r) => r.indices.length > 0)
    : null;

  return (
    <div className="h-full overflow-y-auto animate-fade-in">
      {/* pb clears the fixed bottom player bar so the last row's labels stay visible */}
      <div className="max-w-5xl mx-auto px-8 pt-10 pb-28">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t("music.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("music.stats", { tracks: String(totalTracks), collections: String(collections?.length ?? 0) })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg">
              {(
                [
                  { id: "cards", icon: GridIcon, label: t("music.viewCards") },
                  { id: "list", icon: ListIcon, label: t("music.viewList") },
                ] as const
              ).map(({ id, icon: Icon, label }) => (
                <Button
                  key={id}
                  variant="ghost"
                  onClick={() => switchView(id)}
                  title={label}
                  className={`h-7 w-8 p-0 rounded-md flex items-center justify-center transition-colors ${
                    viewMode === id ? "bg-card shadow-sm text-foreground hover:bg-card" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              onClick={pickMusicFolder}
              title={musicFolderPath}
              className="h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <FolderIcon className="w-3.5 h-3.5" />
              {t("music.changeFolder")}
            </Button>
            <Button
              variant="ghost"
              onClick={scan}
              disabled={loading}
              className="h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <RefreshIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              {t("music.refresh")}
            </Button>
          </div>
        </div>

        <div className="relative mb-8">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("music.searchPlaceholder")}
            className="w-full h-10 pl-9 pr-4 rounded-xl border border-input bg-card text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

        {collections && collections.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("music.noTracks")}</p>
        )}

        {results ? (
          results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("music.noResults")}</p>
          ) : (
            <div className="space-y-6">
              {results.map(({ collection, displayName, indices }) => (
                <section key={collection.name}>
                  <div className="flex items-center gap-3 mb-1 px-1">
                    <span
                      className="w-6 h-6 rounded-md shrink-0 shadow-sm"
                      style={{ backgroundImage: coverGradient(displayName).css }}
                    />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{displayName}</span>
                  </div>
                  <TrackRows collection={collection} displayName={displayName} indices={indices} compact />
                </section>
              ))}
            </div>
          )
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {(collections ?? []).map((c) => (
              <CollectionCard
                key={c.name}
                collection={c}
                displayName={c.name || t("music.uncategorized")}
                onOpen={() => setOpenName(c.name)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {(collections ?? []).map((c) => (
              <CollectionListSection
                key={c.name}
                collection={c}
                displayName={c.name || t("music.uncategorized")}
                onOpen={() => setOpenName(c.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
