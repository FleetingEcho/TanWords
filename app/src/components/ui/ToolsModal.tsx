import React, { useEffect, useRef, useState } from "react";
import { useToolsBallStore } from "@/store/toolsBallStore";
import { useNavStore } from "@/store/navStore";
import { useSelectedWordStore } from "@/store/selectedWordStore";
import { ToolsModalTitleBar, type ToolsModalTab } from "@/components/ui/ToolsModalTitleBar";
import { ToolsModalWordTab } from "@/components/ui/ToolsModalWordTab";
import { ToolsModalResizeHandle } from "@/components/ui/ToolsModalResizeHandle";
import { BrowserPanelBlocker } from "@/store/browserPanelStore";
import { DshPanelBlocker } from "@/store/dshPanelBlockStore";

const DocumentsPage = React.lazy(() =>
  import("@/components/Documents/DocumentsPage").then((m) => ({ default: m.DocumentsPage })));
const AiChatPage = React.lazy(() =>
  import("@/components/AiChat/AiChatPage").then((m) => ({ default: m.AiChatPage })));
const PageFallback = () => (
  <div className="h-full flex items-center justify-center">
    <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

const MIN_W = 500;
const MIN_H = 400;
const DRAG_THRESHOLD = 5;
/** Gap the maximized panel keeps from the viewport edges. */
const MAX_MARGIN = 10;

function clampPos(
  x: number, y: number,
  w: number, h: number,
  vw: number, vh: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, vw - Math.min(w, vw - 40))) + 20,
    y: Math.max(0, Math.min(y, vh - Math.min(h, vh - 60))) + 20,
  };
}

function clampSize(
  w: number, h: number,
  vw: number, vh: number,
): { width: number; height: number } {
  return {
    width: Math.max(MIN_W, Math.min(w, vw - 40)),
    height: Math.max(MIN_H, Math.min(h, vh - 60)),
  };
}

/** Draggable + resizable + maximizable modal hosting the real full pages:
 *  Documents (database docs + local folder) and AI Chat (with session
 *  history sidebar), plus — only while on the Vocabulary page — Word
 *  chat/notes for the currently selected word.
 *
 *  Content mounts on first open and unmounts on close. Mounting the pages
 *  permanently would double-run their DB queries and global event listeners
 *  whenever the user is also *on* one of those pages; everything that
 *  matters (docs, chat sessions) is DB-persisted, so a remount on reopen
 *  restores the same state anyway. Within one open, inactive tabs are kept
 *  mounted (display:none) so switching tabs doesn't lose scroll/drafts. */
