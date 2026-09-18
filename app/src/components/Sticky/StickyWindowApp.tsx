/** One sticky note's OS window content (`sticky.html?id=<id>`).
 *
 *  tanNotes' note window parity: a pastel, semi-transparent, frameless note
 *  with a drag header (derived title), color/opacity/pin/collapse controls,
 *  an 8-way resizable frame, and a Tiptap editor that autosaves through the
 *  sidecar (`sticky_save_content`) — the same Block[] storage format the
 *  Documents page uses, so a sticky is convertible into a full document.
 *
 *  Lifecycle contract with electron/main/stickyWindows.ts:
 *  - this renderer flushes content + window state BEFORE asking main to
 *    close the window (`stickywin_close`);
 *  - native moves/resizes arrive as `stickywin:geometryChanged` broadcasts,
 *    which we answer by reading our own bounds and persisting them;
 *  - `is_open` is true while the window exists — set by whoever opened us
 *    (manager/launch-reopen), cleared here on the close flow, and corrected
 *    by main's `closed` handler if the window dies out from under us.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ChevronDown, ChevronUp, ClipboardCopy, Copy, EllipsisVertical, FileText,
  Loader2, Pin, PinOff, Printer, SlidersHorizontal, SwatchBook, X,
} from "lucide-react";
import { backendOrigin, backendToken, invoke } from "@/ipc/backend";
import { subscribe } from "@/ipc/events";
import { readClipboardImage } from "@/ipc/clipboard";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { blocksToStorage } from "@/lib/docFormat";
import { blocksToMarkdownOffThread } from "@/lib/documentWorkerClient";
import { uploadDocumentImage } from "@/lib/documentAssets";
import { LazyTiptapDocumentEditor } from "@/components/Documents/tiptap/LazyTiptapDocumentEditor";
import type { DocEditorApi } from "@/components/Documents/tiptap/DocEditorApi";
import type { Block } from "@/components/Documents/tiptap/blocks";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { FloatingBrowserResizeHandles, type ResizeEdges } from "@/components/FloatingBrowser/FloatingBrowserResizeHandle";
import { StickyToolbar } from "./StickyToolbar";
import { StickyResizeOverlay } from "./StickyResizeOverlay";
import { StickyFindBar } from "./StickyFindBar";
import {
  STICKY_HEADER_HEIGHT, STICKY_MIN_H, STICKY_MIN_W,
  STICKY_COLORS, stickyColorHex, stickyCornerClass, stickyDerivedTitle, stickySurfaceStyle,
  useDismissOnOutsideClick,
  type StickyDetail,
} from "./stickyShared";

/** Core's sticky structs serialize snake_case (no rename_all) — this shape
 *  mirrors `StickyListItem` + the flattened `StickyDetail`. */

type Bounds = { x: number; y: number; width: number; height: number };

const SAVE_DEBOUNCE_MS = 300;
const SAVE_MAX_INTERVAL_MS = 2_000;

async function windowBounds(): Promise<Bounds | null> {
  try {
    return await invoke<Bounds>("window_get_bounds");
  } catch {
    return null;
  }
}

