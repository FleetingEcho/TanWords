import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { DocSelector } from "./DocSelector";
import { LazyDocEditor } from "./LazyDocEditor";
import { useDocumentEditor } from "./useDocumentEditor";
import { LocalDocsView } from "./LocalDocsView";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { PanelLeftOpen } from "lucide-react";

type DocSource = "db" | "local";

export function DocumentsPage() {
  const t = useT();
  const [source, setSource] = useState<DocSource>("db");
  const [localMounted, setLocalMounted] = useState(false);
  const [dbSidebarOpen, setDbSidebarOpen] = useState(true);
  const {
    activeId, doc, saveStatus, refreshKey,
    loadDoc, handleNewDoc, handleSave, handleTitleChange, handleTagsChange, handlePinToggle,
  } = useDocumentEditor();

  useEffect(() => {
    const onNewDocument = () => { setSource("db"); void handleNewDoc(); };
    window.addEventListener("tanwords:new-document", onNewDocument);
    return () => window.removeEventListener("tanwords:new-document", onNewDocument);
  }, [handleNewDoc]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Source tabs: database docs vs mounted local folder */}
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-2 border-b border-border shrink-0 bg-sidebar">
        {(["db", "local"] as const).map((s) => (
          <Button
            key={s}
            type="button"
            variant="ghost"
            onClick={() => {
              if (s === "local") setLocalMounted(true);
              setSource(s);
            }}
            className={`h-6 px-3 rounded-lg text-[11px] font-semibold transition-colors ${
              source === s
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {s === "db" ? t("doc.tabDatabase") : t("doc.tabLocal")}
          </Button>
        ))}
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div className={`absolute inset-0 ${source === "db" ? "flex" : "hidden"} overflow-hidden`}>
            <Collapsible open={dbSidebarOpen} onOpenChange={setDbSidebarOpen} asChild>
              <div className={`${dbSidebarOpen ? "w-80" : "w-11"} h-full shrink-0 transition-[width] duration-200`}>
                {!dbSidebarOpen && <div className="flex h-full justify-center border-r border-border bg-sidebar pt-3">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title={t("doc.expandFiles")}><PanelLeftOpen className="h-4 w-4" /></Button>
                  </CollapsibleTrigger>
                </div>}
                <CollapsibleContent className="h-full">
                  <DocSelector activeId={activeId} onSelect={loadDoc} onNewDoc={handleNewDoc} refreshKey={refreshKey} onCollapse={() => setDbSidebarOpen(false)} />
                </CollapsibleContent>
              </div>
            </Collapsible>

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

        {localMounted && (
          <div className={`absolute inset-0 ${source === "local" ? "block" : "hidden"}`}>
            <LocalDocsView />
          </div>
        )}
      </div>
    </div>
  );
}
