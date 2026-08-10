import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { DocSelector } from "./DocSelector";
import { LazyDocEditor } from "./LazyDocEditor";
import { useDocumentEditor } from "./useDocumentEditor";
import { LocalDocsView } from "./LocalDocsView";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { LIST_PANEL_WIDTH, LIST_PANEL_COLLAPSED_WIDTH, LIST_PANEL_TOGGLE_CLASS } from "@/components/shared/listPanel";
import { EmptyCanvas } from "@/components/shared/EmptyCanvas";
import { DocSourceTabs } from "./DocSourceTabs";
import { LockedDocumentPanel } from "./LockedDocumentPanel";
import { useIsNarrow } from "@/components/Vocabulary/hooks/useMediaQuery";
import { hostCapabilities } from "@/platform";

type DocSource = "db" | "local";

const LAST_SOURCE_KEY = "tanwords_doc_last_source";
const LAST_DB_ID_KEY = "tanwords_doc_last_db_id";
const SHOW_DOC_LIST_FLAG = "tanwords_show_doc_list";

export function DocumentsPage() {
  const t = useT();
  const [source, setSourceState] = useState<DocSource>(() => {
    const saved = localStorage.getItem(LAST_SOURCE_KEY);
    return hostCapabilities.localDocs && saved === "local" ? saved : "db";
  });
  const [dbRefreshKey, setDbRefreshKey] = useState(0);
  const [localRefreshTick, setLocalRefreshTick] = useState(0);
  const [dbRefreshing, setDbRefreshing] = useState(false);
  const [localRefreshing, setLocalRefreshing] = useState(false);
  const refreshActiveTab = () => {
    if (source === "db") setDbRefreshKey((key) => key + 1);
    else setLocalRefreshTick((tick) => tick + 1);
  };
  const setSource = (s: DocSource) => {
    if (s === "local" && !hostCapabilities.localDocs) return;
    localStorage.setItem(LAST_SOURCE_KEY, s);
    setSourceState(s);
    setShowMobileEditor(false);
    // Switching tabs must show a fresh list for the tab that just appeared.
    if (s === "db") setDbRefreshKey((key) => key + 1);
    else setLocalRefreshTick((tick) => tick + 1);
  };
  // The local-folder pane only ever mounts once the user has actually looked at that tab
  // (it does real filesystem I/O) — but if that's where they left off last session, restore
  // it immediately instead of waiting for a click that will never come this visit.
  const [localMounted, setLocalMounted] = useState(
    () => hostCapabilities.localDocs && localStorage.getItem(LAST_SOURCE_KEY) === "local",
  );
  // Establish restoration before the first paint. Waiting for the mount effect
  // made compact layouts draw the document list/empty state for one frame,
  // then replace it with a loader as the remembered document began opening.
  const restoreLastDbDocOnMount = React.useRef(
    source === "db"
      && localStorage.getItem(SHOW_DOC_LIST_FLAG) !== "1"
      && Number(localStorage.getItem(LAST_DB_ID_KEY)) > 0,
  );
  const [showMobileEditor, setShowMobileEditor] = useState(restoreLastDbDocOnMount.current);
  const [restoringLastDoc, setRestoringLastDoc] = useState(restoreLastDbDocOnMount.current);
  const isNarrow = useIsNarrow();
  const [dbZenMode, setDbZenMode] = useState(false);
  const [dbSidebarOpen, setDbSidebarOpenState] = useState(() => localStorage.getItem("tanwords_doc_db_sidebar_collapsed") !== "1");
  const setDbSidebarOpen = (open: boolean) => {
    localStorage.setItem("tanwords_doc_db_sidebar_collapsed", open ? "0" : "1");
    setDbSidebarOpenState(open);
  };
  useEffect(() => {
    if (isNarrow) setDbSidebarOpenState(true);
  }, [isNarrow]);
  const {
    activeId, doc, lockedId, saveStatus, refreshKey, loading,
    loadDoc, handleNewDoc, handleNewDocIn, handleSave, markDirty, handleTitleChange, handleTagsChange, handleStatusChange, handlePinToggle,
    registerActiveFlush, flushActiveDocument,
    unlockDocument, removeLockedProtection,
  } = useDocumentEditor();

  useEffect(() => {
    if (activeId != null) setShowMobileEditor(true);
  }, [activeId]);

  // The editor is split out of the main bundle, so the first open pays for both
  // chunk download and editor construction. Preload both editor variants once
  // the user lands on Documents; they can finish during idle time instead of
  // making the first click wait.
  useEffect(() => {
    let cancelled = false;
    const loadEditors = () => {
      if (cancelled) return;
      void import("./DocEditor");
      if (hostCapabilities.localDocs) void import("./LocalDocEditor");
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
    let cancelled = false;
    const finishRestore = () => {
      if (!cancelled) setRestoringLastDoc(false);
    };
    const lastId = Number(localStorage.getItem(LAST_DB_ID_KEY));
    if (localStorage.getItem(SHOW_DOC_LIST_FLAG) === "1") {
      localStorage.removeItem(SHOW_DOC_LIST_FLAG);
      setSourceState("db");
      setShowMobileEditor(false);
      void loadDoc(-1);
      finishRestore();
      return () => { cancelled = true; };
    }
    if (lastId > 0) void loadDoc(lastId).finally(finishRestore);
    else finishRestore();
    return () => { cancelled = true; };
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

  // Returning to Documents from another page (or another app window) should
  // not show a stale DB/local list from the previous session.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshActiveTab();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally refresh whichever tab is active now.
  }, [source]);

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

  // One instance, rendered into whichever list header is on screen.
  const sourceTabs = (
    <DocSourceTabs
      source={source}
      onSelect={(next) => {
        if (next === "local") setLocalMounted(true);
        setSource(next);
      }}
      refreshing={source === "db" ? dbRefreshing : localRefreshing}
      onRefresh={refreshActiveTab}
    />
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* The database/local switcher used to be a full-width bar of its own
        * here. Two short pills and one icon do not need a row across the whole
        * window, and the list header below already had an empty half — so the
        * switcher moved in there, next to the list it switches. */}
      {showMobileEditor && isNarrow && (
        <div className="flex shrink-0 items-center border-b border-border px-4 py-2 lg:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowMobileEditor(false)}
            title={t("doc.collapseFiles")}
            aria-label={t("doc.collapseFiles")}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <div className={`absolute inset-0 ${source === "db" ? "flex" : "hidden"} overflow-hidden ${dbZenMode ? "fixed inset-0 z-50 bg-background" : ""}`}>
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
                    sourceTabs={sourceTabs}
                    activeId={activeId}
                    onSelect={loadDoc}
                    onNewDoc={handleNewDoc}
                    onNewDocIn={handleNewDocIn}
                    refreshKey={refreshKey}
                    manualRefreshKey={dbRefreshKey}
                    onRefreshingChange={setDbRefreshing}
                    onCollapse={() => setDbSidebarOpen(false)}
                    beforeLock={flushActiveDocument}
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
                  onStatusChange={handleStatusChange}
                  onPinToggle={handlePinToggle}
                  saveStatus={saveStatus}
                  zenMode={dbZenMode}
                  onZenModeChange={setDbZenMode}
                  onFlushReady={registerActiveFlush}
                />
              ) : lockedId !== null ? (
                <LockedDocumentPanel
                  onUnlock={unlockDocument}
                  onRemoveProtection={removeLockedProtection}
                />
              ) : loading || restoringLastDoc ? (
                <div className="flex items-center justify-center h-full">
                  <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              ) : (
                <EmptyCanvas title={t("doc.noDocSelected")} body={t("doc.noDocHint")} />
              )}
            </div>
        </div>

        {hostCapabilities.localDocs && localMounted && (
          <div className={`absolute inset-0 ${source === "local" ? "block" : "hidden"}`}>
            <LocalDocsView
              sourceTabs={sourceTabs}
              refreshTick={localRefreshTick}
              onRefreshingChange={setLocalRefreshing}
            />
          </div>
        )}
      </div>
    </div>
  );
}
