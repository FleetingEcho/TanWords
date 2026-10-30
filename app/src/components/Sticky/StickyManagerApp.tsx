/** The floating sticky manager (`sticky-manager.html`, 380×620, frameless
 *  transparent) — the "便签墙" hub:
 *
 *  - 40px drag-strip header: title + live visible-count, [+] template
 *    popover, [More ⋯] (show/hide all, bundle/text import, bundle export,
 *    quick help), [X] closes the window;
 *  - segmented tabs: Wall (default, all notes incl. open) / Open (is_open)
 *    / Trash with a count badge (lazily loads `sticky_trash_list` on first
 *    visit);
 *  - pill search below the header (150ms debounce → `sticky_search`, FTS;
 *    the trash list filters in-memory; Esc clears + blurs);
 *  - switchable card grid / compact list of pastel notes — click focuses/opens the note
 *    (`stickywin_focus` vs `stickywin_open` + `sticky_update_window_state`),
 *    hover "⋯" or right-click opens a context menu (open / export md+html /
 *    move to trash — the last behind a ConfirmModal).
 *
 *  This window never edits note content — that's the per-note window's job.
 *  Theme-compat approach preserved from the previous design: the shell adapts
 *  to the app theme (via `dark:` variants where the old file used theme
 *  tokens), while the pastel cards keep dark text on paper in both themes,
 *  same as the note windows themselves. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowUpToLine, ChevronDown, CircleHelp, Ellipsis, Eye,
  FileDown, FileUp, LayoutGrid, List, Loader2, Plus, RotateCcw, Search, Trash2, X,
} from "lucide-react";
import { invoke } from "@/ipc/backend";
import { callMain } from "@/ipc/host";
import { subscribeAll } from "@/ipc/events";
import { saveDialog } from "@/ipc/dialog";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { blocksToStorage } from "@/lib/docFormat";
import {
  blocksToMarkdownOffThread, markdownToBlocksOffThread,
} from "@/lib/documentWorkerClient";
import { exportMarkdownAsHtml } from "@/lib/documentExport";
import { lowerMermaid } from "@/components/Documents/mermaidTransforms";
import { lowerMedia, lowerYouTube } from "@/components/Documents/mediaTransforms";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  stickyColorHex, stickyDerivedTitle, useDismissOnOutsideClick,
  type StickyDetail, type StickyListItem,
} from "./stickyShared";
import { STICKY_TEMPLATES } from "./stickyTemplates";
import { StickyManagerCard } from "./StickyManagerCard";
import type { Block } from "@/components/Documents/tiptap/blocks";

/** Snake_case mirror of the core's trash `StickyListItem` (no serde rename). */
interface StickyTrashItem {
  id: number;
  title: string;
  preview: string;
  deleted_at: string;
}

type Bounds = { x: number; y: number; width: number; height: number };
type Tab = "wall" | "opened" | "trash";
type ViewMode = "card" | "list";
const VIEW_MODE_KEY = "sticky-manager-view-mode";

function savedViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

function parseBlocks(content: string): Block[] {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}

const SEARCH_DEBOUNCE_MS = 150;
const HEADER_BUTTON =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50";
const MENU_ROW =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-black/[0.06] dark:hover:bg-white/10";

