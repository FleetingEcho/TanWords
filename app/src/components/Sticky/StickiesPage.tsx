/** Web Stickies board (plan §4.4, S5) — "桌面便签墙": a desktop-style sticky
 *  wall for the browser.
 *
 *  Desktop runs stickies as OS windows + the floating manager; this page is
 *  the WEB surface for the same data (`stickyBoard` capability gates it off
 *  on desktop at the pageCatalog level — this file never renders there).
 *  A CSS-columns masonry wall of pastel cards with a dashed quick-capture
 *  composer in the first slot, pill search, and a right-side slide-over
 *  editor sheet driven by the SAME block editor the desktop notes use,
 *  autosaving via `sticky_save_content` — so a note edited here shows up in
 *  the desktop stickies and vice versa (S5's cross-device acceptance).
 *
 *  Deliberately NOT on web: alwaysOnTop, opacity, window geometry, and the
 *  translucent toggle are desktop-window concerns, as are the stickywin:*
 *  events (web has no note windows); the note's `is_open` desktop flag is
 *  never surfaced here. No isDesktopHost guards remain — this page is
 *  web-only by construction. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, StickyNote, X } from "lucide-react";
import { invoke } from "@/ipc/backend";
import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { useSettingsStore } from "@/store/settingsStore";
import { blocksToStorage } from "@/lib/docFormat";
import { readClipboardImage } from "@/ipc/clipboard";
import { uploadDocumentImage } from "@/lib/documentAssets";
import { LazyTiptapDocumentEditor } from "@/components/Documents/tiptap/LazyTiptapDocumentEditor";
import type { DocEditorApi } from "@/components/Documents/tiptap/DocEditorApi";
import type { Block } from "@/components/Documents/tiptap/blocks";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { StickyToolbar } from "./StickyToolbar";
import { insertRenderedMarkdown } from "./insertRenderedMarkdown";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  STICKY_COLORS,
  sortStickyItems,
  stickyColorHex,
  stickyDerivedTitle,
  type StickyDetail,
  type StickyListItem,
} from "./stickyShared";
import { StickyWallCard } from "./StickyWallCard";
import { StickySortSelect, useStickySort } from "./StickySortSelect";

const SAVE_DEBOUNCE_MS = 400;
const SEARCH_DEBOUNCE_MS = 150;

function parseBlocks(content: string): Block[] {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}

/** Quick-capture composer — the wall's first masonry cell. One line in,
 *  Enter creates the note (block shape mirrors stickyTemplates.ts exactly:
 *  Block[] → blocksToStorage → sticky_create), Esc clears the draft. */
