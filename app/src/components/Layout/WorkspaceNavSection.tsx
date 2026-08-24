import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useNavStore } from "@/store/navStore";
import { useWorkspacesEnabled } from "@/pages/workspaceFeature";
import { Button } from "@/components/ui/button";

/** The sidebar's custom-workspace section, rendered above the pinned Settings
 *  entry. Each workspace is a row: click to open, hover for delete. The "New"
 *  control creates a workspace and opens it. Reorder/duplicate/reset/undo are
 *  available through the workspace screen's controls in Phase 2; sidebar-level
 *  drag-reorder arrives with Edit mode in Phase 3.
 *
 *  The whole section is gated behind the feature flag so the foundation
 *  (catalog + host) ships with no visible workspace UI until Phase 3 is
 *  stable. */
export function WorkspaceNavSection({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useNavStore((s) => s.activeWorkspaceId);
  const create = useWorkspaceStore((s) => s.create);
  const remove = useWorkspaceStore((s) => s.remove);
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);
  const openWorkspace = useNavStore((s) => s.openWorkspace);
  const workspacesEnabled = useWorkspacesEnabled();

  if (!workspacesEnabled) return null;

  const onOpen = (id: string) => {
    selectWorkspace(id);
    openWorkspace(id);
  };
  const onCreate = () => {
    const id = create();
    selectWorkspace(id);
    openWorkspace(id);
  };

  return (
    <div className="pt-3 mt-1 border-t border-[hsl(var(--sidebar-border))]/60">
      {!collapsed && (
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--sidebar-muted))]">
            {t("workspaces.section")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCreate}
            aria-label={t("workspaces.new")}
            title={t("workspaces.new")}
            className="h-5 w-5 text-[hsl(var(--sidebar-muted))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--sidebar-foreground))]"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      {collapsed && (
        <div className="flex justify-center pb-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCreate}
            aria-label={t("workspaces.new")}
            title={t("workspaces.new")}
            className="h-6 w-6 text-[hsl(var(--sidebar-muted))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--sidebar-foreground))]"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
      {workspaces.length === 0 && !collapsed && (
        <p className="px-2 text-xs text-[hsl(var(--sidebar-muted))]">{t("workspaces.empty.hint")}</p>
      )}
      <div className="space-y-0.5">
        {workspaces.map((ws) => {
          const active = ws.id === activeWorkspaceId;
          return (
            <div key={ws.id} className="group relative">
              <button
                type="button"
                onClick={() => onOpen(ws.id)}
                aria-current={active ? "page" : undefined}
                title={collapsed ? ws.title || t("workspaces.untitled") : undefined}
                className={`group relative h-auto w-full flex items-center rounded-lg text-sm font-medium transition-colors duration-100 ${
                  collapsed ? "justify-center px-0 py-[9px]" : "gap-2.5 px-3 py-[7px]"
                } ${
                  active
                    ? "text-[hsl(var(--sidebar-active-fg))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--sidebar-active-fg))]"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-0 w-[2px] rounded-full bg-primary transition-all duration-200 motion-reduce:transition-none ${
                    active ? "inset-y-1 opacity-100" : "inset-y-1/2 opacity-0 group-hover:inset-y-2 group-hover:opacity-40"
                  }`}
                />
                <span className="flex-1 text-left truncate">
                  {ws.title || t("workspaces.untitled")}
                </span>
              </button>
              {!collapsed && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(t("workspaces.deleteConfirm"))) remove(ws.id);
                  }}
                  aria-label={t("workspaces.delete")}
                  title={t("workspaces.delete")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 opacity-0 group-hover:opacity-100 text-[hsl(var(--sidebar-muted))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--sidebar-foreground))]"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
