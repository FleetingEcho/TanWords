/** The floating sticky manager (`sticky-manager.html`) — tanNotes' manager
 *  parity, rebuilt on TanNotes' own data layer:
 *  - search box (150ms debounce) → `sticky_search` (FTS on SQLite);
 *  - note list with color dot + derived title + word count; click to open
 *    the note's OS window (bounds straight from `sticky_windows`);
 *  - New Note (+), show/hide all;
 *  - Trash section (restore/purge — the soft delete lives in `documents`);
 *  - settings panel: default color/opacity, global hotkey, autostart.
 *
 *  This window never edits note content — that's the per-note window's job.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowUpToLine, ChevronDown, CircleHelp, Eye, FileDown,
  FileUp, Loader2, Plus, RotateCcw, Search,
  Trash2, X,
} from "lucide-react";
import { invoke } from "@/ipc/backend";
import { callMain } from "@/ipc/host";
import { subscribe, subscribeAll } from "@/ipc/events";
import { saveDialog } from "@/ipc/dialog";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { blocksToStorage } from "@/lib/docFormat";
import {
  blocksToMarkdownOffThread, markdownToBlocksOffThread,
} from "@/lib/documentWorkerClient";
import { exportMarkdownAsHtml } from "@/lib/documentExport";
import { stickyColorHex, type StickyDetail, type StickyListItem } from "./stickyShared";
import { STICKY_TEMPLATES } from "./stickyTemplates";
import type { Block } from "@/components/Documents/tiptap/blocks";

/** Snake_case mirror of the core's `StickyListItem` (no serde rename). */
interface StickyTrashItem {
  id: number;
  title: string;
  preview: string;
  deleted_at: string;
}

type Bounds = { x: number; y: number; width: number; height: number };

function parseBlocks(content: string): Block[] {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}

const SEARCH_DEBOUNCE_MS = 150;

