import React from "react";
import { AlertTriangle, ArrowLeft, Droplets, Pencil, RotateCcw, SplitSquareHorizontal, SplitSquareVertical, Undo2, X } from "lucide-react";
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
import { DEFAULT_WORKSPACE_APPEARANCE, normalizeWorkspaceAppearance } from "@/workspaces/model";
import { usePageHostUiStore } from "@/store/pageHostUiStore";
import { StartupReadySignal } from "@/pages/StartupReadySignal";

/** The workspace screen: the title bar (back, name, edit/done, reset, undo)
 *  and the recursive split layout filling the workspace.
 *
 *  Split controls live here and target the last selected pane. Widget title
 *  handles can always be dragged; Edit mode gates replace, reset, and undo
 *  actions, while closing a populated widget requires confirmation. Focus
 *  mode (a pane fills the workspace while the tree is retained) is driven
 *  from a pane header and rendered by `SplitLayout`.
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
  const setAppearance = useWorkspaceStore((s) => s.setAppearance);
  const undoCheckpoint = useWorkspaceStore((s) => s.undoCheckpoint);
  const recoveredFromCorrupt = useWorkspaceStore((s) => s.recoveredFromCorrupt);
  const acknowledgeRecovery = useWorkspaceStore((s) => s.acknowledgeRecovery);
  const terminalMaximized = usePageHostUiStore((s) => s.terminalMaximized);
  // Narrow screens render one pane at a time (criterion 10) instead of a
  // cramped split tree.
  const isNarrow = useIsNarrow();

  const [renaming, setRenaming] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState("");
  const [appearanceControlsOpen, setAppearanceControlsOpen] = React.useState(false);

  if (!ws) return null;

  const paneIds = [...collectPaneIds(ws.root)];
  const splitTarget = paneIds.includes(selectedPaneId ?? "")
    ? selectedPaneId!
    : paneIds.includes(focusedPaneId ?? "")
      ? focusedPaneId!
      : paneIds[0];
  const splitDisabled = paneIds.length >= MAX_WORKSPACE_PANES || !splitTarget;
  const appearance = normalizeWorkspaceAppearance(ws.appearance ?? DEFAULT_WORKSPACE_APPEARANCE);
  const focusedNode = focusedPaneId ? findPane(ws.root, focusedPaneId) : null;
  const terminalImmersive = terminalMaximized
    && focusedNode?.kind === "pane"
    && focusedNode.content?.pageId === "terminal";

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
      <StartupReadySignal />
      <PointerDropDispatcher />
      <div className={`${terminalImmersive ? "hidden" : "flex"} h-6 items-center gap-1 px-2 border-b border-[hsl(var(--sidebar-border))] shrink-0`}>
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
            <span className="flex ml-2 font-semibold truncate">{ws.title || t("workspaces.untitled")}</span>
            <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAppearanceControlsOpen((open) => !open)}
          aria-label={t("workspaces.appearance")}
          title={t("workspaces.appearance")}
          aria-pressed={appearanceControlsOpen}
          className={`h-6 w-6 ${appearanceControlsOpen ? "bg-primary/15 text-primary" : appearance.opacity < 100 || appearance.blur > 0 ? "text-primary" : ""}`}
        >
          <Droplets className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => splitTarget && splitEmpty(splitTarget, "right")}
          disabled={splitDisabled}
          aria-label={t("workspaces.pane.splitRight")}
          title={t("workspaces.pane.splitRight")}
          className="h-6 w-6"
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
          className="h-6 w-6"
        >
          <SplitSquareVertical className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditMode(!editMode)}
          className="h-6 gap-1 text-xs px-2"
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
              className="h-6 w-6"
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
              className="h-6 w-6"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
      {!terminalImmersive && appearanceControlsOpen && (
        <WorkspaceAppearanceControls
          appearance={appearance}
          onChange={(next) => setAppearance(ws.id, next)}
        />
      )}
      {!terminalImmersive && recoveredFromCorrupt && (
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
      <div className={`flex-1 min-h-0 ${terminalImmersive ? "p-0" : "p-1.5"}`}>
        {isNarrow && !terminalImmersive ? (
          <CompactPaneView root={ws.root} editMode={editMode} />
        ) : (
          <SplitLayout node={ws.root} visible />
        )}
      </div>
    </div>
  );
}

function WorkspaceAppearanceControls({
  appearance,
  onChange,
}: {
  appearance: { blur: number; opacity: number };
  onChange: (appearance: { blur: number; opacity: number }) => void;
}) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("workspaces.appearance")}
      className="flex shrink-0 flex-wrap items-center justify-end gap-x-5 gap-y-1 border-b border-border/70 bg-transparent px-3 py-1.5"
    >
      <WorkspaceAppearanceSlider
        label={t("workspaces.appearance.blur")}
        value={appearance.blur}
        max={30}
        unit="px"
        onChange={(blur) => onChange({ ...appearance, blur })}
      />
      <WorkspaceAppearanceSlider
        label={t("workspaces.appearance.opacity")}
        value={appearance.opacity}
        max={100}
        unit="%"
        onChange={(opacity) => onChange({ ...appearance, opacity })}
      />
    </div>
  );
}

function WorkspaceAppearanceSlider({
  label,
  value,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        aria-label={label}
        className="h-5 w-24 cursor-pointer accent-primary"
      />
      <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
        {value}{unit}
      </span>
    </label>
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
