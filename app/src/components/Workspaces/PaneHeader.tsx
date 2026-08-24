import React from "react";
import { Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import type { PageInstance } from "@/workspaces/model";
import { paneCount } from "@/workspaces/normalization";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { getPageDefinition } from "@/pages/pageCatalog";
import { Button } from "@/components/ui/button";
import { usePageDragSource } from "./DropZones";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

/** The pane header: a draggable page title plus replace, maximize, and close
 *  actions. Workspace-level split controls provide the non-drag layout path.
 *
 *  Maximize/restore is always available because it is a viewing action.
 *  Replacement appears in Edit mode; closing remains available during normal
 *  use but requires confirmation for a populated widget. */
export interface PaneHeaderProps {
  paneId: string;
  content: PageInstance | null;
  active: boolean;
  editMode: boolean;
  focused: boolean;
  onAddPage: () => void;
}

export function PaneHeader({ paneId, content, active, editMode, focused, onAddPage }: PaneHeaderProps) {
  const t = useT();
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const setFocus = useWorkspaceStore((s) => s.setFocus);
  const setSelectedPane = useWorkspaceStore((s) => s.setSelectedPane);
  const canCollapseEmptyPane = useWorkspaceStore((s) => {
    const workspace = s.workspaces.find((candidate) => candidate.id === s.activeWorkspaceId);
    return !!workspace && paneCount(workspace.root) > 1;
  });

  const def = content ? getPageDefinition(content.pageId) : null;
  const Icon = def?.icon;
  const title = content ? t(`nav.${content.pageId}`) : t("workspaces.blank.title");
  const dragSource = usePageDragSource(content?.pageId ?? null, content ? paneId : undefined);

  return (
    <>
    <div
      className={`relative z-1 flex items-center gap-1 px-2 h-8 shrink-0 border-b text-xs select-none ${
        active || focused
          ? "border-primary/30 bg-primary/5 text-foreground"
          : "border-[hsl(var(--sidebar-border))] bg-[hsl(var(--muted))/40] text-muted-foreground"
      }`}
    >
      <span
        {...(content ? dragSource : {})}
        onPointerDown={() => setSelectedPane(paneId)}
        className={`flex items-center gap-1.5 flex-1 min-w-0 ${content ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate font-medium">{title}</span>
      </span>
      {content && editMode && (
        <>
          <HeaderButton title={t("workspaces.pane.replace")} onClick={onAddPage} icon={<RefreshCw className="h-3.5 w-3.5" />} />
        </>
      )}
      {content && (
        <HeaderButton
          title={t(focused ? "workspaces.pane.restore" : "workspaces.pane.maximize")}
          onClick={() => setFocus(focused ? null : paneId)}
          icon={focused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          active={focused}
        />
      )}
      {(content || canCollapseEmptyPane) && (
        <HeaderButton
          title={t("workspaces.pane.close")}
          onClick={() => content ? setCloseConfirmOpen(true) : closePane(paneId)}
          icon={<X className="h-3.5 w-3.5" />}
        />
      )}
    </div>
    <ConfirmModal
      open={closeConfirmOpen}
      title={t("workspaces.pane.close")}
      message={t("workspaces.pane.closeConfirm")}
      confirmLabel={t("workspaces.pane.close")}
      onCancel={() => setCloseConfirmOpen(false)}
      onConfirm={() => {
        closePane(paneId);
        setCloseConfirmOpen(false);
      }}
    />
    </>
  );
}

function HeaderButton({ title, onClick, icon, active }: { title: string; onClick: () => void; icon: React.ReactNode; active?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`h-6 w-6 ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
    >
      {icon}
    </Button>
  );
}
