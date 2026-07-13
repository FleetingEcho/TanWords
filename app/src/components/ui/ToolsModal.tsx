import React, { useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { useToolsBallStore } from "@/store/toolsBallStore";
import { DocSelector } from "@/components/Documents/DocSelector";
import { LazyDocEditor } from "@/components/Documents/LazyDocEditor";
import { useDocumentEditor } from "@/components/Documents/useDocumentEditor";
import { MessageBubble } from "@/components/AiChat/MessageBubble";
import { ToolCallCard } from "@/components/AiChat/ToolCallCard";
import { VocabExtractionCard, ExtractedVocabItem } from "@/components/AiChat/VocabExtractionCard";
import { AiChatComposer } from "@/components/AiChat/AiChatComposer";
import { useAiChatSession, PRESET_IDS } from "@/components/AiChat/useAiChatSession";
import { ChatSessionItem } from "@/hooks/useDB";
import { useDB } from "@/hooks/useDB";

const MIN_W = 500;
const MIN_H = 400;
const DRAG_THRESHOLD = 5;
const RESIZE_HANDLE = 16;

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

/** Draggable + resizable modal with two always-mounted tabs:
 *  Documents (DocSelector + BlockNote editor) and AI Chat (minimal session
 *  selector + message area + composer). Content is globally cached — closing
 *  and reopening preserves all state. */
export function ToolsModal() {
  const t = useT();
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

  // Auto-create a new doc on first open if nothing loaded.
  const prevDocOpen = useRef(false);
  useEffect(() => {
    if (isOpen && activeTab === "documents" && docEditor.doc === null && docEditor.activeId === null && !prevDocOpen.current) {
      docEditor.handleNewDoc();
      prevDocOpen.current = true;
    }
    if (!isOpen) prevDocOpen.current = false;
  }, [isOpen, activeTab]);

  // ── AI Chat session (always mounted, independent from full-page AiChatPage)
  const chat = useAiChatSession();

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
    <div className={`fixed inset-0 z-40 ${isOpen ? "" : "pointer-events-none"}`} style={{ visibility: isOpen ? "visible" : "hidden" }}>
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
        {/* Title bar — draggable handle */}
        <div
          className={`flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border select-none ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
          onPointerCancel={onTitlePointerUp}
        >
          {/* Drag handle dots */}
          <svg viewBox="0 0 12 12" fill="currentColor" className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 pointer-events-none">
            <circle cx="3" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" />
            <circle cx="3" cy="6" r="1.2" /><circle cx="9" cy="6" r="1.2" />
            <circle cx="3" cy="9" r="1.2" /><circle cx="9" cy="9" r="1.2" />
          </svg>

          {/* Tabs */}
          <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab("documents"); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === "documents"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("tools.documents")}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab("chat"); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === "chat"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("tools.chat")}
            </button>
          </div>

          {/* AI Chat controls (only visible on chat tab) */}
          {activeTab === "chat" && (
            <div className="flex items-center gap-1.5 ml-2" onPointerDown={(e) => e.stopPropagation()}>
              {/* Session selector dropdown */}
              <select
                value={chat.activeId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id && id !== chat.activeId) chat.switchSession(id);
                }}
                className="h-7 px-2 text-[10px] rounded-lg border border-input bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 max-w-[130px]"
              >
                {allSessions.length === 0 && <option value="" disabled>{t("aichat.newChat")}</option>}
                {allSessions.map((s) => (
                  <option key={s.id} value={s.id}>{s.title || t("aichat.newChat")}</option>
                ))}
                {chat.activeId && !allSessions.find((s) => s.id === chat.activeId) && (
                  <option value={chat.activeId}>{chat.activeTitle || t("aichat.newChat")}</option>
                )}
              </select>
              <button
                onClick={() => chat.startNew()}
                className="h-7 px-2.5 rounded-lg text-[10px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors whitespace-nowrap"
              >
                {t("tools.newChat")}
              </button>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Close button */}
          <button
            onClick={(e) => { e.stopPropagation(); closeModal(); }}
            title={t("tools.close")}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {/* Documents tab */}
          <div style={{ display: activeTab === "documents" ? "flex" : "none", height: "100%" }} className="overflow-hidden">
            {/* DocSelector sidebar */}
            <div className="shrink-0 h-full border-r border-border">
              <DocSelector
                activeId={docEditor.activeId}
                onSelect={docEditor.loadDoc}
                onNewDoc={docEditor.handleNewDoc}
                refreshKey={docEditor.refreshKey}
              />
            </div>
            {/* Editor area */}
            <div className="flex-1 min-w-0 overflow-hidden">
              {docEditor.doc ? (
                <LazyDocEditor
                  key={docEditor.doc.id}
                  doc={docEditor.doc}
                  onSave={docEditor.handleSave}
                  onTitleChange={docEditor.handleTitleChange}
                  onTagsChange={docEditor.handleTagsChange}
                  onPinToggle={docEditor.handlePinToggle}
                  saveStatus={docEditor.saveStatus}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <p className="text-sm">{t("doc.noDocSelected")}</p>
                  <p className="text-xs opacity-60">{t("doc.noDocHint")}</p>
                </div>
              )}
            </div>
          </div>

          {/* AI Chat tab */}
          <div style={{ display: activeTab === "chat" ? "flex" : "none", height: "100%" }} className="flex-col overflow-hidden">
            {/* Top bar: preset + provider + settings */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border shrink-0" onPointerDown={(e) => e.stopPropagation()}>
              <select
                value={chat.selectedPreset}
                onChange={(e) => chat.setSelectedPreset(e.target.value)}
                className="h-6 px-1.5 text-[10px] rounded border border-input bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                {PRESET_IDS.map((id) => (
                  <option key={id} value={id}>{t(`aichat.preset.${id}`)}</option>
                ))}
              </select>
              <select
                value={chat.selectedProviderId}
                onChange={(e) => chat.setSelectedProviderId(e.target.value)}
                className="h-6 px-1.5 text-[10px] rounded border border-input bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 max-w-[140px]"
              >
                {chat.providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.modelId}</option>)}
                {chat.providers.length === 0 && <option disabled>{t("aichat.noProvider")}</option>}
              </select>
              {chat.displayItems.length > 0 && (
                <button onClick={chat.clearMessages} className="ml-auto px-2 h-6 text-[10px] text-muted-foreground hover:text-destructive hover:bg-muted rounded transition-colors shrink-0">
                  {t("aichat.clear")}
                </button>
              )}
            </div>

            {/* Custom system prompt */}
            {chat.selectedPreset === "custom" && (
              <div className="shrink-0 border-b border-border px-3 py-2" onPointerDown={(e) => e.stopPropagation()}>
                <textarea
                  value={chat.customPrompt}
                  onChange={(e) => chat.setCustomPrompt(e.target.value)}
                  placeholder={t("aichat.customPromptPlaceholder")}
                  rows={2}
                  className="w-full resize-none px-2.5 py-1.5 text-[11px] rounded-lg border border-input bg-background placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 leading-relaxed"
                />
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {chat.displayItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground/80">{t("aichat.emptyTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("aichat.emptyHint")}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 w-full max-w-[360px]">
                    {chat.QUICK_CARDS.map((c) => (
                      <button
                        key={c.titleKey}
                        onClick={() => chat.applyQuickCard(c.prefillKey)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-card text-left hover:border-primary/40 hover:bg-muted/40 transition-colors"
                      >
                        <c.icon className="w-3.5 h-3.5 text-primary" />
                        <span className="text-[11px] font-medium">{t(c.titleKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chat.displayItems.map((item, idx) => {
                  if (item.kind === "tool_block") {
                    const extractCalls = item.calls.filter((c) => c.name === "extract_vocabulary");
                    const otherCalls = item.calls.filter((c) => c.name !== "extract_vocabulary");
                    return (
                      <React.Fragment key={idx}>
                        {extractCalls.map((c) => (
                          <VocabExtractionCard
                            key={c.id}
                            items={((c.input.items as ExtractedVocabItem[]) ?? [])}
                          />
                        ))}
                        {otherCalls.length > 0 && <ToolCallCard calls={otherCalls} />}
                      </React.Fragment>
                    );
                  }
                  const isTyping =
                    chat.streaming &&
                    idx === chat.displayItems.length - 1 &&
                    item.msg.role === "assistant" &&
                    !item.msg.content;
                  return <MessageBubble key={idx} msg={item.msg} isTyping={isTyping} />;
                })
              )}
              <div ref={chat.bottomRef} />
            </div>

            {/* Composer */}
            <div onPointerDown={(e) => e.stopPropagation()}>
              <AiChatComposer
                input={chat.input}
                onInputChange={chat.setInput}
                onPaste={chat.handlePaste}
                onSend={() => chat.sendMessage()}
                streaming={chat.streaming}
                onStop={chat.handleStop}
                attachment={chat.attachment}
                onRemoveAttachment={() => { chat.setAttachment(null); chat.setShowAttachment(false); }}
                showAttachment={chat.showAttachment}
                onToggleShowAttachment={() => chat.setShowAttachment((v) => !v)}
                showTools={chat.showTools}
                onToggleTools={() => chat.setShowTools((v) => !v)}
                enabledGroups={chat.enabledGroups}
                onToggleGroup={chat.toggleGroup}
                tokenCount={chat.tokenCount}
                textareaRef={chat.textareaRef}
              />
            </div>
          </div>
        </div>

        {/* Resize handle — bottom-right corner */}
        <div
          className="absolute bottom-0 right-0 cursor-nwse-resize z-10 flex items-center justify-center group"
          style={{
            width: RESIZE_HANDLE,
            height: RESIZE_HANDLE,
          }}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        >
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors pointer-events-none"
          >
            <path d="M11 1v10H1" strokeLinecap="round" />
            <path d="M11 6v5H6" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
