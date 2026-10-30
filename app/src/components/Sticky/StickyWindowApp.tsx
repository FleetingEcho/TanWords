/** One sticky note's OS window content (`sticky.html?id=<id>`).
 *
 *  tanNotes' note window parity: a pastel, semi-transparent, frameless note
 *  with a drag header (derived title), color/pin/collapse controls, an 8-way
 *  resizable frame, and a Tiptap editor that autosaves through the sidecar
 *  (`sticky_save_content`) — the same Block[] storage format the Documents
 *  page uses, so a sticky is convertible into a full document.
 *
 *  Lifecycle contract with electron/main/stickyWindows.ts:
 *  - this renderer flushes content + window state BEFORE asking main to
 *    close the window (`stickywin_close`);
 *  - native moves/resizes arrive as `stickywin:geometryChanged` broadcasts,
 *    which we answer by reading our own bounds and persisting them;
 *  - `is_open` is true while the window exists — set by whoever opened us
 *    (manager/launch-reopen), cleared here on the close flow, and corrected
 *    by main's `closed` handler if the window dies out from under us.
 *
 *  Visual system: one rounded-2xl surface paints the note (stickySurfaceStyle
 *  gives the translucent color fill + same-hue hairline ring). The window is
 *  force-light with a transparent body, so all chrome uses explicit
 *  rgba()/black-alpha utilities — never theme tokens. */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Check, ChevronDown, ChevronUp, ClipboardCopy, ClipboardPaste, Copy, EllipsisVertical, Layers,
  Loader2, Lock, Pin, Printer, Search, Trash2, Unlock, X,
} from "lucide-react";
import { backendOrigin, backendToken, invoke } from "@/ipc/backend";
import { callMain } from "@/ipc/host";
import { subscribe } from "@/ipc/events";
import { readClipboardImage } from "@/ipc/clipboard";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { blocksToStorage } from "@/lib/docFormat";
import { blocksToMarkdownOffThread } from "@/lib/documentWorkerClient";
import { lowerMermaid } from "@/components/Documents/mermaidTransforms";
import { lowerMedia, lowerYouTube } from "@/components/Documents/mediaTransforms";
import { uploadDocumentImage } from "@/lib/documentAssets";
import { LazyTiptapDocumentEditor } from "@/components/Documents/tiptap/LazyTiptapDocumentEditor";
import type { DocEditorApi } from "@/components/Documents/tiptap/DocEditorApi";
import type { Block } from "@/components/Documents/tiptap/blocks";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { FloatingBrowserResizeHandles, type ResizeEdges } from "@/components/FloatingBrowser/FloatingBrowserResizeHandle";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { StickyToolbar } from "./StickyToolbar";
import { StickyResizeOverlay } from "./StickyResizeOverlay";
import { StickyFindBar } from "./StickyFindBar";
import { insertRenderedMarkdown } from "./insertRenderedMarkdown";
import {
  STICKY_HEADER_HEIGHT, STICKY_MIN_H, STICKY_MIN_W,
  STICKY_COLORS, stickyColorHex, stickyCornerClass, stickyDerivedTitle, stickySurfaceStyle,
  useDismissOnOutsideClick,
  type StickyDetail,
} from "./stickyShared";

type Bounds = { x: number; y: number; width: number; height: number };

const SAVE_DEBOUNCE_MS = 300;
const SAVE_MAX_INTERVAL_MS = 2_000;
/** How long the emerald "saved" dot lingers before fading out. */
const SAVE_FLASH_MS = 1_400;

/** 26px header icon buttons (right cluster + color-dot trigger). */
const HEADER_BUTTON_CLASS =
  "app-region-no-drag flex size-[26px] items-center justify-center rounded-md transition-colors hover:bg-black/10";
/** Shared row styling for the More menu. */
const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-800 hover:bg-neutral-100";

/** Note-wide font sizes offered by the More-menu segment (sticky_update_meta
 *  font_size). Medium is the editor's built-in 16px default. */
const FONT_CHOICES: ReadonlyArray<{ key: string; size: number }> = [
  { key: "sticky.font.small", size: 14 },
  { key: "sticky.font.medium", size: 16 },
  { key: "sticky.font.large", size: 18 },
];

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

async function windowBounds(): Promise<Bounds | null> {
  try {
    return await invoke<Bounds>("window_get_bounds");
  } catch {
    return null;
  }
}

/** 26px ghost icon button for the header's right cluster. Kept dumb — the
 *  active state rides on the icon itself (e.g. the pin fills amber). */