export function StickyManagerApp() {
  const t = useT();

  const [tab, setTab] = useState<Tab>("wall");
  const [viewMode, setViewMode] = useState<ViewMode>(savedViewMode);
  const [items, setItems] = useState<StickyListItem[] | null>(null);
  const [trash, setTrash] = useState<StickyTrashItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  /** Card context menu, rendered at window level (fixed) so the scrollable
   *  grid's overflow never clips it. */
  const [menuFor, setMenuFor] = useState<{ item: StickyListItem; x: number; y: number } | null>(null);
  const [menuExportOpen, setMenuExportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StickyListItem | null>(null);
  const [pendingPurge, setPendingPurge] = useState<StickyTrashItem | null>(null);
  // Popovers dismiss on any outside pointer press (2026-09 user report).
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const templatesRef = useRef<HTMLDivElement | null>(null);
  const cardMenuRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideClick(moreMenuRef, showMore, () => setShowMore(false));
  useDismissOnOutsideClick(templatesRef, showTemplates, () => setShowTemplates(false));
  useDismissOnOutsideClick(cardMenuRef, menuFor !== null, () => setMenuFor(null));
  const [busyId, setBusyId] = useState<number | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Trash loads lazily (first visit of the tab); after that, every reload
   *  keeps it honest too. */
  const trashLoaded = useRef(false);

  const reload = useCallback(async () => {
    try {
      const list = query.trim()
        ? await invoke<StickyListItem[]>("sticky_search", { query })
        : await invoke<StickyListItem[]>("sticky_list");
      setItems(list);
    } catch {
      setItems([]);
    }
    if (trashLoaded.current) {
      try {
        setTrash(await invoke<StickyTrashItem[]>("sticky_trash_list"));
      } catch {
        setTrash([]);
      }
    }
  }, [query]);

  useEffect(() => {
    void useSettingsStore.getState().loadFromDB();
  }, []);

  // Initial + search-debounced reload.
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => void reload(), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, [query, reload]);

  // Trash loads on first visit of the trash tab only.
  useEffect(() => {
    if (tab !== "trash" || trashLoaded.current) return;
    trashLoaded.current = true;
    void invoke<StickyTrashItem[]>("sticky_trash_list")
      .then(setTrash)
      .catch(() => setTrash([]));
  }, [tab]);

  // Keep the list honest while windows open/close/move.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), 400);
    };
    const stop = subscribeAll({
      "stickywin:closed": refresh,
      "stickywin:geometryChanged": refresh,
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [reload]);

  const openNote = useCallback(async (item: StickyListItem) => {
    setBusyId(item.id);
    try {
      if (item.is_open) {
        await invoke("stickywin_focus", { id: item.id });
        return;
      }
      const bounds: Bounds | null = item.x != null && item.y != null
        ? { x: item.x, y: item.y, width: item.w, height: item.h }
        : null;
      await invoke("stickywin_open", {
        id: item.id,
        bounds,
        alwaysOnTop: item.always_on_top,
        collapsed: item.collapsed,
        opacity: item.opacity,
      });
      await invoke("sticky_update_window_state", { id: item.id, is_open: true }).catch(() => {});
      void reload();
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const createNote = useCallback(async (blocks?: Block[]) => {
    setCreateBusy(true);
    try {
      const payload = blocks ? blocksToStorage(blocks) : null;
      // Flat wire shape — sticky_create returns the detail with top-level id.
      const created = await invoke<StickyDetail>("sticky_create", payload
        ? { content: payload.content, contentText: payload.contentText, wordCount: payload.wordCount }
        : {});
      await invoke("stickywin_open", {
        id: created.id,
        bounds: null, // cascade off the work area for a brand-new note
        alwaysOnTop: created.always_on_top,
        collapsed: false,
        opacity: created.opacity,
      });
      await invoke("sticky_update_window_state", { id: created.id, is_open: true }).catch(() => {});
      setQuery("");
      setTab("wall");
      void reload();
    } finally {
      setCreateBusy(false);
    }
  }, [reload]);

  // ── Data tools (tanNotes M4 parity, plan S3) ────────────────────────────
  const exportNote = useCallback(async (item: StickyListItem, format: "md" | "html") => {
    try {
      const detail = await invoke<StickyDetail>("sticky_get", { id: item.id });
      const portable = lowerYouTube(lowerMedia(lowerMermaid(parseBlocks(detail.content)))) as Block[];
      const markdown = await blocksToMarkdownOffThread(portable);
      if (format === "html") {
        // Reuses the Documents HTML pipeline: assets inlined, mermaid
        // rendered, Shiki highlighted, save dialog + write handled inside.
        await exportMarkdownAsHtml(item.title || "sticky", markdown);
        return;
      }
      const destination = await saveDialog({
        defaultPath: `${(item.title || "sticky").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 60)}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!destination) return;
      await callMain("file:write", { path: destination, data: markdown });
    } catch (error) {
      console.error("[sticky] export failed", error);
    }
  }, []);

  const exportBundle = useCallback(async () => {
    try {
      const notes = await invoke<unknown[]>("sticky_bundle_export");
      const destination = await saveDialog({
        defaultPath: "tanwords-stickies-bundle.json",
        filters: [{ name: "Sticky bundle", extensions: ["json"] }],
      });
      if (!destination) return;
      await callMain("file:write", {
        path: destination,
        data: JSON.stringify({ notes }, null, 2),
      });
    } catch (error) {
      console.error("[sticky] bundle export failed", error);
    }
  }, []);

  const importFile = useCallback(async (kind: "md" | "bundle") => {
    try {
      const picked = await callMain<{ fileName: string; content: string } | null>("stickywin_import_text", {
        filters: kind === "bundle"
          ? [{ name: "Sticky bundle", extensions: ["json"] }]
          : [{ name: "Markdown / Text", extensions: ["md", "markdown", "txt"] }],
      });
      if (!picked?.content) return;
      if (kind === "bundle") {
        const parsed = JSON.parse(picked.content) as { notes?: unknown[] };
        if (Array.isArray(parsed.notes) && parsed.notes.length) {
          const count = await invoke<number>("sticky_bundle_import", { notes: parsed.notes });
          console.info(`[sticky] imported ${count} notes`);
          void reload();
        }
        return;
      }
      const blocks = await markdownToBlocksOffThread(picked.content);
      const payload = blocksToStorage(blocks);
      const created = await invoke<StickyDetail>("sticky_create", {
        content: payload.content, contentText: payload.contentText, wordCount: payload.wordCount,
      });
      await invoke("stickywin_open", {
        id: created.id,
        bounds: null,
        alwaysOnTop: created.always_on_top,
        collapsed: false,
        opacity: created.opacity,
      });
      await invoke("sticky_update_window_state", { id: created.id, is_open: true }).catch(() => {});
      void reload();
    } catch (error) {
      console.error("[sticky] import failed", error);
    }
  }, [reload]);

  const trashNote = useCallback(async (item: StickyListItem) => {
    setBusyId(item.id);
    try {
      if (!await invoke<boolean>("stickywin_flush", { id: item.id })) return;
      await invoke("sticky_delete", { id: item.id });
      await invoke("stickywin_close", { id: item.id }).catch(() => {});
      void reload();
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const restoreNote = useCallback(async (item: StickyTrashItem) => {
    setBusyId(item.id);
    try {
      await invoke("sticky_restore", { id: item.id });
      void reload();
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const purgeNote = useCallback(async (item: StickyTrashItem) => {
    setBusyId(item.id);
    try {
      await invoke("sticky_purge", { id: item.id });
      void reload();
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const showAll = () => void invoke("stickywin_show_all").catch(() => {});
  const hideAll = () => void invoke("stickywin_hide_all").catch(() => {});

  const openCardMenu = useCallback((item: StickyListItem, at: { x: number; y: number }) => {
    setMenuExportOpen(false);
    setMenuFor({ item, x: at.x, y: at.y });
  }, []);

  // The backend's update-time order is authoritative — opening a note does
  // not move it. The Open tab filters that same ordered sequence.
  const openedItems = useMemo(() => (items ?? []).filter((i) => i.is_open), [items]);
  const wallItems = tab === "opened" ? openedItems : (items ?? []);
  /** Trash has no server-side search — filter client-side with the same query. */
  const trashVisible = useMemo(() => {
    if (!trash) return null;
    const q = query.trim().toLowerCase();
    if (!q) return trash;
    return trash.filter(
      (it) => it.title.toLowerCase().includes(q) || it.preview.toLowerCase().includes(q),
    );
  }, [trash, query]);
  const visibleCount = tab === "trash" ? trashVisible?.length ?? 0 : wallItems.length;

  const icon = "h-3.5 w-3.5";

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-black/5 bg-white/95 text-neutral-900 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/95 dark:text-neutral-100">
      {/* ── Header (drag strip, 40px; buttons auto opt out via CSS) ────── */}
      <div className="app-drag-region flex h-10 shrink-0 items-center gap-1 px-3">
        <div className="min-w-0 flex-1 select-none">
          <h1 className="truncate text-sm font-bold leading-tight">{t("sticky.manageTitle")}</h1>
          <p className="text-[10px] leading-tight text-black/40 tabular-nums dark:text-white/40">
            {t("sticky.noteCount", { n: visibleCount })}
          </p>
        </div>
        <button
          type="button"
          title={viewMode === "card" ? t("sticky.listView") : t("sticky.cardView")}
          aria-label={viewMode === "card" ? t("sticky.listView") : t("sticky.cardView")}
          className={HEADER_BUTTON}
          onClick={() => {
            const next = viewMode === "card" ? "list" : "card";
            setViewMode(next);
            try { localStorage.setItem(VIEW_MODE_KEY, next); } catch { /* Storage may be unavailable. */ }
          }}
        >
          {viewMode === "card" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </button>
        <div className="relative" ref={templatesRef}>
          <button
            type="button"
            title={t("sticky.templates")}
            className={HEADER_BUTTON}
            disabled={createBusy}
            onClick={() => setShowTemplates((v) => !v)}
          >
            {createBusy ? <Loader2 className={`${icon} animate-spin`} /> : <Plus className="h-4 w-4" />}
          </button>
          {showTemplates && (
            <div className="absolute top-8 right-0 z-50 w-44 rounded-xl border border-black/10 bg-white/95 py-1 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/95">
              {STICKY_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={MENU_ROW}
                  onClick={() => {
                    setShowTemplates(false);
                    // Blank default: picking the blank template is a plain
                    // empty sticky_create.
                    void createNote(template.id === "blank" ? undefined : template.blocks);
                  }}
                >
                  {t(template.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative" ref={moreMenuRef}>
          <button
            type="button"
            title={t("sticky.more")}
            className={HEADER_BUTTON}
            onClick={() => setShowMore((v) => !v)}
          >
            <Ellipsis className="h-4 w-4" />
          </button>
          {/* Always mounted (CSS-toggled) so the show/hide-all rows keep
              their tooltips present for the panel guard tests + a11y tree. */}
          <div
            aria-hidden={!showMore}
            className={`absolute top-8 right-0 z-50 w-52 rounded-xl border border-black/10 bg-white/95 py-1 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/95${showMore ? "" : " hidden"}`}
          >
            <button type="button" title={t("sticky.showAll")} className={MENU_ROW} onClick={() => { setShowMore(false); showAll(); }}>
              <ArrowDownToLine className={icon} /> {t("sticky.showAll")}
            </button>
            <button type="button" title={t("sticky.hideAll")} className={MENU_ROW} onClick={() => { setShowMore(false); hideAll(); }}>
              <ArrowUpToLine className={icon} /> {t("sticky.hideAll")}
            </button>
            <div className="my-1 border-t border-black/10 dark:border-white/10" />
            <button type="button" className={MENU_ROW} onClick={() => { setShowMore(false); void importFile("bundle"); }}>
              <FileUp className={icon} /> {t("sticky.importBundle")}
            </button>
            <button type="button" className={MENU_ROW} onClick={() => { setShowMore(false); void importFile("md"); }}>
              <FileUp className={icon} /> {t("sticky.importText")}
            </button>
            <div className="my-1 border-t border-black/10 dark:border-white/10" />
            <button type="button" className={MENU_ROW} onClick={() => { setShowMore(false); void exportBundle(); }}>
              <FileDown className={icon} /> {t("sticky.exportBundle")}
            </button>
            <div className="my-1 border-t border-black/10 dark:border-white/10" />
            <button type="button" className={MENU_ROW} onClick={() => { setShowMore(false); setShowHelp(true); }}>
              <CircleHelp className={icon} /> {t("sticky.quickHelp")}
            </button>
          </div>
        </div>
        <button
          type="button"
          title={t("sticky.close")}
          className={HEADER_BUTTON}
          onClick={() => void invoke("stickywin_close_manager").catch(() => window.close())}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Segmented tabs ────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pt-1">
        <div className="flex rounded-full bg-black/[0.06] p-0.5 dark:bg-white/[0.08]" role="tablist">
          {([["wall", t("sticky.wall")], ["opened", t("sticky.openedTab")]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`flex-1 rounded-full py-1 text-[11px] font-semibold transition-colors ${
                tab === id
                  ? "bg-white shadow-sm dark:bg-neutral-700"
                  : "text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80"
              }`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === "trash"}
            className={`flex flex-1 items-center justify-center gap-1 rounded-full py-1 text-[11px] font-semibold transition-colors ${
              tab === "trash"
                ? "bg-white shadow-sm dark:bg-neutral-700"
                : "text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80"
            }`}
            onClick={() => setTab("trash")}
          >
            {t("sticky.trash")}
            {trash && trash.length > 0 ? (
              <span className="rounded-full bg-black/10 px-1 text-[9px] leading-4 tabular-nums dark:bg-white/15">
                {trash.length}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* ── Search (pill row below the header) ────────────────────────── */}
      <div className="shrink-0 px-3 pt-2 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-black/40 dark:text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder={t("sticky.searchPlaceholder")}
            className="h-8 w-full rounded-full border border-black/10 bg-white/70 pr-3 pl-7 text-xs outline-none placeholder:text-black/40 focus:ring-1 focus:ring-black/20 dark:border-white/10 dark:bg-white/[0.06] dark:placeholder:text-white/40 dark:focus:ring-white/20"
          />
        </div>
      </div>

      {/* ── Body: note wall / open-only wall / trash ──────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "trash" ? (
          trashVisible === null ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-black/40 dark:text-white/40" />
            </div>
          ) : trashVisible.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-black/40 dark:text-white/40">
              {query ? t("sticky.emptySearch") : t("sticky.trashEmpty")}
            </div>
          ) : (
            <div className={viewMode === "card" ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
              {trashVisible.map((item) => (
                <div
                  key={item.id}
                  className={`flex min-w-0 flex-col rounded-xl p-2.5 opacity-70 grayscale-[30%] ${viewMode === "card" ? "min-h-[88px]" : "min-h-[68px]"}`}
                  style={{
                    backgroundColor: stickyColorHex("gray"),
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
                  }}
                >
                  <span className="truncate text-[12px] font-semibold">
                    {item.title || stickyDerivedTitle(item.preview) || t("sticky.untitled")}
                  </span>
                  <p className="mt-0.5 flex-1 line-clamp-3 whitespace-pre-wrap text-[10px] leading-relaxed opacity-60">
                    {item.preview}
                  </p>
                  <div className="mt-1 flex flex-col items-stretch gap-0.5">
                    {busyId === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin opacity-60" />
                    ) : (
                      <>
                        <button
                          type="button"
                          title={t("sticky.restore")}
                          className="flex min-h-6 min-w-0 items-center gap-1 rounded-md px-2 py-1 text-left text-[10px] leading-tight font-semibold whitespace-normal hover:bg-black/10"
                          onClick={() => void restoreNote(item)}
                        >
                          <RotateCcw className="h-3 w-3 shrink-0" /> {t("sticky.restore")}
                        </button>
                        <button
                          type="button"
                          title={t("sticky.purge")}
                          className="flex min-h-6 min-w-0 items-center gap-1 rounded-md px-2 py-1 text-left text-[10px] leading-tight font-semibold whitespace-normal text-red-700 hover:bg-red-500/10 dark:text-red-400"
                          onClick={() => setPendingPurge(item)}
                        >
                          <Trash2 className="h-3 w-3 shrink-0" /> {t("sticky.purge")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : items === null ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-black/40 dark:text-white/40" />
          </div>
        ) : wallItems.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-black/40 dark:text-white/40">
            {query ? t("sticky.emptySearch") : t("sticky.empty")}
          </div>
        ) : (
          <div className={viewMode === "card" ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
            {wallItems.map((item) => (
              <StickyManagerCard
                key={item.id}
                item={item}
                viewMode={viewMode}
                busy={busyId === item.id}
                onOpen={(it) => void openNote(it)}
                onMenu={openCardMenu}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Card context menu (fixed at window level, clamped on-screen) ── */}
      {menuFor && (
        <div
          ref={cardMenuRef}
          className="fixed z-50 w-44 rounded-xl border border-black/10 bg-white/95 py-1 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/95"
          style={{
            left: Math.max(8, Math.min(menuFor.x - 176, window.innerWidth - 184)),
            top: Math.max(8, Math.min(menuFor.y, window.innerHeight - 190)),
          }}
        >
          <button
            type="button"
            className={MENU_ROW}
            onClick={() => { setMenuFor(null); void openNote(menuFor.item); }}
          >
            <Eye className={icon} /> {t("sticky.open")}
          </button>
          <div className="my-1 border-t border-black/10 dark:border-white/10" />
          <button
            type="button"
            className={MENU_ROW}
            onClick={() => setMenuExportOpen((v) => !v)}
          >
            <FileDown className={icon} />
            <span className="flex-1">{t("sticky.exportNote")}</span>
            <ChevronDown className={`h-3 w-3 transition-transform ${menuExportOpen ? "rotate-180" : ""}`} />
          </button>
          {menuExportOpen && (
            <>
              <button
                type="button"
                className={`${MENU_ROW} pl-8`}
                onClick={() => { setMenuFor(null); void exportNote(menuFor.item, "md"); }}
              >
                Markdown (.md)
              </button>
              <button
                type="button"
                className={`${MENU_ROW} pl-8`}
                onClick={() => { setMenuFor(null); void exportNote(menuFor.item, "html"); }}
              >
                HTML (.html)
              </button>
            </>
          )}
          <div className="my-1 border-t border-black/10 dark:border-white/10" />
          <button
            type="button"
            className={`${MENU_ROW} text-red-600 hover:bg-red-500/10 dark:text-red-400`}
            onClick={() => { setPendingDelete(menuFor.item); setMenuFor(null); }}
          >
            <Trash2 className={icon} /> {t("sticky.delete")}
          </button>
        </div>
      )}

      {/* ── Destructive-action confirms ───────────────────────────────── */}
      <ConfirmModal
        open={pendingDelete !== null}
        title={t("sticky.deleteConfirmTitle")}
        message={t("sticky.deleteConfirmMessage")}
        confirmLabel={t("sticky.delete")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const item = pendingDelete;
          setPendingDelete(null);
          if (item) void trashNote(item);
        }}
      />
      <ConfirmModal
        open={pendingPurge !== null}
        title={t("sticky.purgeConfirmTitle")}
        message={t("sticky.purgeConfirmMessage")}
        confirmLabel={t("sticky.purge")}
        onCancel={() => setPendingPurge(null)}
        onConfirm={() => {
          const item = pendingPurge;
          setPendingPurge(null);
          if (item) void purgeNote(item);
        }}
      />

      {/* ── Quick help overlay (existing content, paper styling) ──────── */}
      {showHelp && (
        <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/30" onClick={() => setShowHelp(false)}>
          <div className="w-80 rounded-2xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-sm font-semibold">{t("sticky.quickHelp")}</h2>
            <ul className="space-y-1.5 text-xs text-black/60 dark:text-white/60">
              {[
                ["Ctrl/⌘+Alt+N", t("sticky.help.newNote")],
                ["Ctrl/⌘+F", t("sticky.help.find")],
                ["Enter / Shift+Enter", t("sticky.help.findNav")],
                [t("sticky.help.headerDrag"), t("sticky.help.move")],
                [t("sticky.help.edges"), t("sticky.help.resize")],
                [t("sticky.help.tray"), t("sticky.help.trayHint")],
              ].map(([k, v]) => (
                <li key={k} className="flex items-start justify-between gap-3">
                  <code className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] dark:bg-white/10">{k}</code>
                  <span className="flex-1 text-right">{v}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <button type="button" className="rounded-lg border border-black/10 px-3 py-1.5 text-xs hover:bg-black/[0.06] dark:border-white/10 dark:hover:bg-white/10" onClick={() => setShowHelp(false)}>
                {t("sticky.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
