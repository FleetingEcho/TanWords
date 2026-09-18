/** Web Stickies board (plan §4.4, S5).
 *
 *  Desktop runs stickies as OS windows + the floating manager; this page is
 *  the WEB surface for the same data (`stickyBoard` capability gates it off
 *  on desktop). A responsive grid of colored cards, FTS search, click to edit
 *  in place through the SAME block editor the desktop notes use, autosave via
 *  `sticky_save_content` — so a note edited here shows up in the desktop
 *  stickies and vice versa (S5's cross-device acceptance).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, StickyNote, Trash2, X } from "lucide-react";
import { invoke } from "@/ipc/backend";
import { subscribe } from "@/ipc/events";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { blocksToStorage } from "@/lib/docFormat";
import { readClipboardImage } from "@/ipc/clipboard";
import { uploadDocumentImage } from "@/lib/documentAssets";
import { LazyTiptapDocumentEditor } from "@/components/Documents/tiptap/LazyTiptapDocumentEditor";
import type { DocEditorApi } from "@/components/Documents/tiptap/DocEditorApi";
import type { Block } from "@/components/Documents/tiptap/blocks";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { stickyColorHex, type StickyDetail, type StickyListItem } from "./stickyShared";
import { isDesktopHost } from "@/platform";

/** Snake_case mirror of the core's `StickyListItem` (no serde rename). */
const SAVE_DEBOUNCE_MS = 400;

function parseBlocks(content: string): Block[] {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}

export function StickiesPage() {
  const t = useT();
  // Theme subscription so the editor chrome follows live changes.
  useSettingsStore((s) => s.theme);

  const [items, setItems] = useState<StickyListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<StickyDetail | null>(null);
  const [editorBlocks, setEditorBlocks] = useState<Block[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StickyListItem | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const editorApi = useRef<DocEditorApi | null>(null);
  const dirty = useRef(false);
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

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void reload(), query ? 150 : 0);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, reload]);

  // Desktop windows/manager change the shared data — keep the board honest.
  useEffect(() => {
    if (!isDesktopHost) return;
    const stop = subscribe("stickywin:closed", () => void reload());
    return stop;
  }, [reload]);

  const scheduleSave = useCallback(() => {
    if (!editorApi.current || editingId.current === null) return;
    dirty.current = true;
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!dirty.current || !editorApi.current) return;
      dirty.current = false;
      const { content, contentText, wordCount } = blocksToStorage(editorApi.current.document);
      void invoke("sticky_save_content", {
        id: editingId.current, content, contentText, wordCount,
      }).then(() => setSaved(true)).catch(() => { dirty.current = true; });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const openEditor = useCallback(async (item: StickyListItem) => {
    try {
      const detail = await invoke<StickyDetail | null>("sticky_get", { id: item.id });
      if (!detail) return;
      editingId.current = item.id;
      dirty.current = false;
      setSaved(true);
      setEditorBlocks(parseBlocks(detail.content));
      setEditing(detail);
    } catch {
      // Locked/protected note: leave the board; toast-free for now.
    }
  }, []);

  const closeEditor = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    editingId.current = null;
    editorApi.current = null;
    setEditing(null);
    setEditorBlocks(null);
    void reload();
  }, [reload]);

  const createNote = useCallback(async () => {
    setCreateBusy(true);
    try {
      await invoke("sticky_create", {});
      void reload();
    } finally {
      setCreateBusy(false);
    }
  }, [reload]);

  const trashNote = useCallback(async (item: StickyListItem) => {
    await invoke("sticky_delete", { id: item.id }).catch(() => {});
    setDeleteTarget(null);
    if (editing?.id === item.id) closeEditor();
    void reload();
  }, [closeEditor, editing, reload]);

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

  const editingTitle = editing?.title || "";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header: search + new */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sticky.searchPlaceholder")}
            className="w-full rounded-md border border-border bg-background py-1.5 pr-2 pl-8 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          disabled={createBusy}
          onClick={() => void createNote()}
        >
          {createBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("sticky.newNote")}
        </button>
      </div>

      {/* Board */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {items === null ? (
          <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <StickyNote className="size-8" />
            <p className="text-sm">{query ? t("sticky.emptySearch") : t("sticky.empty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="group relative flex h-44 flex-col rounded-xl border border-black/10 p-3 text-left shadow-sm transition-transform hover:scale-[1.02] dark:border-black/30"
                style={{ backgroundColor: stickyColorHex(item.color) }}
                onClick={() => void openEditor(item)}
              >
                <span className="line-clamp-2 text-sm font-medium text-neutral-800">
                  {item.title || t("sticky.newNote")}
                </span>
                <span className="mt-1 line-clamp-4 text-xs text-neutral-700/80">{item.preview}</span>
                <span className="mt-auto flex items-center justify-between text-[10px] text-neutral-700/70">
                  {t("sticky.words", { n: item.word_count })}
                  {item.is_open ? <span title="open on a device">●</span> : null}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  title={t("sticky.delete")}
                  className="absolute top-2 right-2 rounded-md p-1 text-neutral-700 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(item);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      setDeleteTarget(item);
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* In-place editor (drawer) */}
      {editing && (
        <div className="absolute inset-0 z-40 flex justify-end bg-black/40" onClick={closeEditor}>
          <div
            className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
              <span
                className="size-3.5 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: stickyColorHex(editing.color) }}
              />
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{editingTitle || t("sticky.newNote")}</h2>
              <span className="text-[10px] text-muted-foreground">{saved ? "" : "…"}</span>
              <button
                type="button"
                title={t("sticky.delete")}
                className="rounded-md p-1.5 text-destructive hover:bg-muted"
                onClick={() => setDeleteTarget(editing)}
              >
                <Trash2 className="size-4" />
              </button>
              <button type="button" title={t("sticky.close")} className="rounded-md p-1.5 hover:bg-muted" onClick={closeEditor}>
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {editorBlocks && (
                <LazyTiptapDocumentEditor
                  initialBlocks={editorBlocks}
                  isDark={useSettingsStore.getState().theme !== "light"}
                  editable
                  onUploadFile={uploadFile}
                  readNativeImage={readNativeImage}
                  onChange={scheduleSave}
                  onReady={(api) => { editorApi.current = api; }}
                />
              )}
            </div>
          </div>
        </div>
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
