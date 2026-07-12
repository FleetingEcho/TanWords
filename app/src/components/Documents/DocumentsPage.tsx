import React from "react";
import { useT } from "@/hooks/useT";
import { DocSelector } from "./DocSelector";
import { LazyDocEditor } from "./LazyDocEditor";
import { useDocumentEditor } from "./useDocumentEditor";

export function DocumentsPage() {
  const t = useT();
  const {
    activeId, doc, saveStatus, refreshKey,
    loadDoc, handleNewDoc, handleSave, handleTitleChange, handleTagsChange, handlePinToggle,
  } = useDocumentEditor();

  return (
    <div className="flex h-full overflow-hidden">
      <DocSelector
        activeId={activeId}
        onSelect={loadDoc}
        onNewDoc={handleNewDoc}
        refreshKey={refreshKey}
      />

      <div className="flex-1 overflow-hidden">
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
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-14 h-14 opacity-20">
              <path d="M12 6h18l9 9v27a3 3 0 01-3 3H12a3 3 0 01-3-3V9a3 3 0 013-3z" />
              <path d="M30 6v9h9" />
              <path d="M18 22h12M18 28h12M18 34h8" strokeLinecap="round" />
            </svg>
            <p className="text-sm">{t("doc.noDocSelected")}</p>
            <p className="text-xs opacity-60">{t("doc.noDocHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
