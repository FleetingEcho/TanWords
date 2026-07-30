import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { DocSelector } from "./DocSelector";
import { LazyDocEditor } from "./LazyDocEditor";
import { useDocumentEditor } from "./useDocumentEditor";
import { LocalDocsView } from "./LocalDocsView";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronsRight } from "lucide-react";
import { LIST_PANEL_WIDTH, LIST_PANEL_COLLAPSED_WIDTH, LIST_PANEL_TOGGLE_CLASS } from "@/components/shared/listPanel";
import { LockedDocumentPanel } from "./LockedDocumentPanel";

type DocSource = "db" | "local";

const LAST_SOURCE_KEY = "tanwords_doc_last_source";
const LAST_DB_ID_KEY = "tanwords_doc_last_db_id";

export function DocumentsPage() {
  const t = useT();
  const [source, setSourceState] = useState<DocSource>(() => {
    const saved = localStorage.getItem(LAST_SOURCE_KEY);
    return saved === "local" ? saved : "db";
  });
  const setSource = (s: DocSource) => {
    localStorage.setItem(LAST_SOURCE_KEY, s);
    setSourceState(s);
  };
  // The local-folder pane only ever mounts once the user has actually looked at that tab
  // (it does real filesystem I/O) — but if that's where they left off last session, restore
  // it immediately instead of waiting for a click that will never come this visit.
  const [localMounted, setLocalMounted] = useState(() => localStorage.getItem(LAST_SOURCE_KEY) === "local");
  const [dbSidebarOpen, setDbSidebarOpenState] = useState(() => localStorage.getItem("tanwords_doc_db_sidebar_collapsed") !== "1");
  const setDbSidebarOpen = (open: boolean) => {
    localStorage.setItem("tanwords_doc_db_sidebar_collapsed", open ? "0" : "1");
    setDbSidebarOpenState(open);
  };
  const {
    activeId, doc, lockedId, saveStatus, refreshKey, loading,
    loadDoc, handleNewDoc, handleSave, markDirty, handleTitleChange, handleTagsChange, handlePinToggle,
    unlockDocument, removeLockedProtection,
  } = useDocumentEditor();

  // Reopen whichever database doc was open last session.
  useEffect(() => {
    const lastId = Number(localStorage.getItem(LAST_DB_ID_KEY));
    if (lastId > 0) loadDoc(lastId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot restore on mount only.
  }, []);

  useEffect(() => {
    if (activeId != null) localStorage.setItem(LAST_DB_ID_KEY, String(activeId));
  }, [activeId]);

  useEffect(() => {
    const onNewDocument = () => { setSource("db"); void handleNewDoc(); };
    const onOpenDocument = (event: Event) => {
      const id = (event as CustomEvent<{ id: number }>).detail?.id;
      if (id > 0) { setSource("db"); void loadDoc(id); }
    };
    window.addEventListener("tanwords:new-document", onNewDocument);
    window.addEventListener("tanwords:open-document", onOpenDocument);
    return () => {
      window.removeEventListener("tanwords:new-document", onNewDocument);
      window.removeEventListener("tanwords:open-document", onOpenDocument);
    };
  }, [handleNewDoc, loadDoc]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Source tabs: database docs vs mounted local folder */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5 bg-transparent">
        <div className="flex items-center gap-1">
          {(["db", "local"] as const).map((s) => (
            <Button
              key={s}
              type="button"
              variant="ghost"
              onClick={() => {
                if (s === "local") setLocalMounted(true);
                setSource(s);
              }}
              className={`h-7 px-3 rounded-lg text-xs font-semibold transition-colors ${
                source === s
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {s === "db" ? t("doc.tabDatabase") : t("doc.tabLocal")}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div className={`absolute inset-0 ${source === "db" ? "flex" : "hidden"} overflow-hidden`}>
            <Collapsible open={dbSidebarOpen} onOpenChange={setDbSidebarOpen} asChild>
              <div className={`${dbSidebarOpen ? LIST_PANEL_WIDTH : LIST_PANEL_COLLAPSED_WIDTH} h-full shrink-0 transition-[width] duration-200`}>
                {!dbSidebarOpen && <div className="flex h-full justify-center border-r border-border bg-card pt-3">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${LIST_PANEL_TOGGLE_CLASS}`} title={t("doc.expandFiles")}><ChevronsRight className="h-3.5 w-3.5" /></Button>
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
                  onDirty={markDirty}
                  onTitleChange={handleTitleChange}
                  onTagsChange={handleTagsChange}
                  onPinToggle={handlePinToggle}
                  saveStatus={saveStatus}
                />
              ) : lockedId !== null ? (
                <LockedDocumentPanel
                  onUnlock={unlockDocument}
                  onRemoveProtection={removeLockedProtection}
                />
              ) : loading ? (
                <div className="flex items-center justify-center h-full">
                  <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
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
