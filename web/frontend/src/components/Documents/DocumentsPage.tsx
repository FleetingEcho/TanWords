import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { DocSelector } from "./DocSelector";
import { LazyDocEditor } from "./LazyDocEditor";
import { useDocumentEditor } from "./useDocumentEditor";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronsRight, ChevronsLeft, RefreshCw } from "lucide-react";
import { LIST_PANEL_WIDTH, LIST_PANEL_COLLAPSED_WIDTH, LIST_PANEL_TOGGLE_CLASS } from "@/components/shared/listPanel";
import { LockedDocumentPanel } from "./LockedDocumentPanel";

const LAST_DB_ID_KEY = "tanwords_doc_last_db_id";

/** Web: database-backed documents only. The desktop's local-folder vault
 *  ("localdocs") is a device filesystem feature and doesn't exist here, so the
 *  db/local source tabs are gone; document assets are served by the web
 *  server's /api/assets/:id route instead of a path-based file endpoint. */
export function DocumentsPage() {
  const t = useT();
  const [dbRefreshKey, setDbRefreshKey] = useState(0);
  const [dbRefreshing, setDbRefreshing] = useState(false);
  const refresh = () => setDbRefreshKey((key) => key + 1);
  const [dbZenMode, setDbZenMode] = useState(false);
  /** <lg layout is single-pane: doc list fills the screen until a doc is
   *  opened, then the editor covers it; the header's back button returns.
   *  On lg+ both panes sit side by side as on desktop. */
  const [showMobileEditor, setShowMobileEditor] = useState(false);
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

  useEffect(() => {
    if (activeId != null) setShowMobileEditor(true);
  }, [activeId]);

  // BlockNote is split out of the main bundle, so the first open pays for both
  // chunk download and editor construction. Preload the editor once the user
  // lands on Documents; it can finish during idle time instead of making the
  // first click wait.
  useEffect(() => {
    let cancelled = false;
    const loadEditors = () => {
      if (cancelled) return;
      void import("./DocEditor");
    };
    const w = window as any;
    let cancel: () => void;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(loadEditors, { timeout: 2500 });
      cancel = () => w.cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(loadEditors, 1200);
      cancel = () => window.clearTimeout(id);
    }
    return () => {
      cancelled = true;
      cancel();
    };
  }, []);

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
    if (!dbZenMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDbZenMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dbZenMode]);

  // Returning to Documents should not show a stale list from a previous visit.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const onNewDocument = () => { void handleNewDoc(); };
    const onOpenDocument = (event: Event) => {
      const id = (event as CustomEvent<{ id: number }>).detail?.id;
      if (id > 0) void loadDoc(id);
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
      {!dbZenMode && (
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5 bg-transparent">
        <div className="flex items-center gap-1.5 min-w-0">
          {showMobileEditor && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowMobileEditor(false)}
              title={t("doc.collapseFiles")}
              aria-label={t("doc.collapseFiles")}
              className="h-7 w-7 shrink-0 lg:hidden text-muted-foreground hover:text-foreground"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          )}
          <span className="text-xs font-semibold text-muted-foreground">{t("doc.tabDatabase")}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={refresh}
          disabled={dbRefreshing}
          title={t("doc.refreshDocuments")}
          aria-label={t("doc.refreshDocuments")}
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${dbRefreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <div className={`absolute inset-0 flex overflow-hidden ${dbZenMode ? "fixed inset-0 z-50 bg-background" : ""}`}>
            {!dbZenMode && (
            <Collapsible open={dbSidebarOpen} onOpenChange={setDbSidebarOpen} asChild>
              <div className={`${dbSidebarOpen ? LIST_PANEL_WIDTH : LIST_PANEL_COLLAPSED_WIDTH} h-full shrink-0 transition-[width] duration-200 max-lg:w-full max-lg:shrink ${showMobileEditor ? "max-lg:hidden" : ""}`}>
                {!dbSidebarOpen && <div className="flex h-full justify-center border-r border-border bg-card pt-3">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className={`h-7 w-7 ${LIST_PANEL_TOGGLE_CLASS}`} title={t("doc.expandFiles")}><ChevronsRight className="h-3.5 w-3.5" /></Button>
                  </CollapsibleTrigger>
                </div>}
                <CollapsibleContent className="h-full">
                  <DocSelector
                    activeId={activeId}
                    onSelect={loadDoc}
                    onNewDoc={handleNewDoc}
                    refreshKey={refreshKey}
                    manualRefreshKey={dbRefreshKey}
                    onRefreshingChange={setDbRefreshing}
                    onCollapse={() => setDbSidebarOpen(false)}
                  />
                </CollapsibleContent>
              </div>
            </Collapsible>
            )}

            <div className={`flex-1 overflow-hidden min-w-0 ${showMobileEditor ? "" : "max-lg:hidden"}`}>
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
                  zenMode={dbZenMode}
                  onZenModeChange={setDbZenMode}
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
      </div>
    </div>
  );
}
