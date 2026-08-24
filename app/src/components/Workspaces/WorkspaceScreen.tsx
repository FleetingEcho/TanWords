import React from "react";
import { AlertTriangle, ArrowLeft, Pencil, RotateCcw, SplitSquareHorizontal, SplitSquareVertical, Undo2, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { MAX_WORKSPACE_PANES, useWorkspaceStore } from "@/store/workspaceStore";
import { useNavStore } from "@/store/navStore";
import { Button } from "@/components/ui/button";
import { SplitLayout } from "./SplitLayout";
import { WorkspacePane } from "./WorkspacePane";
import { useIsNarrow } from "@/components/Vocabulary/hooks/useMediaQuery";
import { collectPaneIds, findPane } from "@/workspaces/normalization";
import type { LayoutNode } from "@/workspaces/model";
import { DragLayer } from "./DragLayer";
import { PointerDropDispatcher } from "./PointerDropDispatcher";

/** The workspace screen: the title bar (back, name, edit/done, reset, undo)
 *  and the recursive split layout filling the workspace.
 *
 *  Split controls live here and target the last selected pane. Widget title
 *  handles can always be dragged; Edit mode gates destructive replace/close,
 *  reset, and undo actions. Focus mode (a pane fills the workspace while the
 *  tree is retained) is driven from a pane header and rendered by `SplitLayout`.
 *
 *  Compact mode (one pane at a time with a switcher) is Phase 3 step 4; this
 *  screen renders the desktop split tree for now and defers the compact
 *  fallback. */
export function WorkspaceScreen() {
  const t = useT();
  const activeWorkspaceId = useNavStore((s) => s.activeWorkspaceId);
  const closeWorkspace = useNavStore((s) => s.closeWorkspace);
  const ws = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === activeWorkspaceId));
  const editMode = useWorkspaceStore((s) => s.editMode);
  const selectedPaneId = useWorkspaceStore((s) => s.selectedPaneId);
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const splitEmpty = useWorkspaceStore((s) => s.splitEmpty);
  const setEditMode = useWorkspaceStore((s) => s.setEditMode);
  const reset = useWorkspaceStore((s) => s.reset);
  const undo = useWorkspaceStore((s) => s.undo);
  const rename = useWorkspaceStore((s) => s.rename);
  const undoCheckpoint = useWorkspaceStore((s) => s.undoCheckpoint);
  const recoveredFromCorrupt = useWorkspaceStore((s) => s.recoveredFromCorrupt);
  const acknowledgeRecovery = useWorkspaceStore((s) => s.acknowledgeRecovery);
  // Narrow screens render one pane at a time (criterion 10) instead of a
  // cramped split tree.
  const isNarrow = useIsNarrow();

  const [renaming, setRenaming] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState("");

  if (!ws) return null;

  const paneIds = [...collectPaneIds(ws.root)];
  const splitTarget = paneIds.includes(selectedPaneId ?? "")
    ? selectedPaneId!
    : paneIds.includes(focusedPaneId ?? "")
      ? focusedPaneId!
      : paneIds[0];
  const splitDisabled = paneIds.length >= MAX_WORKSPACE_PANES || !splitTarget;

  const startRename = () => {
    setDraftTitle(ws.title);
    setRenaming(true);
  };
  const commitRename = () => {
    rename(ws.id, draftTitle.trim());
    setRenaming(false);
  };

  return (
    <div className="h-full w-full flex flex-col">
      <PointerDropDispatcher />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--sidebar-border))] shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={closeWorkspace}
          aria-label={t("workspaces.back")}
          title={t("workspaces.back")}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {renaming ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="flex-1 min-w-0 text-sm font-semibold bg-transparent border-b border-primary/40 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={startRename}
            className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
            title={t("workspaces.rename")}
          >
            <span className="font-semibold truncate">{ws.title || t("workspaces.untitled")}</span>
            <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => splitTarget && splitEmpty(splitTarget, "right")}
          disabled={splitDisabled}
          aria-label={t("workspaces.pane.splitRight")}
          title={t("workspaces.pane.splitRight")}
          className="h-8 w-8"
        >
          <SplitSquareHorizontal className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => splitTarget && splitEmpty(splitTarget, "bottom")}
          disabled={splitDisabled}
          aria-label={t("workspaces.pane.splitBelow")}
          title={t("workspaces.pane.splitBelow")}
          className="h-8 w-8"
        >
          <SplitSquareVertical className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditMode(!editMode)}
          className="h-8 gap-1.5 text-xs"
        >
          {editMode ? t("workspaces.done") : t("workspaces.edit")}
        </Button>
        {editMode && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (window.confirm(t("workspaces.resetConfirm"))) reset(ws.id);
              }}
              aria-label={t("workspaces.reset")}
              title={t("workspaces.reset")}
              className="h-8 w-8"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={undo}
              disabled={!undoCheckpoint}
              aria-label={t("workspaces.undo")}
              title={t("workspaces.undo")}
              className="h-8 w-8"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
      {recoveredFromCorrupt && (
        <div
          role="status"
          className="flex items-start gap-2 px-3 py-2 border-b border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300 shrink-0"
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{t("workspaces.recoveredNotice")}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={acknowledgeRecovery}
            aria-label={t("workspaces.recoveredDismiss")}
            title={t("workspaces.recoveredDismiss")}
            className="h-6 w-6 shrink-0 hover:bg-amber-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div className="flex-1 min-h-0 p-1.5">
        {isNarrow ? (
          <CompactPaneView root={ws.root} editMode={editMode} />
        ) : (
          <SplitLayout node={ws.root} visible />
        )}
      </div>
    </div>
  );
}

/** Compact-screen fallback (criterion 10: every pane reachable on small
 *  screens). A multi-pane split is unusable on a phone, so on narrow screens
 *  the workspace shows one pane at a time with a tab strip to switch between
 *  panes. The tree is retained in the store; this only changes what is on
 *  screen. Edit-mode actions (split/close) still apply to the visible pane. */
function CompactPaneView({ root, editMode }: { root: LayoutNode; editMode: boolean }) {
  const t = useT();
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const setFocus = useWorkspaceStore((s) => s.setFocus);
  const paneIds = React.useMemo(() => [...collectPaneIds(root)], [root]);
  // The visible pane is the focused one, or the first pane with content, or
  // the first pane. Stays stable across renders until the user switches.
  const visibleId = React.useMemo(() => {
    if (focusedPaneId && paneIds.includes(focusedPaneId)) return focusedPaneId;
    const firstWithContent = paneIds.find((id) => findPane(root, id)?.kind === "pane" && (findPane(root, id) as any).content);
    return firstWithContent ?? paneIds[0] ?? "";
  }, [root, paneIds, focusedPaneId]);
  const visibleNode = findPane(root, visibleId);
  return (
    <div className="flex h-full w-full flex-col gap-1">
      {paneIds.length > 1 && (
        <div className="flex gap-1 overflow-x-auto px-0.5 shrink-0" role="tablist">
          {paneIds.map((id, i) => {
            const node = findPane(root, id);
            const title = node?.kind === "pane" && node.content ? t(`nav.${node.content.pageId}`) : t("workspaces.blank.title");
            const active = id === visibleId;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFocus(id)}
                className={`px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
                  active ? "bg-primary/15 text-primary font-medium" : "bg-[hsl(var(--muted))] text-muted-foreground"
                }`}
              >
                {i + 1}. {title}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 min-h-0">
        {visibleNode?.kind === "pane" && (
          <WorkspacePane paneId={visibleNode.id} content={visibleNode.content} visible editMode={editMode} focused />
        )}
      </div>
    </div>
  );
}