function QuickComposer({
  value,
  busy,
  placeholder,
  onChange,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mb-3 break-inside-avoid rounded-2xl border-2 border-dashed border-border/60 bg-transparent p-3">
      <input
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          } else if (e.key === "Escape") {
            onChange("");
          }
        }}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function StickiesPage() {
  const t = useT();
  /** Theme flag for the drawer's shared editor — drives the code-block theme
   *  refresh in TiptapDocumentEditor. Reactive (DOM-observed): the old
   *  one-shot getState() read was stale whenever the theme flipped with the
   *  drawer already open. */
  const isDark = useIsDark();
  // Theme subscription so the editor chrome follows live changes.
  useSettingsStore((s) => s.theme);

  const [items, setItems] = useState<StickyListItem[] | null>(null);
  const [sortMode, setSortMode] = useStickySort();
  const [query, setQuery] = useState("");
  const [quickText, setQuickText] = useState("");
  const [editing, setEditing] = useState<StickyDetail | null>(null);
  const [editorBlocks, setEditorBlocks] = useState<Block[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StickyListItem | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [saveFailed, setSaveFailed] = useState(false);
  const [liveWords, setLiveWords] = useState(0);
  /** Live tiptap instance, captured from the drawer's toolbarExtras render
   *  prop so the fixed StickyToolbar row can drive it. */
  const [drawerEditor, setDrawerEditor] = useState<TiptapEditor | null>(null);
  const editorApi = useRef<DocEditorApi | null>(null);
  const dirty = useRef(false);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingId = useRef<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = query.trim()
        ? await invoke<StickyListItem[]>("sticky_search", { query })
        : await invoke<StickyListItem[]>("sticky_list");
      setItems(list);
    } catch {
      setItems([]);
    }
  }, [query]);

  useEffect(() => {
    void useSettingsStore.getState().loadFromDB();
  }, []);

  // Search is debounced 150ms; clearing the box snaps back to the full wall.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void reload(), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, reload]);

  const flushSave = useCallback((): Promise<boolean> => {
    if (saveInFlight.current) return saveInFlight.current;
    if (!dirty.current) return Promise.resolve(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const run = async () => {
      while (dirty.current) {
        const api = editorApi.current;
        const id = editingId.current;
        if (!api || id === null) return false;
        dirty.current = false;
        const { content, contentText, wordCount } = blocksToStorage(api.document);
        try {
          await invoke("sticky_save_content", { id, content, contentText, wordCount });
        } catch {
          dirty.current = true;
          setSaveFailed(true);
          setSaved(false);
          return false;
        }
        if (!dirty.current && editingId.current === id) {
          setSaved(true);
          setSaveFailed(false);
          setLiveWords(wordCount);
        }
      }
      return true;
    };
    const pending = run();
    saveInFlight.current = pending;
    void pending.finally(() => {
      if (saveInFlight.current === pending) saveInFlight.current = null;
    });
    return pending;
  }, []);

  const scheduleSave = useCallback(() => {
    if (!editorApi.current || editingId.current === null) return;
    dirty.current = true;
    setSaved(false);
    setSaveFailed(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSave(); }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const beginEdit = useCallback((detail: StickyDetail) => {
    editingId.current = detail.id;
    dirty.current = false;
    setSaved(true);
    setSaveFailed(false);
    setLiveWords(detail.word_count);
    setEditorBlocks(parseBlocks(detail.content));
    setEditing(detail);
  }, []);

  const openEditor = useCallback(async (item: StickyListItem) => {
    try {
      if (editingId.current !== null && !await flushSave()) return;
      const detail = await invoke<StickyDetail | null>("sticky_get", { id: item.id });
      if (!detail) return;
      beginEdit(detail);
    } catch {
      // Locked/protected note: leave the board; toast-free for now.
    }
  }, [beginEdit, flushSave]);

  const closeEditor = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!await flushSave()) return;
    editingId.current = null;
    editorApi.current = null;
    setDrawerEditor(null);
    setEditing(null);
    setEditorBlocks(null);
    void reload();
  }, [flushSave, reload]);

  /** New-button flow: blank note, then straight into the editor sheet. */
  const createAndEdit = useCallback(async () => {
    setCreateBusy(true);
    try {
      if (editingId.current !== null && !await flushSave()) return;
      // Flat wire shape — sticky_create returns the detail with top-level id.
      const created = await invoke<StickyDetail>("sticky_create", {});
      // A note created mid-search wouldn't match; drop the filter so the wall
      // makes sense when the sheet closes.
      if (query) setQuery("");
      else void reload();
      beginEdit(created);
    } finally {
      setCreateBusy(false);
    }
  }, [beginEdit, flushSave, query, reload]);

  /** Quick capture: one line → one paragraph block (stickyTemplates.ts shape:
   *  non-empty text blocks carry content as a styled inline array). */
  const quickCreate = useCallback(async () => {
    const line = quickText.trim();
    if (!line || createBusy) return;
    setCreateBusy(true);
    try {
      const blocks: Block[] = [
        { type: "paragraph", props: {}, content: [{ type: "text", text: line, styles: {} }] },
      ];
      const payload = blocksToStorage(blocks);
      await invoke("sticky_create", {
        content: payload.content, contentText: payload.contentText, wordCount: payload.wordCount,
      });
      setQuickText("");
      if (query) setQuery("");
      else void reload();
    } finally {
      setCreateBusy(false);
    }
  }, [createBusy, query, quickText, reload]);

  const changeColor = useCallback((color: string) => {
    const current = editing;
    if (!current || stickyColorHex(current.color) === stickyColorHex(color)) return;
    // Optimistic — the sheet's chrome follows immediately, like the desktop
    // note windows do; the IPC failure path is intentionally silent there too.
    setEditing({ ...current, color });
    void invoke("sticky_update_meta", { id: current.id, color }).catch(() => {});
  }, [editing]);

  const trashNote = useCallback(async (item: StickyListItem) => {
    if (editingId.current === item.id && !await flushSave()) return;
    await invoke("sticky_delete", { id: item.id }).catch(() => {});
    setDeleteTarget(null);
    if (editing?.id === item.id) void closeEditor();
    void reload();
  }, [closeEditor, editing, flushSave, reload]);

  const uploadFile = useCallback(
    (file: File) => (editingId.current === null ? Promise.reject("no note") : uploadDocumentImage(editingId.current, file)),
    [],
  );
  const readNativeImage = useCallback(async () => {
    try {
      return await readClipboardImage();
    } catch {
      return null;
    }
  }, []);

  const pasteMarkdown = useCallback(async (markdown: string) => {
    return drawerEditor ? insertRenderedMarkdown(drawerEditor, markdown) : false;
  }, [drawerEditor]);

  const editingTitle =
    (editing && (editing.title || stickyDerivedTitle(editing.preview) || t("sticky.untitled"))) || "";
  const sortedItems = useMemo(
    () => sortStickyItems(items ?? [], sortMode),
    [items, sortMode],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
        {/* Wall header: title + count stacked, pill search + new on the right */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div>
            <h1 className="text-lg font-bold">{t("nav.stickies")}</h1>
            <p className="text-xs text-muted-foreground">
              {items !== null ? t("sticky.noteCount", { n: items.length }) : " "}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("sticky.searchPlaceholder")}
              className="h-8 w-52 rounded-full border border-transparent bg-muted/40 px-3 text-sm outline-none focus:border-input focus:bg-background"
            />
            <StickySortSelect value={sortMode} onChange={setSortMode} />
            <button
              type="button"
              className="flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={createBusy}
              onClick={() => void createAndEdit()}
            >
              {createBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {t("sticky.newNote")}
            </button>
          </div>
        </div>

        {/* Wall */}
        {items === null ? (
          <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Keep quick capture available on an empty wall and during a
                search with no matches. */}
            <div className="mt-4 columns-1 gap-3 sm:columns-2 xl:columns-3">
              <QuickComposer
                value={quickText}
                busy={createBusy}
                placeholder={t("sticky.quickAddPlaceholder")}
                onChange={setQuickText}
                onSubmit={() => void quickCreate()}
              />
              {sortedItems.map((item) => (
                <StickyWallCard key={item.id} item={item} onOpen={(it) => void openEditor(it)} />
              ))}
            </div>
            {items.length === 0 && (
              <div className="py-12 text-center">
                <StickyNote className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  {query ? t("sticky.emptySearch") : t("sticky.empty")}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Editor slide-over — the wall stays visible/usable at sm and up; only
          small screens get a dimmed backdrop (click closes). */}
      {editing && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={() => void closeEditor()} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-2xl sm:w-[560px] xl:w-[640px]">
            {/* Header: color dots … close; the title line is display-only
                (rename is a desktop-window feature — derived title only). */}
            <div className="shrink-0 border-b border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("sticky.color")}>
                {STICKY_COLORS.map((c) => {
                  const active = stickyColorHex(editing.color) === c.hex;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.id}
                      onClick={() => changeColor(c.id)}
                      className={`h-4 w-4 rounded-full transition ${
                        active ? "ring-2 ring-primary/50 ring-offset-1" : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  );
                })}
                <div className="flex-1" />
                <button
                  type="button"
                  title={t("sticky.close")}
                  className="rounded-md p-1.5 hover:bg-muted"
                  onClick={() => void closeEditor()}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-2 truncate text-base font-semibold">{editingTitle}</div>
            </div>
            {/* Same fixed format row the floating note has — the web drawer
                previously had no toolbar at all, which read as highlight /
                text colour "not working". No per-note font size on web, so
                the picker stays hidden there. */}
            <StickyToolbar editor={drawerEditor} onPasteMarkdown={pasteMarkdown} />
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {editorBlocks && (
                <LazyTiptapDocumentEditor
                  initialBlocks={editorBlocks}
                  isDark={isDark}
                  editable
                  onUploadFile={uploadFile}
                  readNativeImage={readNativeImage}
                  onChange={scheduleSave}
                  onReady={(api) => { editorApi.current = api; }}
                  toolbarExtras={(editor) => {
                    // Mirror the live editor for the fixed row (same capture
                    // plumbing as StickyWindowApp).
                    queueMicrotask(() => setDrawerEditor(editor));
                    return null;
                  }}
                />
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
              {saveFailed ? (
                <button type="button" className="font-medium text-destructive" onClick={() => void flushSave()}>
                  {t("sticky.retrySave")}
                </button>
              ) : <span>{saved ? t("sticky.saved") : t("sticky.saving")}</span>}
              <span className="flex items-center gap-3">
                <span>{t("sticky.words", { n: liveWords })}</span>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 font-medium text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteTarget(editing)}
                >
                  {t("sticky.delete")}
                </button>
              </span>
            </div>
          </div>
        </>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title={t("sticky.deleteConfirmTitle")}
        message={t("sticky.deleteConfirmMessage")}
        danger
        onConfirm={() => { if (deleteTarget) void trashNote(deleteTarget); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
