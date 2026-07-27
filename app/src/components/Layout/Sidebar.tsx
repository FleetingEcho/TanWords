import React from "react";
import { ClipboardPaste, PanelLeft, Settings } from "lucide-react";
import { useLayoutStore } from "@/store/layoutStore";
import { useT } from "@/hooks/useT";
import {
  GridIcon, BookIcon, DocIcon, ChatIcon,
  FeedIcon, MusicIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { useSettingsStore, type SidebarTabId } from "@/store/settingsStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { CommandBar } from "@/components/Layout/CommandBar";
import type { NavPage } from "@/store/navStore";

interface NavItemDef {
  id: SidebarTabId;
  label: string;
  icon: React.FC<{ className?: string }>;
  badge?: string;
  showCount?: "word";
}

const NAV_ITEM_DEFS: Omit<NavItemDef, "label">[] = [
  { id: "dashboard", icon: GridIcon },
  { id: "feeds", icon: FeedIcon },
  { id: "reading", icon: ClipboardPaste },
  { id: "documents", icon: DocIcon },
  { id: "vocabulary", icon: BookIcon, showCount: "word" },
  { id: "chat", icon: ChatIcon },
  { id: "music", icon: MusicIcon },
];

/** Shared button chrome for both the customizable nav items and the pinned Settings
 *  entry below them, so active/collapsed styling stays in one place. */
function NavButton({
  icon: Icon,
  label,
  badge,
  active,
  collapsed,
  onClick,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  badge?: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`h-auto w-full flex items-center rounded-lg text-sm font-medium transition-colors duration-100 ${
        collapsed ? "justify-center px-0 py-[9px]" : "gap-2.5 px-3 py-[7px]"
      } ${
        active
          ? "bg-[hsl(var(--sidebar-active-bg))] text-[hsl(var(--sidebar-active-fg))] hover:bg-[hsl(var(--sidebar-active-bg))]"
          : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--muted))]"
      }`}
    >
      <span className="relative shrink-0">
        <Icon className="w-[18px] h-[18px]" />
        {collapsed && badge && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-500" />}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left">{label}</span>
          {badge && (
            <span className="text-[9px] font-bold bg-emerald-500 text-white rounded px-1 py-0.5 leading-none">
              {badge}
            </span>
          )}
        </>
      )}
    </Button>
  );
}

interface MainLayoutProps {
  children: React.ReactNode;
  activeNav: string;
  onNavigate: (id: string) => void;
  wordCount?: number;
}

export function MainLayout({
  children,
  activeNav,
  onNavigate,
  wordCount = 0,
}: MainLayoutProps) {
  const t = useT();
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useLayoutStore((s) => s.toggleSidebar);
  const visibleSidebarTabs = useSettingsStore((s) => s.visibleSidebarTabs);
  // Transparent instead of opaque when a custom app background is set, so AppBackground
  // (mounted behind this whole layout) shows through the page canvas — cards/sidebar
  // keep their own bg-card/bg-sidebar and stay opaque regardless.
  const hasCustomAppBackground = useSettingsStore((s) => !!s.appBackgroundImage);
  const podcastActive = usePodcastPlayerStore((s) => s.status !== "idle" && s.track !== null);
  const ttsActive = useTtsPlayerStore((s) => s.status !== "idle");
  const NAV_ITEMS: NavItemDef[] = NAV_ITEM_DEFS
    .filter((d) => visibleSidebarTabs.includes(d.id))
    .map((d) => ({ ...d, label: t(`nav.${d.id}`) }));

  return (
    <div className={`flex h-screen overflow-hidden ${hasCustomAppBackground ? "" : "bg-background"}`}>
      <aside
        className={`shrink-0 flex flex-col h-screen border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] select-none transition-[width] duration-200 ${
          collapsed ? "w-[60px]" : "w-[210px]"
        }`}
      >
        <div className={`flex items-center pt-5 pb-2 ${collapsed ? "px-2 justify-center" : "px-4 justify-between"}`}>
          {!collapsed && (
            <p className="text-[10px] font-semibold tracking-widest uppercase text-[hsl(var(--sidebar-muted))]">
              {t("nav.workspace")}
            </p>
          )}
          <Button
            variant="ghost"
            onClick={toggleCollapsed}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            className="w-6 h-6 p-0 flex items-center justify-center rounded-md text-[hsl(var(--sidebar-muted))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--sidebar-foreground))] transition-colors shrink-0"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </Button>
        </div>

        <nav className="flex-1 flex flex-col px-2 py-1 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              badge={item.badge}
              active={activeNav === item.id}
              collapsed={collapsed}
              onClick={() => onNavigate(item.id)}
            />
          ))}

          {/* Pinned below the customizable tabs — unlike NAV_ITEMS, always present
            * regardless of visibleSidebarTabs, since hiding it would leave the gear
            * icon in CommandBar as the only way back into Settings. */}
          <div className="mt-auto pt-1">
            <NavButton
              icon={Settings}
              label={t("nav.settings")}
              active={activeNav === "settings"}
              collapsed={collapsed}
              onClick={() => onNavigate("settings")}
            />
          </div>
        </nav>

      </aside>

      <main
        className={`flex min-w-0 flex-1 flex-col overflow-hidden box-border transition-[padding-bottom] duration-200 ${
          ttsActive ? "pb-20" : podcastActive ? "pb-16" : "pb-0"
        }`}
      >
        <CommandBar activePage={activeNav as NavPage} />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
