import React from "react";
import { NavPage } from "@/store/navStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useT } from "@/hooks/useT";
import {
  GridIcon, BookIcon, DocIcon, ChatIcon, SlidersIcon,
  FeedIcon, ReadingIcon, ChevronIcon,
} from "@/components/ui/icons";

interface NavItemDef {
  id: NavPage;
  label?: string;
  icon: React.FC<{ className?: string }>;
  badge?: string;
  showCount?: "word";
}

const NAV_ITEM_DEFS: Omit<NavItemDef, "label">[] = [
  { id: "dashboard", icon: GridIcon },
  { id: "feeds", icon: FeedIcon },
  { id: "reading", icon: ReadingIcon },
  { id: "vocabulary", icon: BookIcon, showCount: "word" },
  { id: "documents", icon: DocIcon },
  { id: "chat", icon: ChatIcon },
];

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
  const NAV_ITEMS: NavItemDef[] = NAV_ITEM_DEFS.map((d) => ({
    ...d,
    label: t(`nav.${d.id}`),
  }));

  return (
    <div className="flex h-screen overflow-hidden bg-background">
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
          <button
            onClick={toggleCollapsed}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            className="w-6 h-6 flex items-center justify-center rounded-md text-[hsl(var(--sidebar-muted))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--sidebar-foreground))] transition-colors shrink-0"
          >
            <ChevronIcon direction={collapsed ? "right" : "left"} className="w-3.5 h-3.5" />
          </button>
        </div>

        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            const count = item.showCount === "word" ? wordCount : 0;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center rounded-lg text-sm font-medium transition-colors duration-100 ${
                  collapsed ? "justify-center px-0 py-[9px]" : "gap-2.5 px-3 py-[7px]"
                } ${
                  active
                    ? "bg-[hsl(var(--sidebar-active-bg))] text-[hsl(var(--sidebar-active-fg))]"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                <span className="relative shrink-0">
                  <item.icon className="w-[18px] h-[18px]" />
                  {collapsed && item.badge && (
                    <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  )}
                </span>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge && (
                      <span className="text-[9px] font-bold bg-emerald-500 text-white rounded px-1 py-0.5 leading-none">
                        {item.badge}
                      </span>
                    )}
                    {count > 0 && (
                      <span className="text-[10px] font-semibold min-w-[20px] text-center rounded-full px-1.5 leading-5 text-[hsl(var(--sidebar-muted))]">
                        {count > 999 ? "999+" : count}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {/* Settings — pinned to the bottom, always in the same place.
            Fixed h-14 matches the h-8-button-in-p-3-container footer bars
            used elsewhere (e.g. FeedRail's "+ Add feed"), so the sidebar's
            bottom border lines up with the page content's footer border. */}
        <div className="h-14 px-2 flex items-center border-t border-[hsl(var(--sidebar-border))]">
          <button
            onClick={() => onNavigate("settings")}
            title={collapsed ? t("nav.settings") : undefined}
            className={`w-full flex items-center rounded-lg text-sm font-medium transition-colors duration-100 ${
              collapsed ? "justify-center px-0 py-[9px]" : "gap-2.5 px-3 py-[7px]"
            } ${
              activeNav === "settings"
                ? "bg-[hsl(var(--sidebar-active-bg))] text-[hsl(var(--sidebar-active-fg))]"
                : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--muted))]"
            }`}
          >
            <SlidersIcon className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && <span className="flex-1 text-left">{t("nav.settings")}</span>}
          </button>
        </div>

      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