export function ToolsModal() {
  const isOpen = useToolsBallStore((s) => s.isOpen);
  const activeTab = useToolsBallStore((s) => s.activeTab);
  const setActiveTab = useToolsBallStore((s) => s.setActiveTab);
  const closeModal = useToolsBallStore((s) => s.closeModal);
  const modalPos = useToolsBallStore((s) => s.modalPos);
  const setModalPos = useToolsBallStore((s) => s.setModalPos);
  const modalSize = useToolsBallStore((s) => s.modalSize);
  const setModalSize = useToolsBallStore((s) => s.setModalSize);
  const maximized = useToolsBallStore((s) => s.maximized);
  const toggleMaximized = useToolsBallStore((s) => s.toggleMaximized);

  // ── Drag state ───────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number; startY: number;
    origX: number; origY: number;
    moved: boolean;
  } | null>(null);

  // ── Resize state ─────────────────────────────────────────────────────────
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{
    startX: number; startY: number;
    origW: number; origH: number;
  } | null>(null);

  // ── Lazy per-tab mounting within one open ────────────────────────────────
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!isOpen) {
      setMountedTabs(new Set());
      return;
    }
    setMountedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [isOpen, activeTab]);

  // ── Word-chat tab (Vocabulary page only) ─────────────────────────────────
  const isVocabPage = useNavStore((s) => s.currentPage()) === "vocabulary";
  const selectedWord = useSelectedWordStore();

  // When the main window is already ON a page the modal hosts, mounting that
  // page inside the modal puts two live DocumentsPage/AiChatPage instances
  // side by side — two useDocumentEditor editors with independent save
  // queues, where the last autosave silently wins over the other's edits.
  // Hide those tabs outright in that case (the page itself is behind the
  // modal anyway).
  const isDocumentsPage = useNavStore((s) => s.currentPage()) === "documents";
  const isChatPage = useNavStore((s) => s.currentPage()) === "chat";

  // Fall back to another tab if the user leaves the Vocabulary page while on "word"
  useEffect(() => {
    if (!isVocabPage && activeTab === "word") setActiveTab("documents");
  }, [isVocabPage, activeTab, setActiveTab]);

  useEffect(() => {
    if (isDocumentsPage && activeTab === "documents") setActiveTab("chat");
    else if (isChatPage && activeTab === "chat") setActiveTab("documents");
  }, [isDocumentsPage, isChatPage, activeTab, setActiveTab]);

  // ── Esc to close ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeModal]);

  // ── Window resize clamping ───────────────────────────────────────────────
  const modalPosRef = useRef(modalPos);
  const modalSizeRef = useRef(modalSize);
  modalPosRef.current = modalPos;
  modalSizeRef.current = modalSize;

  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => {
      const pos = clampPos(modalPosRef.current.x - 20, modalPosRef.current.y - 20, modalSizeRef.current.width, modalSizeRef.current.height, window.innerWidth, window.innerHeight);
      const size = clampSize(modalSizeRef.current.width, modalSizeRef.current.height, window.innerWidth, window.innerHeight);
      setModalPos(pos);
      setModalSize(size);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, setModalPos, setModalSize]);

  // ── Drag handlers (no-op while maximized) ────────────────────────────────
  const onTitlePointerDown = (e: React.PointerEvent) => {
    if (maximized) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: modalPos.x, origY: modalPos.y,
      moved: false,
    };
  };

  const onTitlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    const pos = clampPos(d.origX + dx, d.origY + dy, modalSize.width, modalSize.height, window.innerWidth, window.innerHeight);
    setModalPos(pos, false);
  };

  const onTitlePointerUp = () => {
    dragRef.current = null;
    setDragging(false);
    setModalPos(useToolsBallStore.getState().modalPos);
  };

  // ── Resize handlers ──────────────────────────────────────────────────────
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      origW: modalSize.width, origH: modalSize.height,
    };
  };

  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setResizing(true);
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;
    const newW = r.origW + dx;
    const newH = r.origH + dy;
    const size = clampSize(newW, newH, window.innerWidth, window.innerHeight);
    setModalSize(size, false);
  };

  const onResizePointerUp = () => {
    resizeRef.current = null;
    setResizing(false);
    setModalSize(useToolsBallStore.getState().modalSize);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-10">
      {/* Native browser/DSH panels must step aside — see browserPanelStore / dshPanelBlockStore. */}
      <BrowserPanelBlocker />
      <DshPanelBlocker />
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={closeModal} />

      {/* Modal panel */}
      <div
        className={`absolute bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden
          ${resizing ? "select-none" : ""}
          ${dragging ? "cursor-grabbing" : ""}`}
        style={
          maximized
            ? { left: MAX_MARGIN, top: MAX_MARGIN, right: MAX_MARGIN, bottom: MAX_MARGIN }
            : {
                left: modalPos.x,
                top: modalPos.y,
                width: modalSize.width,
                height: modalSize.height,
                transition: dragging || resizing ? "none" : "left 0.15s ease, top 0.15s ease, width 0.15s ease, height 0.15s ease",
              }
        }
      >
        <ToolsModalTitleBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isVocabPage={isVocabPage}
          hiddenTabs={(isDocumentsPage ? ["documents"] : []).concat(isChatPage ? ["chat"] : []) as ToolsModalTab[]}
          closeModal={closeModal}
          maximized={maximized}
          toggleMaximized={toggleMaximized}
          dragging={dragging}
          onTitlePointerDown={onTitlePointerDown}
          onTitlePointerMove={onTitlePointerMove}
          onTitlePointerUp={onTitlePointerUp}
        />

        {/* ── Body: the real pages, shown/hidden per tab ──────────────────── */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {!isDocumentsPage && mountedTabs.has("documents") && (
            <div style={{ display: activeTab === "documents" ? "block" : "none", height: "100%" }}>
              <React.Suspense fallback={<PageFallback />}>
                <DocumentsPage />
              </React.Suspense>
            </div>
          )}
          {!isChatPage && mountedTabs.has("chat") && (
            <div style={{ display: activeTab === "chat" ? "block" : "none", height: "100%" }}>
              <React.Suspense fallback={<PageFallback />}>
                <AiChatPage />
              </React.Suspense>
            </div>
          )}
          {isVocabPage && mountedTabs.has("word") && (
            <ToolsModalWordTab active={activeTab === "word"} selectedWord={selectedWord} />
          )}
        </div>

        {!maximized && (
          <ToolsModalResizeHandle
            onResizePointerDown={onResizePointerDown}
            onResizePointerMove={onResizePointerMove}
            onResizePointerUp={onResizePointerUp}
          />
        )}
      </div>
    </div>
  );
}
