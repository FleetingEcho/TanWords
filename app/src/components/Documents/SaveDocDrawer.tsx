import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { DocSelector } from "./DocSelector";
import { LazyDocEditor } from "./LazyDocEditor";
import { useDocumentEditor } from "./useDocumentEditor";
import { Drawer, DrawerCloseButton } from "@/components/ui/Drawer";

interface Props {
  open: boolean;
  onClose: () => void;
}

const MIN_WIDTH = 640;
const MAX_WIDTH = 1100;
const DEFAULT_WIDTH = 820;

/** Quick-access document editor, reachable from anywhere via the sidebar.
 *  Reuses the same DocSelector + DocEditor (and BlockNote instance setup
 *  inside DocEditor) as the full Documents page — just in a slide-over. */
export function SaveDocDrawer({ open, onClose }: Props) {
  const t = useT();
  const {
    activeId, doc, saveStatus, refreshKey,
    loadDoc, handleNewDoc, handleSave, handleTitleChange, handleTagsChange, handlePinToggle,
  } = useDocumentEditor();

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    e.preventDefault();
  }, [width]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX.current - e.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta)));
    };
    const handleUp = () => { isDragging.current = false; };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, []);

  // First time the drawer is opened with nothing loaded yet, jump straight
  // into a fresh document — this is a "jot something down" quick-access
  // panel, not a picker you have to click through first.
  useEffect(() => {
    if (open && doc === null && activeId === null) {
      handleNewDoc();
    }
  }, [open]);

  return (
    <Drawer open={open} onClose={onClose} width={width} panelClassName="flex">
        {/* Left-edge resize handle */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/20 transition-colors group z-10 flex items-center justify-center"
        >
          <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary/40 transition-colors" />
        </div>

        <DocSelector
          activeId={activeId}
          onSelect={loadDoc}
          onNewDoc={handleNewDoc}
          refreshKey={refreshKey}
        />

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-end h-11 px-3 border-b border-border shrink-0">
            <DrawerCloseButton onClose={onClose} title={t("doc.close")} />
          </div>

          <div className="flex-1 min-h-0">
            {doc ? (
              <LazyDocEditor
                key={doc.id}
                doc={doc}
                onSave={handleSave}
                onTitleChange={handleTitleChange}
                onTagsChange={handleTagsChange}
                onPinToggle={handlePinToggle}
                saveStatus={saveStatus}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <p className="text-sm">{t("doc.noDocSelected")}</p>
                <p className="text-xs opacity-60">{t("doc.noDocHint")}</p>
              </div>
            )}
          </div>
        </div>
    </Drawer>
  );
}