export function StickyWindowApp() {
  const t = useT();
  const id = useMemo(() => {
    const raw = Number(new URLSearchParams(window.location.search).get("id"));
    return Number.isFinite(raw) ? raw : 0;
  }, []);

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  /** Set when the note is protected and password-locked — the editor stays
   *  hidden behind an unlock prompt until `db_unlock_document` succeeds. */
  const [locked, setLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [title, setTitle] = useState(""); // derived from the body
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [color, setColor] = useState("yellow");
  const [corner, setCorner] = useState("rounded");
  const [opacity, setOpacity] = useState(100);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<number | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [showOpacity, setShowOpacity] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showFind, setShowFind] = useState(false);
  // Popovers dismiss on any outside pointer press; the palette/opacity menus
  // float away from their triggers, so those triggers are ignored by the
  // dismissal and keep their natural toggle.
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const paletteRef = useRef<HTMLDivElement | null>(null);
  const paletteBtnRef = useRef<HTMLButtonElement | null>(null);
  const opacityRef = useRef<HTMLDivElement | null>(null);
  const opacityBtnRef = useRef<HTMLButtonElement | null>(null);
  useDismissOnOutsideClick(moreMenuRef, showMore, () => setShowMore(false));
  useDismissOnOutsideClick(paletteRef, showPalette, () => setShowPalette(false), paletteBtnRef);
  useDismissOnOutsideClick(opacityRef, showOpacity, () => setShowOpacity(false), opacityBtnRef);
  const [saved, setSaved] = useState(true);
  const [savedWordCount, setSavedWordCount] = useState<number | null>(null);

  const editorApi = useRef<DocEditorApi | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** The live Tiptap editor, captured through `toolbarExtras` (the sanctioned
   *  render prop that receives the instance) for the fixed toolbar row. */
  const [toolbarEditor, setToolbarEditor] = useState<TiptapEditor | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsedH = useRef<number | null>(null); // expanded height while collapsed
  /** Manager toggle "translucent": false → render the note fully opaque. */
  const opaqueOverride = useRef(false);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    void useSettingsStore.getState().loadFromDB();
    if (!id) {
      setMissing(true);
      setLoading(false);
      return;
    }
    void (async () => {
      // Translucency fallback (tanNotes risk #2): the manager's toggle flips
      // this setting; "false" forces an opaque note regardless of the note's
      // own opacity value.
      try {
        const translucent = await invoke<string | null>("db_get_setting", { key: "sticky_translucent" });
        opaqueOverride.current = translucent === "false";
      } catch {
        opaqueOverride.current = false;
      }
      try {
        const detail = await invoke<StickyDetail | null>("sticky_get", { id });
        if (!detail) {
          setMissing(true);
        } else {
          applyDetail(detail);
        }
      } catch (error) {
        // document_privacy rejects with a bare "DOCUMENT_LOCKED…" string.
        if (typeof error === "string" && error.startsWith("DOCUMENT_LOCKED")) setLocked(true);
        else setMissing(true);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const applyDetail = (detail: StickyDetail) => {
    // Flat wire shape (serde-flattened item) — see stickyShared.ts.
    setTitle(detail.title);
    setCustomTitle(detail.custom_title && detail.title ? detail.title : null);
    setColor(detail.color);
    setCorner(detail.corner);
    setOpacity(detail.opacity);
    setAlwaysOnTop(detail.always_on_top);
    setCollapsed(detail.collapsed);
    setFontFamily(detail.font_family ?? null);
    setFontSize(detail.font_size ?? null);
    setSavedWordCount(detail.word_count);
    if (detail.collapsed) collapsedH.current = detail.h;
    // Storage format is a JSON array of Block[] — the Documents editor's own
    // format, which is what makes sticky↔document conversion trivial later.
    // `[]` is a fresh note; a non-array string (legacy/odd) edits as empty
    // rather than crashing the editor.
    try {
      const parsed = JSON.parse(detail.content);
      setBlocks(Array.isArray(parsed) ? (parsed as Block[]) : []);
    } catch {
      setBlocks([]);
    }
  };

  const unlock = useCallback(async () => {
    if (!unlockPassword) return;
    try {
      await invoke("db_unlock_document", { id, password: unlockPassword });
      setUnlockPassword("");
      setLocked(false);
      const detail = await invoke<StickyDetail | null>("sticky_get", { id });
      if (detail) applyDetail(detail);
    } catch {
      // Wrong password — the field stays for another attempt.
    }
  }, [id, unlockPassword]);

  // ── Saving ──────────────────────────────────────────────────────────────
  const flushSave = useCallback(async () => {
    if (!dirty.current || !editorApi.current) return;
    dirty.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    saveTimer.current = null;
    maxSaveTimer.current = null;
    try {
      const { content, contentText, wordCount } = blocksToStorage(editorApi.current.document);
      await invoke("sticky_save_content", { id, content, contentText, wordCount });
      setSaved(true);
      setSavedWordCount(wordCount);
      setTitle(stickyDerivedTitle(contentText));
    } catch {
      dirty.current = true; // retried by the next keystroke/close
    }
  }, [id]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
    if (!maxSaveTimer.current) {
      // Someone typing without pausing still saves periodically.
      maxSaveTimer.current = setTimeout(() => void flushSave(), SAVE_MAX_INTERVAL_MS);
    }
  }, [flushSave]);

  // Persist before unload as a final net (the close button has its own
  // ordered flow; this covers native window destruction and reloads). The
  // async flush usually loses the race with window destruction, so a
  // synchronous XHR rides along — deprecated for general use, but exactly
  // right for one last tiny write during unload.
  useEffect(() => {
    const handler = () => {
      void flushSave();
      try {
        if (!dirty.current || !editorApi.current) return;
        const { content, contentText, wordCount } = blocksToStorage(editorApi.current.document);
        dirty.current = false;
        void (async () => {
          const origin = await backendOrigin();
          const token = await backendToken();
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `${origin}/invoke/sticky_save_content`, false);
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.send(JSON.stringify({ id, content, contentText, wordCount }));
        })();
      } catch {
        // Best-effort by design — the debounced saves are the real net.
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flushSave, id]);

  // Switching away from the note is a natural checkpoint — flush immediately
  // rather than waiting out the debounce.
  useEffect(() => {
    const handler = () => { void flushSave(); };
    window.addEventListener("blur", handler);
    return () => window.removeEventListener("blur", handler);
  }, [flushSave]);

  // ── Window geometry ─────────────────────────────────────────────────────
  const persistGeometry = useCallback(async (patch: { collapsed?: boolean } = {}) => {
    const bounds = await windowBounds();
    if (!bounds) return;
    await invoke("sticky_update_window_state", {
      id,
      x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height,
      ...(patch.collapsed === undefined ? {} : { collapsed: patch.collapsed }),
    }).catch(() => {});
  }, [id]);

  // Native moves/resizes (header drag, quit flush nudge): re-read our bounds
  // and persist. Debounced — 'moved' fires continuously during a drag.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = subscribe<{ id: number }>("stickywin:geometryChanged", ({ id: changed }) => {
      if (changed !== id) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void persistGeometry(), 300);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [id, persistGeometry]);

  const setWindowBounds = useCallback((next: Partial<Bounds>) => {
    void (async () => {
      const bounds = await windowBounds();
      if (!bounds) return;
      await invoke("stickywin_set_bounds", { ...bounds, ...next }).catch(() => {});
    })();
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prevCollapsed) => {
      const nextCollapsed = !prevCollapsed;
      if (nextCollapsed) {
        // Remember the expanded height so expand restores it exactly.
        void windowBounds().then((b) => {
          if (b) collapsedH.current = b.height;
          setWindowBounds({ height: STICKY_HEADER_HEIGHT });
        });
      } else {
        setWindowBounds({ height: collapsedH.current ?? 480 });
      }
      void persistGeometry({ collapsed: nextCollapsed });
      return nextCollapsed;
    });
  }, [persistGeometry, setWindowBounds]);

  // ── Meta changes ────────────────────────────────────────────────────────
  const updateMeta = useCallback(async (patch: {
    color?: string; corner?: string; opacity?: number; always_on_top?: boolean;
    font_family?: string | null; font_size?: number | null;
  }) => {
    try {
      await invoke("sticky_update_meta", {
        id,
        ...(patch.color === undefined ? {} : { color: patch.color }),
        ...(patch.corner === undefined ? {} : { corner: patch.corner }),
        ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
        ...(patch.always_on_top === undefined ? {} : { always_on_top: patch.always_on_top }),
        ...(patch.font_family === undefined ? {} : { font_family: patch.font_family ?? "" }),
        ...(patch.font_size === undefined ? {} : { font_size: patch.font_size ?? 0 }),
      });
    } catch {
      // Non-fatal — the visual state already applied locally.
    }
  }, [id]);

  const togglePin = useCallback(() => {
    setAlwaysOnTop((prev) => {
      const next = !prev;
      void invoke("stickywin_set_always_on_top", { id, on: next }).catch(() => {});
      void updateMeta({ always_on_top: next });
      return next;
    });
  }, [id, updateMeta]);

  // ── Resize (8-way handles — native resize is off for transparent
  //    frameless windows; same approach as the floating-browser popout) ────
  const resizeRef = useRef<{
    startScreenX: number; startScreenY: number; orig: Bounds; edges: ResizeEdges;
  } | null>(null);
  const onResizePointerDown = useCallback((edges: ResizeEdges, e: React.PointerEvent) => {
    void windowBounds().then((orig) => {
      if (orig) resizeRef.current = { startScreenX: e.screenX, startScreenY: e.screenY, orig, edges };
    });
  }, []);
  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const dx = e.screenX - r.startScreenX;
    const dy = e.screenY - r.startScreenY;
    let width = r.orig.width;
    let height = r.orig.height;
    if (r.edges.right) width = r.orig.width + dx;
    if (r.edges.left) width = r.orig.width - dx;
    if (r.edges.bottom) height = r.orig.height + dy;
    if (r.edges.top) height = r.orig.height - dy;
    width = Math.max(STICKY_MIN_W, width);
    height = Math.max(collapsed ? STICKY_HEADER_HEIGHT : STICKY_MIN_H, height);
    const x = r.edges.left ? r.orig.x + r.orig.width - width : r.orig.x;
    const y = r.edges.top ? r.orig.y + r.orig.height - height : r.orig.y;
    void invoke("stickywin_set_bounds", { x, y, width, height }).catch(() => {});
  }, [collapsed]);
  const onResizePointerUp = useCallback(() => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    // Drag done — persist the final geometry (the debounced persistGeometry
    // broadcast would also catch it; this is immediate and exact).
    void persistGeometry();
  }, [persistGeometry]);

  // ── Rename (double-click the header title) ─────────────────────────────
  const commitRename = useCallback(() => {
    const next = renameDraft.trim().slice(0, 200);
    setRenaming(false);
    if (next === (customTitle ?? "")) return; // unchanged (incl. empty draft)
    setCustomTitle(next || null);
    if (next) setTitle(next);
    // Blank clears the rename: core re-derives from the body and flags it off.
    void invoke("sticky_set_title", { id, title: next }).catch(() => {});
  }, [customTitle, id, renameDraft]);

  const displayTitle = customTitle ?? title;

  // ── Close ───────────────────────────────────────────────────────────────
  const closeNote = useCallback(() => {
    void (async () => {
      dirty.current = true; // force the flush even if nothing changed
      await flushSave();
      await persistGeometry({ collapsed }).catch(() => {});
      await invoke("sticky_update_window_state", { id, is_open: false }).catch(() => {});
      await invoke("stickywin_close", { id }).catch(() => {});
    })();
  }, [collapsed, flushSave, id, persistGeometry]);

  // ── Editor helpers ──────────────────────────────────────────────────────
  const uploadFile = useCallback(
    (file: File) => uploadDocumentImage(id, file),
    [id],
  );
  const readNativeImage = useCallback(async () => {
    try {
      return await readClipboardImage();
    } catch {
      return null;
    }
  }, []);

  // Ctrl/Cmd+F opens the find bar (closed with Escape inside the bar).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setShowFind((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const copyAsMarkdown = useCallback(async () => {
    if (!editorApi.current) return;
    try {
      const markdown = await blocksToMarkdownOffThread(editorApi.current.document);
      await navigator.clipboard.writeText(markdown);
      setShowMore(false);
    } catch {
      // Clipboard denied — nothing to report into a sticky.
    }
  }, []);

  const copyAsImage = useCallback(async () => {
    setShowMore(false);
    // Main captures by temporarily growing the window to the FULL content
    // height (capturePage only rasterises the viewport), so hand it the
    // complete page height: everything above the scroller (header/toolbar)
    // + the scrolled content + footer/padding below.
    let fullHeight: number | null = null;
    const scroller = scrollRef.current;
    if (scroller) {
      const top = scroller.getBoundingClientRect().top;
      fullHeight = Math.ceil(top + scroller.scrollHeight + 32);
    }
    await invoke("stickywin_capture_image", { fullHeight }).catch(() => {});
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="size-5 animate-spin text-neutral-600" />
      </div>
    );
  }

  if (missing) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 rounded-2xl bg-neutral-100 text-neutral-700">
        <p className="text-sm">{t("sticky.gone")}</p>
        <button
          type="button"
          className="app-region-no-drag rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:bg-neutral-50"
          onClick={() => window.close()}
        >
          {t("sticky.goneClose")}
        </button>
      </div>
    );
  }

  const editorFont = fontFamily ?? undefined;

  return (
    <div className="relative h-screen w-screen">
      <div
        className={`app-region-no-drag flex h-full w-full flex-col overflow-hidden ${stickyCornerClass(corner)} ${collapsed ? "" : "select-none"}`}
        style={{ ...stickySurfaceStyle(color, opaqueOverride.current ? 100 : opacity), color: "#1f2937" }}
      >
        {/* Header: drag region + controls */}
        <div
          className="app-drag-region flex shrink-0 items-center gap-1 px-2"
          style={{ height: STICKY_HEADER_HEIGHT }}
        >
          <button
            ref={paletteBtnRef}
            type="button"
            title={t("sticky.color")}
            className="app-region-no-drag rounded-md p-1.5 hover:bg-black/10"
            onClick={() => { setShowPalette((v) => !v); setShowOpacity(false); }}
          >
            <SwatchBook className="size-4" />
          </button>
          <button
            ref={opacityBtnRef}
            type="button"
            title={t("sticky.opacity")}
            className="app-region-no-drag rounded-md p-1.5 hover:bg-black/10"
            onClick={() => { setShowOpacity((v) => !v); setShowPalette(false); }}
          >
            <SlidersHorizontal className="size-4" />
          </button>
          <div className="min-w-0 flex-1 px-1 text-center">
            {renaming ? (
              <input
                autoFocus
                value={renameDraft}
                placeholder={t("sticky.renameTitle")}
                className="app-region-no-drag w-full min-w-0 rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-[12px] text-neutral-900 outline-none focus:border-neutral-500"
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <span
                className="block cursor-text truncate text-[13px] font-medium leading-none"
                title={displayTitle || undefined}
                onDoubleClick={() => {
                  setRenameDraft(displayTitle);
                  setRenaming(true);
                }}
              >
                {displayTitle || "…"}
              </span>
            )}
          </div>
          <button
            type="button"
            title={t("sticky.alwaysOnTop")}
            className={`app-region-no-drag rounded-md p-1.5 hover:bg-black/10 ${alwaysOnTop ? "opacity-100" : "opacity-40"}`}
            onClick={togglePin}
          >
            {alwaysOnTop ? <Pin className="size-4" /> : <PinOff className="size-4" />}
          </button>
          <button
            type="button"
            title={collapsed ? t("sticky.expand") : t("sticky.collapse")}
            className="app-region-no-drag rounded-md p-1.5 hover:bg-black/10"
            onClick={toggleCollapse}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              title="More"
              className="app-region-no-drag rounded-md p-1.5 hover:bg-black/10"
              onClick={() => setShowMore((v) => !v)}
            >
              <EllipsisVertical className="size-4" />
            </button>
            {showMore && (
              <div className="app-region-no-drag absolute top-9 right-0 z-50 w-44 rounded-lg border border-black/10 bg-white/95 py-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-800 hover:bg-neutral-100"
                  onClick={() => { setShowMore(false); setShowFind(true); }}
                >
                  <FileText className="size-3.5" /> Find & replace
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-800 hover:bg-neutral-100"
                  onClick={() => { setShowMore(false); void invoke("stickywin_print").catch(() => {}); }}
                >
                  <Printer className="size-3.5" /> Print
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-800 hover:bg-neutral-100"
                  onClick={() => void copyAsMarkdown()}
                >
                  <ClipboardCopy className="size-3.5" /> Copy as Markdown
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-800 hover:bg-neutral-100"
                  onClick={() => void copyAsImage()}
                >
                  <Copy className="size-3.5" /> Copy as image
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            title={t("sticky.close")}
            className="app-region-no-drag rounded-md p-1.5 hover:bg-black/10"
            onClick={closeNote}
          >
            <X className="size-4" />
          </button>
        </div>

        {showFind && !collapsed && (
          <StickyFindBar editor={toolbarEditor} onClose={() => setShowFind(false)} />
        )}

        {/* Palettes (anchored under the header buttons) */}
        {showPalette && (
          <div ref={paletteRef} className="app-region-no-drag absolute top-12 left-2 z-50 rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg">
            <div className="grid grid-cols-4 gap-2">
              {STICKY_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.id}
                  className={`size-7 rounded-full border ${color === c.id ? "border-neutral-700 ring-2 ring-neutral-400" : "border-black/10"}`}
                  style={{ backgroundColor: c.hex }}
                  onClick={() => {
                    setColor(c.id);
                    setShowPalette(false);
                    void updateMeta({ color: c.id });
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {showOpacity && (
          <div ref={opacityRef} className="app-region-no-drag absolute top-12 left-2 z-50 w-44 rounded-xl border border-black/10 bg-white/95 p-3 shadow-lg">
            <label className="block text-xs text-neutral-600">{t("sticky.opacity")}: {opacity}%</label>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={opacity}
              className="mt-2 w-full"
              onChange={(e) => setOpacity(Number(e.target.value))}
              onPointerUp={() => {
                setShowOpacity(false);
                void updateMeta({ opacity });
              }}
            />
          </div>
        )}

        {/* Editor body (hidden entirely when collapsed) */}
        {!collapsed && (
          <div className="flex min-h-0 flex-1 flex-col">
            {!locked && (
              <StickyToolbar
                editor={toolbarEditor}
                noteFontSize={fontSize}
                onNoteFontSize={(size) => {
                  setFontSize(size);
                  void updateMeta({ font_size: size });
                }}
              />
            )}
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto px-3 pb-2"
              style={{
                fontFamily: editorFont,
                // .ProseMirror re-asserts font-size via this var, overriding
                // plain inheritance — so the sticky's own font_size must ride
                // the variable. Scoped here, it also pins the default to the
                // sticky's 16px instead of leaking the app's Documents slider.
                "--document-font-size": `${fontSize ?? 16}px`,
              } as CSSProperties}
            >
              {locked ? (
                <div className="pt-4">
                  <p className="text-xs text-neutral-600">{t("sticky.locked")}</p>
                  <input
                    type="password"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }}
                    className="app-region-no-drag mt-2 w-full rounded-md border border-black/15 bg-white/80 px-2 py-1.5 text-sm"
                    placeholder="••••••"
                    autoFocus
                  />
                </div>
              ) : blocks ? (
                <LazyTiptapDocumentEditor
                  initialBlocks={blocks}
                  isDark={false}
                  editable
                  onUploadFile={uploadFile}
                  readNativeImage={readNativeImage}
                  onChange={scheduleSave}
                  onReady={(api) => { editorApi.current = api; }}
                  toolbarExtras={(editor) => {
                    // The render prop is the one place the shared editor
                    // instance surfaces; mirror it into state for the fixed
                    // toolbar. queueMicrotask keeps this a post-render update.
                    queueMicrotask(() => setToolbarEditor(editor));
                    return null;
                  }}
                />
              ) : null}
            </div>
          </div>
        )}

        {/* Footer: save indicator */}
        {!collapsed && (
          <div className="flex h-6 shrink-0 items-center justify-end px-3 text-[10px] text-neutral-600/80">
            {saved
              ? savedWordCount !== null && savedWordCount > 0
                ? t("sticky.words", { n: savedWordCount })
                : ""
              : t("sticky.saving")}
          </div>
        )}
      </div>

      {/* 8-way resize handles straddle the rounded surface. The overlay
          wrapper is pointer-events-none — a bare inset-0 div here used to
          swallow every click in the note (see StickyResizeOverlay). */}
      <StickyResizeOverlay>
        <FloatingBrowserResizeHandles
          onResizePointerDown={onResizePointerDown}
          onResizePointerMove={onResizePointerMove}
          onResizePointerUp={onResizePointerUp}
        />
      </StickyResizeOverlay>
    </div>
  );
}
