import React, { useCallback, useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { usePodcastPlayerStore, PodcastTrack } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { coverGradient } from "@/features/music/cover";
import { Button } from "@/components/ui/button";
import { MusicIcon, PlayIcon, PauseIcon, RefreshIcon, ChevronIcon, GridIcon, ListIcon, FolderIcon, SearchIcon } from "@/components/ui/icons";

interface MusicTrack {
  path: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
}

interface MusicCollection {
  name: string;
  tracks: MusicTrack[];
}

type ViewMode = "cards" | "list";

function probeAudioDuration(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      audio.removeAttribute("src");
      audio.load();
      resolve(duration);
    };
    const timeout = window.setTimeout(() => finish(null), 10_000);

    audio.preload = "metadata";
    audio.addEventListener(
      "loadedmetadata",
      () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null),
      { once: true }
    );
    audio.addEventListener("error", () => finish(null), { once: true });
    audio.src = convertFileSrc(path);
  });
}

async function fillMissingDurations(collections: MusicCollection[]): Promise<MusicCollection[]> {
  const result = collections.map((collection) => ({
    ...collection,
    tracks: collection.tracks.map((track) => ({ ...track })),
  }));
  const missing = result.flatMap((collection) =>
    collection.tracks
      .map((track) => ({ track }))
      .filter(({ track }) => track.durationSec === null || !Number.isFinite(track.durationSec) || track.durationSec <= 0)
  );
  let next = 0;

  // Loading metadata still opens each media file, so keep the fallback modest
  // for large libraries instead of asking the OS to inspect everything at once.
  const workers = Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (next < missing.length) {
      const { track } = missing[next++];
      const duration = await probeAudioDuration(track.path);
      if (duration !== null) track.durationSec = duration;
    }
  });
  await Promise.all(workers);
  return result;
}

function formatDuration(sec: number | null): string {
  if (sec === null || !isFinite(sec) || sec <= 0) return "—";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function toQueue(collection: MusicCollection, displayName: string): PodcastTrack[] {
  return collection.tracks.map((tr) => ({
    audioUrl: convertFileSrc(tr.path),
    title: tr.title,
    feedTitle: displayName,
  }));
}

function startQueue(collection: MusicCollection, displayName: string, index: number, shuffle = false) {
  usePlayerOriginStore.getState().setOrigin({ kind: "music" });
  usePodcastPlayerStore.getState().playQueue(toQueue(collection, displayName), index, shuffle ? "shuffle" : undefined);
}

async function pickMusicFolder() {
  const picked = await openDialog({ directory: true, multiple: false });
  if (typeof picked === "string") useSettingsStore.getState().setMusicFolderPath(picked);
}

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

function CollectionCard({
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

/** List mode: every collection is a collapsible section of track rows —
 * header toggles the fold, everything is one scroll. */
function CollectionListSection({
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

function CollectionView({
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

function TrackRows({
  collection,
  displayName,
  compact = false,
  indices,
}: {
  collection: MusicCollection;
  displayName: string;
  compact?: boolean;
  /** Original track indices to render (search results); defaults to all.
   * Rows keep their original numbering and start the full-collection queue. */
  indices?: number[];
}) {
  const t = useT();
  const currentUrl = usePodcastPlayerStore((s) => s.track?.audioUrl);
  const status = usePodcastPlayerStore((s) => s.status);
  const toggle = usePodcastPlayerStore((s) => s.toggle);

  const shown = indices ? indices.map((i) => ({ tr: collection.tracks[i], i })) : collection.tracks.map((tr, i) => ({ tr, i }));
  const isPlaying = status === "playing" || status === "loading";

  return (
    <>
      {shown.map(({ tr, i }) => {
        const isCurrent = currentUrl === convertFileSrc(tr.path) && status !== "idle";
        return (
          <button
            key={tr.path}
            // The current row toggles pause/resume; restarting from 0:00 on a
            // click here is never what anyone wants.
            onClick={() => (isCurrent ? toggle() : startQueue(collection, displayName, i))}
            className={`w-full flex items-center gap-4 px-4 rounded-xl text-left transition-colors group ${
              compact ? "py-1.5" : "py-2.5"
            } ${isCurrent ? "bg-primary/10" : "hover:bg-muted"}`}
          >
            <span className={`w-6 text-xs font-mono tabular-nums shrink-0 ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>
              {isCurrent ? (
                <span className="inline-flex items-end gap-[2px] h-3" aria-label={t("music.nowPlaying")}>
                  {[
                    { height: "60%" },
                    { height: "100%", animationDelay: "150ms" },
                    { height: "40%", animationDelay: "300ms" },
                  ].map((style, b) => (
                    <span
                      key={b}
                      className="w-[3px] bg-primary animate-pulse"
                      style={{ ...style, animationPlayState: isPlaying ? "running" : "paused" }}
                    />
                  ))}
                </span>
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block text-sm truncate ${isCurrent ? "font-semibold text-primary" : "font-medium"}`}>
                {tr.title}
              </span>
              {!compact && tr.artist && <span className="block text-xs text-muted-foreground truncate">{tr.artist}</span>}
            </span>
            {isCurrent ? (
              isPlaying ? (
                <PauseIcon className="w-4 h-4 text-primary shrink-0" />
              ) : (
                <PlayIcon className="w-4 h-4 text-primary shrink-0" />
              )
            ) : (
              <PlayIcon className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
            <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
              {formatDuration(tr.durationSec)}
            </span>
          </button>
        );
      })}
    </>
  );
}