function HeaderIconButton({
  title, onClick, children,
}: {
  title: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" title={title} className={HEADER_BUTTON_CLASS} onClick={onClick}>
      {children}
    </button>
  );
}

/** Header-left color dot: a 16px swatch of the note's color that opens a
 *  popover with the full seven-color palette (active = dark ring). */
function ColorDotMenu({
  color, onPick,
}: {
  color: string; onPick: (colorId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Trigger and popover both live in this wrapper, so outside-press dismissal
  // needs no separate ignore ref — the trigger keeps its natural toggle.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideClick(wrapRef, open, () => setOpen(false));

  return (
    <div className="relative flex items-center" ref={wrapRef}>
      <button
        type="button"
        title={t("sticky.color")}
        className={HEADER_BUTTON_CLASS}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="block size-4 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.2)]"
          style={{ backgroundColor: stickyColorHex(color) }}
        />
      </button>
      {open && (
        <div className="app-region-no-drag absolute top-full left-0 z-50 mt-1.5 rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg">
          <div className="flex gap-1.5">
            {STICKY_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.id}
                className={`size-4 rounded-full ${color === c.id ? "ring-2 ring-black/50" : "ring-1 ring-black/10"}`}
                style={{ backgroundColor: c.hex }}
                onClick={() => {
                  setOpen(false);
                  onPick(c.id);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The 6px save-status dot beside the header's close button: amber and
 *  pulsing while a save is pending/in flight, emerald briefly after a save
 *  lands, then fading out completely. */
function SaveDot({
  saved, flash, failed, onRetry,
}: {
  saved: boolean; flash: boolean; failed: boolean; onRetry: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      title={failed ? t("sticky.retrySave") : saved ? t("sticky.saved") : t("sticky.saving")}
      disabled={!failed}
      onClick={onRetry}
      className="app-region-no-drag mr-0.5 flex size-4 shrink-0 items-center justify-center"
    >
      <span className={`size-1.5 rounded-full transition-opacity duration-700 ${
        failed
          ? "bg-red-600"
          : !saved
            ? "animate-pulse bg-amber-500"
          : flash
            ? "bg-emerald-500 opacity-100"
            : "bg-emerald-500 opacity-0"
      }`} />
    </button>
  );
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
  /** Global "sticky_translucent" setting ("1" → the note color renders at
   *  60% alpha + backdrop blur). Read once at load; this window carries no
   *  toggle of its own — another surface owns the switch. */
  const [translucent, setTranslucent] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Popovers dismiss on any outside pointer press. The trigger sits inside
  // the wrapper with its menu, so its natural toggle survives the dismissal.
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideClick(moreMenuRef, showMore, () => setShowMore(false));
  const [saved, setSaved] = useState(true);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedWordCount, setSavedWordCount] = useState<number | null>(null);
  /** Briefly true after a save lands — drives the emerald dot's fade-out. */
  const [saveFlash, setSaveFlash] = useState(false);

  const editorApi = useRef<DocEditorApi | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** The live Tiptap editor, captured through `toolbarExtras` (the sanctioned
   *  render prop that receives the instance) for the fixed toolbar row. */
  const [toolbarEditor, setToolbarEditor] = useState<TiptapEditor | null>(null);
  const dirty = useRef(false);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsedH = useRef<number | null>(null); // expanded height while collapsed
  const collapsedRef = useRef(false);
  const closingRef = useRef(false);
  const backendCredentials = useRef<{ origin: string; token: string } | null>(null);

  useEffect(() => {
    void Promise.all([backendOrigin(), backendToken()])
      .then(([origin, token]) => { backendCredentials.current = { origin, token }; })
      .catch(() => {});
  }, []);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    void useSettingsStore.getState().loadFromDB();
    if (!id) {
      setMissing(true);
      setLoading(false);
      return;
    }
    void (async () => {
      // Translucency is a global app setting ("sticky_translucent"): "1"
      // composes the note color at 60% alpha over a backdrop blur.
      try {
        const raw = await invoke<string | null>("db_get_setting", { key: "sticky_translucent" });
        setTranslucent(raw === "1");
      } catch {
        // Keep the default (solid pastel).
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
    collapsedRef.current = detail.collapsed;
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
  const flushSave = useCallback((): Promise<boolean> => {
    if (saveInFlight.current) return saveInFlight.current;
    if (!dirty.current) return Promise.resolve(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    saveTimer.current = null;
    maxSaveTimer.current = null;
    const run = async () => {
      while (dirty.current) {
        const api = editorApi.current;
        if (!api) return false;
        dirty.current = false;
        const { content, contentText, wordCount } = blocksToStorage(api.document);
        try {
          await invoke("sticky_save_content", { id, content, contentText, wordCount });
        } catch {
          dirty.current = true;
          setSaved(false);
          setSaveFailed(true);
          return false;
        }
        if (!dirty.current) {
          setSaved(true);
          setSaveFailed(false);
          setSavedWordCount(wordCount);
          setTitle(stickyDerivedTitle(contentText));
          setSaveFlash(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setSaveFlash(false), SAVE_FLASH_MS);
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
  }, [id]);

  useEffect(() => {
    const host = window as Window & { __tanwordsFlushSticky?: () => Promise<boolean> };
    host.__tanwordsFlushSticky = flushSave;
    return () => { delete host.__tanwordsFlushSticky; };
  }, [flushSave]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaved(false);
    setSaveFailed(false);
    setSaveFlash(false);
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
    if (!maxSaveTimer.current) {
      // Someone typing without pausing still saves periodically.
      maxSaveTimer.current = setTimeout(() => void flushSave(), SAVE_MAX_INTERVAL_MS);
    }
  }, [flushSave]);

  // A normal close awaits flushSave. This is a last net for an unexpected
  // window teardown: credentials are already cached because unload cannot
  // wait for the async sidecar handshake.
  useEffect(() => {
    const handler = () => {
      try {
        if ((!dirty.current && !saveInFlight.current) || !editorApi.current || !backendCredentials.current) return;
        const { content, contentText, wordCount } = blocksToStorage(editorApi.current.document);
        const { origin, token } = backendCredentials.current;
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${origin}/invoke/sticky_save_content`, false);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify({ id, content, contentText, wordCount }));
      } catch {
        // Best-effort by design — the debounced saves are the real net.
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [id]);

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
      x: bounds.x, y: bounds.y, w: bounds.width,
      h: collapsedRef.current ? (collapsedH.current ?? 480) : bounds.height,
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

  const collapseBusy = useRef(false);
  const toggleCollapse = useCallback(() => {
    if (collapseBusy.current) return;
    collapseBusy.current = true;
    void (async () => {
      try {
        const bounds = await windowBounds();
        if (!bounds) return;
        const nextCollapsed = !collapsedRef.current;
        const expandedHeight = nextCollapsed ? bounds.height : (collapsedH.current ?? 480);
        if (nextCollapsed) collapsedH.current = expandedHeight;
        await invoke("stickywin_set_bounds", {
          ...bounds, height: nextCollapsed ? STICKY_HEADER_HEIGHT : expandedHeight,
        });
        collapsedRef.current = nextCollapsed;
        setCollapsed(nextCollapsed);
        await invoke("sticky_update_window_state", {
          id, x: bounds.x, y: bounds.y, w: bounds.width,
          h: expandedHeight, collapsed: nextCollapsed,
        });
      } catch {
        // Keep the current UI state when the window could not be resized.
      } finally {
        collapseBusy.current = false;
      }
    })();
  }, [id]);

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
    setTitle(next || stickyDerivedTitle(blocksToStorage(editorApi.current?.document ?? blocks ?? []).contentText));
    // Blank clears the rename: core re-derives from the body and flags it off.
    void invoke("sticky_set_title", { id, title: next }).catch(() => {});
  }, [blocks, customTitle, id, renameDraft]);

  const displayTitle = customTitle ?? title;

  // ── Close ───────────────────────────────────────────────────────────────
  const closeNote = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    void (async () => {
      try {
        if (!await flushSave()) return;
        await persistGeometry({ collapsed }).catch(() => {});
        await invoke("sticky_update_window_state", { id, is_open: false }).catch(() => {});
        await invoke("stickywin_close", { id }).catch(() => {});
      } finally {
        closingRef.current = false;
      }
    })();
  }, [collapsed, flushSave, id, persistGeometry]);

  useEffect(() => subscribe<{ id: number }>("stickywin:requestClose", ({ id: target }) => {
    if (target === id) closeNote();
  }), [closeNote, id]);

  // Move to Trash (manager parity): flush first so the trashed note keeps
  // the latest content for a faithful restore, then run the same ordered
  // close sequence as the X button.
  const deleteNote = useCallback(() => {
    void (async () => {
      if (!await flushSave()) return;
      await invoke("sticky_delete", { id }).catch(() => {});
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
      const portable = lowerYouTube(lowerMedia(lowerMermaid(editorApi.current.document))) as Block[];
      const markdown = await blocksToMarkdownOffThread(portable);
      await navigator.clipboard.writeText(markdown);
      setShowMore(false);
    } catch {
      // Clipboard denied — nothing to report into a sticky.
    }
  }, []);

  const pasteMarkdown = useCallback(async (markdown: string) => {
    return toolbarEditor ? insertRenderedMarkdown(toolbarEditor, markdown) : false;
  }, [toolbarEditor]);

  const pasteMarkdownFromClipboard = useCallback(async () => {
    try {
      await pasteMarkdown(await callMain<string>("clipboard:readText"));
    } catch {
      // A denied or empty clipboard leaves the editor untouched.
    }
  }, [pasteMarkdown]);

  const copyAsImage = useCallback(async () => {
    setShowMore(false);
    // Main captures by temporarily growing the window to the FULL content
    // height (capturePage only rasterises the viewport), so hand it the
    // complete page height: everything above the scroller (header/toolbar)
    // + the scrolled content + padding below.
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
      <div className="flex h-screen w-screen items-center justify-center p-4">
        <div className="app-region-no-drag rounded-2xl border border-black/10 bg-white/95 p-6 text-center shadow-xl">
          <p className="text-sm text-neutral-700">{t("sticky.gone")}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700"
            onClick={() => window.close()}
          >
            {t("sticky.goneClose")}
          </button>
        </div>
      </div>
    );
  }

  const editorFont = fontFamily ?? undefined;

  return (
    <div className="relative h-screen w-screen">
      <div
        className={`app-region-no-drag flex h-full w-full flex-col overflow-hidden ${stickyCornerClass(corner)} transition-colors ${translucent ? "backdrop-blur-md" : ""} ${collapsed ? "" : "select-none"}`}
        style={{
          // Translucent composes over the shared surface style: same color
          // and hairline ring, backgroundColor overridden to 60% alpha.
          ...stickySurfaceStyle(color, translucent ? 60 : opacity),
          color: "#1f2937",
        }}
      >
        {/* Header: 44px drag bar with room to grab between the controls. */}
        <div
          className="app-drag-region flex shrink-0 items-center gap-0.5 pl-1.5"
          style={{ height: STICKY_HEADER_HEIGHT }}
        >
          <ColorDotMenu
            color={color}
            onPick={(nextColor) => {
              setColor(nextColor);
              void updateMeta({ color: nextColor });
            }}
          />
          <div className="min-w-0 flex-1 px-2">
            {collapsed && <span className="pointer-events-none block truncate text-center text-[13px] font-semibold">{displayTitle || t("sticky.untitled")}</span>}
          </div>
          <HeaderIconButton title={t("sticky.alwaysOnTop")} onClick={togglePin}>
            <Pin className={`size-4 ${alwaysOnTop ? "fill-amber-500 text-amber-500" : ""}`} />
          </HeaderIconButton>
          <HeaderIconButton title={collapsed ? t("sticky.expand") : t("sticky.collapse")} onClick={toggleCollapse}>
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </HeaderIconButton>
          <div className="relative flex items-center" ref={moreMenuRef}>
            <button
              type="button"
              title={t("sticky.more")}
              className={HEADER_BUTTON_CLASS}
              onClick={() => setShowMore((v) => !v)}
            >
              <EllipsisVertical className="size-4" />
            </button>
            {showMore && (
              <div className="app-region-no-drag absolute top-full right-0 z-50 mt-1.5 w-48 rounded-xl border border-black/10 bg-white/95 py-1 shadow-lg">
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => { setShowMore(false); setShowFind(true); }}
                >
                  <Search className="size-3.5" />
                  <span className="flex-1 text-left">{t("sticky.menuFind")}</span>
                  <span className="text-[10px] text-neutral-400">{IS_MAC ? "⌘F" : "Ctrl+F"}</span>
                </button>
                {/* Translucent-paper toggle — the only writer of the
                 * "sticky_translucent" setting; the menu stays open on flip so
                 * the effect is visible immediately. */}
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    const next = !translucent;
                    setTranslucent(next);
                    void invoke("db_set_setting", { key: "sticky_translucent", value: next ? "1" : "0" }).catch(() => {});
                  }}
                >
                  <Layers className="size-3.5" />
                  <span className="flex-1 text-left">{t("sticky.translucent")}</span>
                  <span className={`h-3.5 w-6 rounded-full p-0.5 transition-colors ${translucent ? "bg-amber-500" : "bg-black/20"}`}>
                    <span className={`block size-2.5 rounded-full bg-white transition-transform ${translucent ? "translate-x-2.5" : ""}`} />
                  </span>
                </button>
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => { setShowMore(false); void invoke("stickywin_print").catch(() => {}); }}
                >
                  <Printer className="size-3.5" />
                  <span className="flex-1 text-left">{t("sticky.print")}</span>
                </button>
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => void copyAsMarkdown()}
                >
                  <ClipboardCopy className="size-3.5" />
                  <span className="flex-1 text-left">{t("sticky.copyMarkdown")}</span>
                </button>
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => { setShowMore(false); void pasteMarkdownFromClipboard(); }}
                >
                  <ClipboardPaste className="size-3.5" />
                  <span className="flex-1 text-left">{t("sticky.pasteMarkdown")}</span>
                </button>
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => void copyAsImage()}
                >
                  <Copy className="size-3.5" />
                  <span className="flex-1 text-left">{t("sticky.copyImage")}</span>
                </button>
                <div className="my-1 h-px bg-black/10" />
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-neutral-400 uppercase">
                  {t("sticky.font")}
                </div>
                {FONT_CHOICES.map((choice) => (
                  <button
                    key={choice.size}
                    type="button"
                    className={MENU_ITEM_CLASS}
                    onClick={() => {
                      setFontSize(choice.size);
                      void updateMeta({ font_size: choice.size });
                      setShowMore(false);
                    }}
                  >
                    <span className="flex-1 text-left">{t(choice.key)}</span>
                    {(fontSize ?? 16) === choice.size && <Check className="size-3.5 text-neutral-700" />}
                  </button>
                ))}
                <div className="my-1 h-px bg-black/10" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => { setShowMore(false); setConfirmingDelete(true); }}
                >
                  <Trash2 className="size-3.5" />
                  <span className="flex-1 text-left">{t("sticky.delete")}</span>
                </button>
              </div>
            )}
          </div>
          <SaveDot saved={saved} flash={saveFlash} failed={saveFailed} onRetry={() => void flushSave()} />
          <button
            type="button"
            title={t("sticky.close")}
            className="app-region-no-drag flex size-11 shrink-0 items-center justify-center self-stretch transition-colors hover:bg-black/10"
            onClick={closeNote}
          >
            <X className="size-4" />
          </button>
        </div>

        {!collapsed && (
          <div className="app-region-no-drag flex h-8 shrink-0 items-center px-3 pb-1">
            {renaming ? (
              <input
                autoFocus
                value={renameDraft}
                placeholder={t("sticky.renameTitle")}
                className="w-full min-w-0 rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-[12px] text-neutral-900 outline-none focus:border-neutral-500"
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <button
                type="button"
                className="w-full min-w-0 cursor-text truncate rounded-sm text-left text-[13px] font-semibold leading-none focus-visible:outline-2 focus-visible:outline-neutral-700"
                title={displayTitle || undefined}
                aria-label={t("sticky.renameTitle")}
                onClick={() => {
                  setRenameDraft(displayTitle);
                  setRenaming(true);
                }}
              >
                {displayTitle || t("sticky.untitled")}
              </button>
            )}
          </div>
        )}

        {showFind && !collapsed && (
          <StickyFindBar editor={toolbarEditor} onClose={() => setShowFind(false)} />
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
                onPasteMarkdown={pasteMarkdown}
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
                <div className="flex min-h-full items-center justify-center py-4">
                  <div className="w-full max-w-60 rounded-2xl border border-black/10 bg-white/95 p-4 text-center shadow-lg">
                    <Lock className="mx-auto size-5 text-neutral-500" />
                    <p className="mt-2 text-xs text-neutral-600">{t("sticky.locked")}</p>
                    <div className="mt-3 flex items-center gap-1.5">
                      <input
                        type="password"
                        value={unlockPassword}
                        onChange={(e) => setUnlockPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }}
                        className="app-region-no-drag min-w-0 flex-1 rounded-full border border-black/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-black/40"
                        placeholder="••••••"
                        autoFocus
                      />
                      <button
                        type="button"
                        title={t("sticky.open")}
                        className="app-region-no-drag shrink-0 rounded-full bg-neutral-900 p-2 text-white transition-colors hover:bg-neutral-700"
                        onClick={() => void unlock()}
                      >
                        <Unlock className="size-3.5" />
                      </button>
                    </div>
                  </div>
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

        {/* Word count: tiny corner pill (the save state lives in the header
            dot — there is no footer bar). */}
        {!collapsed && saved && savedWordCount !== null && savedWordCount > 0 && (
          <div className="pointer-events-none absolute right-3 bottom-1.5 text-[10px] text-neutral-700 opacity-50">
            {t("sticky.words", { n: savedWordCount })}
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmingDelete}
        title={t("sticky.deleteConfirmTitle")}
        message={t("sticky.deleteConfirmMessage")}
        confirmLabel={t("sticky.delete")}
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteNote();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />

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
