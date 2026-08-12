import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Pin, PinOff, Plus, Star, StarOff, TerminalSquare, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { TerminalTool } from "./TerminalTool";

interface TerminalTab {
  id: number;
  ordinal: number;
  /** Snapshot of the device setting. It intentionally never changes in place. */
  shellPath: string;
  shellName: string;
  customName: string;
  starred: boolean;
  pinned: boolean;
}

export const MAX_TERMINAL_TABS = 6;

function newTab(id: number): TerminalTab {
  return {
    id,
    ordinal: id,
    shellPath: useSettingsStore.getState().terminalShellPath,
    shellName: "",
    customName: "",
    starred: false,
    pinned: false,
  };
}

interface TabMenu {
  id: number;
  x: number;
  y: number;
}

const ignoreMaximizedChange = () => {};

export function TerminalWorkspace({
  onBack,
  visible = true,
  maximized = false,
  onMaximizedChange = ignoreMaximizedChange,
}: {
  onBack: () => void;
  visible?: boolean;
  maximized?: boolean;
  onMaximizedChange?: (maximized: boolean) => void;
}) {
  const t = useT();
  const nextId = useRef(2);
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [newTab(1)]);
  const [activeId, setActiveId] = useState(1);
  const [tabMenu, setTabMenu] = useState<TabMenu | null>(null);
  const [renameTabId, setRenameTabId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [closeTabId, setCloseTabId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // An external navigation (shortcut/deep link) must restore app chrome. The
  // terminal itself remains mounted and its PTYs continue running.
  useEffect(() => {
    if (!visible && maximized) onMaximizedChange(false);
  }, [maximized, onMaximizedChange, visible]);

  const closeWorkspace = useCallback(() => {
    onMaximizedChange(false);
    onBack();
  }, [onBack, onMaximizedChange]);

  const addTab = () => {
    if (tabs.length >= MAX_TERMINAL_TABS) return;
    const tab = newTab(nextId.current++);
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  };

  useEffect(() => {
    if (!tabMenu) return;
    const closeOnPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setTabMenu(null);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabMenu(null);
    };
    document.addEventListener("mousedown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnKeyDown, true);
    };
  }, [tabMenu]);

  const closeTabNow = (id: number) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (tabs.length === 1) {
      closeWorkspace();
      return;
    }
    const remaining = tabs.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (activeId === id) {
      setActiveId(remaining[Math.min(index, remaining.length - 1)].id);
    }
  };

  const requestClose = (id: number) => {
    setTabMenu(null);
    setCloseTabId(id);
  };

  const titleFor = (tab: TerminalTab) => {
    if (tab.customName) return tab.customName;
    return tab.shellName
      ? `${tab.shellName} · ${tab.ordinal}`
      : t("toolsPage.terminal.tab", { n: tab.ordinal });
  };

  const openRename = (id: number) => {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    setTabMenu(null);
    setRenameDraft(tab.customName || titleFor(tab));
    setRenameTabId(id);
  };

  const confirmRename = () => {
    const name = renameDraft.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
    if (renameTabId == null || !name) return;
    setTabs((current) => current.map((tab) => (
      tab.id === renameTabId ? { ...tab, customName: name } : tab
    )));
    setRenameTabId(null);
  };

  const toggleTabFlag = (id: number, flag: "starred" | "pinned") => {
    setTabs((current) => current.map((tab) => (
      tab.id === id ? { ...tab, [flag]: !tab[flag] } : tab
    )));
    setTabMenu(null);
  };

  const recordShell = (id: number, shell: string) => {
    const shellName = shell.split(/[\\/]/).filter(Boolean).pop() ?? shell;
    setTabs((current) => current.map((tab) => (
      tab.id === id ? { ...tab, shellName } : tab
    )));
  };

  const orderedTabs = [...tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const menuTab = tabMenu ? tabs.find((tab) => tab.id === tabMenu.id) ?? null : null;
  const closingTab = closeTabId == null ? null : tabs.find((tab) => tab.id === closeTabId) ?? null;

  const tabBar = (
    <div
      role="tablist"
      aria-label={t("toolsPage.terminal.tabs")}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-y border-border px-2 pt-2 sm:px-2"
    >
      {orderedTabs.map((tab) => {
        const selected = tab.id === activeId;
        const title = titleFor(tab);
        return (
          <div
            key={tab.id}
            onContextMenu={(event) => {
              event.preventDefault();
              setTabMenu({ id: tab.id, x: event.clientX, y: event.clientY });
            }}
            className={`flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 px-1 ${
              selected
                ? "border-border bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/60"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={title}
              data-starred={String(tab.starred)}
              data-pinned={String(tab.pinned)}
              onClick={() => setActiveId(tab.id)}
              className="flex h-full items-center gap-2 px-2 text-xs font-medium"
            >
              <TerminalSquare className="h-3.5 w-3.5" />
              {tab.pinned && <Pin className="h-3 w-3 fill-current" aria-hidden="true" />}
              {tab.starred && <Star className="h-3 w-3 fill-current text-amber-500" aria-hidden="true" />}
              <span className="max-w-36 truncate">{title}</span>
            </button>
            <button
              type="button"
              onClick={() => requestClose(tab.id)}
              aria-label={t("toolsPage.terminal.closeTab", { n: tab.ordinal })}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="icon"
        onClick={addTab}
        disabled={tabs.length >= MAX_TERMINAL_TABS}
        title={tabs.length >= MAX_TERMINAL_TABS
          ? t("toolsPage.terminal.tabLimit", { n: MAX_TERMINAL_TABS })
          : t("toolsPage.terminal.newTab")}
        aria-label={t("toolsPage.terminal.newTab")}
        className="h-8 w-8 shrink-0 rounded-md text-muted-foreground"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="relative h-full min-h-0">
      <div className="relative h-full min-h-0">
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <div
              key={tab.id}
              hidden={!selected}
              aria-hidden={!selected}
              className={selected ? "absolute inset-0" : "hidden"}
            >
              <TerminalTool
                onBack={closeWorkspace}
                visible={visible && selected}
                maximized={maximized && selected}
                onMaximizedChange={onMaximizedChange}
                shellPath={tab.shellPath}
                onSessionReady={(shell) => recordShell(tab.id, shell)}
                onSessionExit={() => closeTabNow(tab.id)}
                tabBar={selected ? tabBar : undefined}
              />
            </div>
          );
        })}
      </div>

      {tabMenu && menuTab && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("toolsPage.terminal.tabMenu")}
          className="fixed z-[70] w-44 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-xl"
          style={{
            left: Math.max(8, Math.min(tabMenu.x, window.innerWidth - 184)),
            top: Math.max(8, Math.min(tabMenu.y, window.innerHeight - 176)),
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => openRename(menuTab.id)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("toolsPage.terminal.renameTab")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => toggleTabFlag(menuTab.id, "starred")}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-muted"
          >
            {menuTab.starred ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
            {t(menuTab.starred ? "toolsPage.terminal.unstarTab" : "toolsPage.terminal.starTab")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => toggleTabFlag(menuTab.id, "pinned")}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-muted"
          >
            {menuTab.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {t(menuTab.pinned ? "toolsPage.terminal.unpinTab" : "toolsPage.terminal.pinTab")}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => requestClose(menuTab.id)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-destructive hover:bg-destructive/10"
          >
            <X className="h-3.5 w-3.5" />
            {t("toolsPage.terminal.closeTabAction")}
          </button>
        </div>
      )}

      <Dialog
        open={renameTabId != null}
        onClose={() => setRenameTabId(null)}
        maxWidth="max-w-sm"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            confirmRename();
          }}
        >
          <div className="space-y-3 p-5">
            <DialogTitle className="text-sm font-semibold">
              {t("toolsPage.terminal.renameTabTitle")}
            </DialogTitle>
            <input
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              aria-label={t("toolsPage.terminal.tabName")}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => setRenameTabId(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!renameDraft.trim()}>
              {t("toolsPage.terminal.saveTabName")}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmModal
        open={closeTabId != null}
        title={t("toolsPage.terminal.closeTabTitle")}
        message={t("toolsPage.terminal.closeTabMessage", { name: closingTab ? titleFor(closingTab) : "" })}
        confirmLabel={t("toolsPage.terminal.closeTabAction")}
        onCancel={() => setCloseTabId(null)}
        onConfirm={() => {
          const id = closeTabId;
          setCloseTabId(null);
          if (id != null) closeTabNow(id);
        }}
      />
    </div>
  );
}