export function StickyManagerApp() {
  const t = useT();

  const [items, setItems] = useState<StickyListItem[] | null>(null);
  const [trash, setTrash] = useState<StickyTrashItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [exportMenuFor, setExportMenuFor] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = query.trim()
        ? await invoke<StickyListItem[]>("sticky_search", { query })
        : await invoke<StickyListItem[]>("sticky_list");
      setItems(list);
    } catch {
      setItems([]);
    }
    try {
      setTrash(await invoke<StickyTrashItem[]>("sticky_trash_list"));
    } catch {
      setTrash([]);
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
      void reload();
    } finally {
      setCreateBusy(false);
    }
  }, [reload]);

  // ── Data tools (tanNotes M4 parity, plan S3) ────────────────────────────
  const exportNote = useCallback(async (item: StickyListItem, format: "md" | "html") => {
    try {
      const detail = await invoke<StickyDetail>("sticky_get", { id: item.id });
      const markdown = await blocksToMarkdownOffThread(parseBlocks(detail.content));
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
      await invoke("sticky_delete", { id: item.id });
      await invoke("stickywin_close", { id: item.id }).catch(() => {});
      void reload();
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const showAll = () => void invoke("stickywin_show_all").catch(() => {});
  const hideAll = () => void invoke("stickywin_hide_all").catch(() => {});

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground">
      {/* Title bar */}
      <div className="app-drag-region flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <h1 className="flex-1 truncate text-sm font-semibold">{t("sticky.manageTitle")}</h1>
        <button
          type="button"
          title={t("sticky.showAll")}
          className="rounded-md p-1.5 hover:bg-muted"
          onClick={showAll}
        >
          <ArrowDownToLine className="size-4" />
        </button>
        <button
          type="button"
          title={t("sticky.hideAll")}
          className="rounded-md p-1.5 hover:bg-muted"
          onClick={hideAll}
        >
          <ArrowUpToLine className="size-4" />
        </button>
        <div className="relative">
          <button
            type="button"
            title={t("sticky.more")}
            className="rounded-md p-1.5 hover:bg-muted"
            onClick={() => setShowMore((v) => !v)}
          >
            <CircleHelp className={showHelp ? "hidden size-4" : "size-4"} />
            <ChevronDown className={showHelp ? "size-4" : "hidden"} />
          </button>
          {showMore && (
            <div className="absolute top-9 right-0 z-50 w-52 rounded-lg border border-border bg-background py-1 shadow-lg">
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted" onClick={() => { setShowMore(false); void exportBundle(); }}>
                <FileDown className="size-3.5" /> {t("sticky.exportBundle")}
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted" onClick={() => { setShowMore(false); void importFile("bundle"); }}>
                <FileUp className="size-3.5" /> {t("sticky.importBundle")}
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted" onClick={() => { setShowMore(false); void importFile("md"); }}>
                <FileUp className="size-3.5" /> {t("sticky.importText")}
              </button>
              <div className="my-1 border-t border-border" />
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted" onClick={() => { setShowMore(false); setShowHelp(true); }}>
                <CircleHelp className="size-3.5" /> {t("sticky.quickHelp")}
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          title={t("sticky.close")}
          className="rounded-md p-1.5 hover:bg-muted"
          onClick={() => void invoke("stickywin_close_manager").catch(() => window.close())}
        >
          <X className="size-4" />
        </button>
      </div>

      {showHelp && (
        <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/30" onClick={() => setShowHelp(false)}>
          <div className="w-80 rounded-xl border border-border bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-sm font-semibold">{t("sticky.quickHelp")}</h2>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {[
                ["Ctrl/⌘+Alt+N", t("sticky.help.newNote")],
                ["Ctrl/⌘+F", t("sticky.help.find")],
                ["Enter / Shift+Enter", t("sticky.help.findNav")],
                [t("sticky.help.headerDrag"), t("sticky.help.move")],
                [t("sticky.help.edges"), t("sticky.help.resize")],
                [t("sticky.help.tray"), t("sticky.help.trayHint")],
              ].map(([k, v]) => (
                <li key={k} className="flex items-start justify-between gap-3">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{k}</code>
                  <span className="flex-1 text-right">{v}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setShowHelp(false)}>
                {t("sticky.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      <>
          {/* Search + actions */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("sticky.searchPlaceholder")}
                className="w-full rounded-md border border-border bg-background py-1.5 pr-2 pl-7 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="relative">
              <button
                type="button"
                title={t("sticky.newNote")}
                className="rounded-md bg-primary p-1.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={createBusy}
                onClick={() => void createNote()}
              >
                {createBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              </button>
              {/* Templates (tanNotes F46 parity): long-press/alternate click
                  picks a starter layout instead of a blank note. */}
              <button
                type="button"
                title={t("sticky.templates")}
                className="absolute -bottom-1 -right-1 rounded-full border border-border bg-background p-0.5"
                onClick={() => setShowTemplates((v) => !v)}
              >
                <ChevronDown className="size-2.5" />
              </button>
              {showTemplates && (
                <div className="absolute top-full right-0 z-50 mt-1 w-40 rounded-lg border border-border bg-background py-1 shadow-lg">
                  {STICKY_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        setShowTemplates(false);
                        void createNote(template.blocks);
                      }}
                    >
                      {t(template.labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {items === null ? (
              <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {query ? t("sticky.emptySearch") : t("sticky.empty")}
              </p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
                >
                  <span
                    className="size-3 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: stickyColorHex(item.color) }}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void openNote(item)}
                  >
                    <span className="block truncate text-sm">
                      {item.title || item.preview.slice(0, 60) || "…"}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.is_open ? "● " : ""}
                      {t("sticky.words", { n: item.word_count })}
                      {item.always_on_top ? " · 📌" : ""}
                    </span>
                  </button>
                  {busyId === item.id ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        title={t("sticky.open")}
                        className="rounded-md p-1.5 hover:bg-background"
                        onClick={() => void openNote(item)}
                      >
                        <Eye className="size-4" />
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          title={t("sticky.exportNote")}
                          className="rounded-md p-1.5 hover:bg-background"
                          onClick={() => setExportMenuFor((v) => (v === item.id ? null : item.id))}
                        >
                          <FileDown className="size-4" />
                        </button>
                        {exportMenuFor === item.id && (
                          <div className="absolute top-9 right-0 z-50 w-32 rounded-lg border border-border bg-background py-1 shadow-lg">
                            <button
                              type="button"
                              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                              onClick={() => { setExportMenuFor(null); void exportNote(item, "md"); }}
                            >
                              Markdown (.md)
                            </button>
                            <button
                              type="button"
                              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                              onClick={() => { setExportMenuFor(null); void exportNote(item, "html"); }}
                            >
                              HTML (.html)
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        title={t("sticky.delete")}
                        className="rounded-md p-1.5 text-destructive hover:bg-background"
                        onClick={() => void trashNote(item)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Trash section */}
          <div className="shrink-0 border-t border-border">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
              onClick={() => setShowTrash((v) => !v)}
            >
              <Trash2 className="size-4" />
              <span className="flex-1 text-left">
                {t("sticky.trash")}
                {trash && trash.length > 0 ? ` (${trash.length})` : ""}
              </span>
              <ChevronDown className={`size-4 transition-transform ${showTrash ? "rotate-180" : ""}`} />
            </button>
            {showTrash && (
              <div className="max-h-40 overflow-y-auto px-2 pb-2">
                {!trash || trash.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("sticky.trashEmpty")}</p>
                ) : (
                  trash.map((item) => (
                    <div key={item.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {item.title || item.preview.slice(0, 50) || "…"}
                      </span>
                      <button
                        type="button"
                        title={t("sticky.restore")}
                        className="rounded-md p-1.5 opacity-0 group-hover:opacity-100 hover:bg-background"
                        onClick={() => void invoke("sticky_restore", { id: item.id }).then(() => reload())}
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title={t("sticky.purge")}
                        className="rounded-md p-1.5 text-destructive opacity-0 group-hover:opacity-100 hover:bg-background"
                        onClick={() => void invoke("sticky_purge", { id: item.id }).then(() => reload())}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
      </>
    </div>
  );
}
