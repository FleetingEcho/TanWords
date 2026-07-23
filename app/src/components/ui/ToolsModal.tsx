import React, { useEffect, useRef, useState } from "react";
import { useToolsBallStore } from "@/store/toolsBallStore";
import { useNavStore } from "@/store/navStore";
import { useSelectedWordStore } from "@/store/selectedWordStore";
import { useDocumentEditor } from "@/components/Documents/useDocumentEditor";
import { useAiChatSession } from "@/components/AiChat/useAiChatSession";
import { ChatSessionItem } from "@/hooks/useDB";
import { useDB } from "@/hooks/useDB";
import { ToolsModalTitleBar } from "@/components/ui/ToolsModalTitleBar";
import { ToolsModalDocumentsTab } from "@/components/ui/ToolsModalDocumentsTab";
import { ToolsModalChatTab } from "@/components/ui/ToolsModalChatTab";
import { ToolsModalWordTab } from "@/components/ui/ToolsModalWordTab";
import { ToolsModalResizeHandle } from "@/components/ui/ToolsModalResizeHandle";

const MIN_W = 500;
const MIN_H = 400;
const DRAG_THRESHOLD = 5;

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

/** Draggable + resizable modal with always-mounted tabs: Documents (DocSelector
 *  + BlockNote editor), AI Chat (minimal session selector + message area +
 *  composer), and — only while on the Vocabulary page — Word chat/notes for
 *  the currently selected word. Content is globally cached — closing and
 *  reopening preserves all state. This component is the composition root;
 *  each tab's body and the title bar live in sibling ToolsModal* files. */
export function ToolsModal() {
  const isOpen = useToolsBallStore((s) => s.isOpen);
  const activeTab = useToolsBallStore((s) => s.activeTab);
  const setActiveTab = useToolsBallStore((s) => s.setActiveTab);
  const closeModal = useToolsBallStore((s) => s.closeModal);
  const modalPos = useToolsBallStore((s) => s.modalPos);
  const setModalPos = useToolsBallStore((s) => s.setModalPos);
  const modalSize = useToolsBallStore((s) => s.modalSize);
  const setModalSize = useToolsBallStore((s) => s.setModalSize);

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

  // ── Document editor (always mounted) ─────────────────────────────────────
  const docEditor = useDocumentEditor();

  // ── AI Chat session (always mounted, independent from full-page AiChatPage)
  const chat = useAiChatSession();

  // ── Word-chat tab (Vocabulary page only) ─────────────────────────────────
  const isVocabPage = useNavStore((s) => s.currentPage()) === "vocabulary";
  const selectedWord = useSelectedWordStore();

  // Fall back to another tab if the user leaves the Vocabulary page while on "word"
  useEffect(() => {
    if (!isVocabPage && activeTab === "word") setActiveTab("documents");
  }, [isVocabPage, activeTab, setActiveTab]);

  // ── Session selector ─────────────────────────────────────────────────────
  const db = useDB();
  const [allSessions, setAllSessions] = useState<ChatSessionItem[]>([]);

  useEffect(() => {
    db.listChatSessions(0, 200).then(setAllSessions);
    // Refresh when the modal opens
    if (isOpen) db.listChatSessions(0, 200).then(setAllSessions);
  }, [isOpen]);

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

  // ── Drag handlers ────────────────────────────────────────────────────────
  const onTitlePointerDown = (e: React.PointerEvent) => {
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
    setModalPos(pos);
  };

  const onTitlePointerUp = () => {
    dragRef.current = null;
    setDragging(false);
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
    setModalSize(size);
  };

  const onResizePointerUp = () => {
    resizeRef.current = null;
    setResizing(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  // Always render content so hooks stay alive (global state caching).
  // When closed, the overlay is hidden but all state is preserved.

  return (
    <div className={`fixed inset-0 z-100 ${isOpen ? "" : "pointer-events-none"}`} style={{ visibility: isOpen ? "visible" : "hidden" }}>
      {/* Backdrop */}
      <div className={`absolute inset-0 bg-black/20 transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`} onClick={closeModal} />

      {/* Modal panel */}
      <div
        className={`absolute bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden
          ${resizing ? "select-none" : ""}
          ${dragging ? "cursor-grabbing" : ""}`}
        style={{
          left: modalPos.x,
          top: modalPos.y,
          width: modalSize.width,
          height: modalSize.height,
          transition: dragging || resizing ? "none" : "left 0.15s ease, top 0.15s ease, width 0.15s ease, height 0.15s ease",
        }}
      >
        <ToolsModalTitleBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isVocabPage={isVocabPage}
          chat={chat}
          allSessions={allSessions}
          closeModal={closeModal}
          dragging={dragging}
          onTitlePointerDown={onTitlePointerDown}
          onTitlePointerMove={onTitlePointerMove}
          onTitlePointerUp={onTitlePointerUp}
        />

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ToolsModalDocumentsTab active={activeTab === "documents"} docEditor={docEditor} />
          <ToolsModalChatTab active={activeTab === "chat"} chat={chat} />
          {isVocabPage && (
            <ToolsModalWordTab active={activeTab === "word"} selectedWord={selectedWord} />
          )}
        </div>

        <ToolsModalResizeHandle
          onResizePointerDown={onResizePointerDown}
          onResizePointerMove={onResizePointerMove}
          onResizePointerUp={onResizePointerUp}
        />
      </div>
    </div>
  );
}
