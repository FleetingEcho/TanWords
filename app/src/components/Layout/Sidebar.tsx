import React, { useState } from "react";
import { NavPage } from "@/store/navStore";
import { useT } from "@/hooks/useT";
import { useDocDrawerStore } from "@/store/docDrawerStore";
import {
  GridIcon, CompassIcon, BookIcon, DocIcon, ChatIcon, SlidersIcon,
  HNIcon, PatternIcon, ReadingIcon, ChevronIcon,
} from "@/components/ui/icons";

const COLLAPSE_KEY = "tanwords_sidebar_collapsed";

interface NavItemDef {
  id: NavPage;
  label?: string;
  icon: React.FC<{ className?: string }>;
  badge?: string;
  showCount?: "word";
}

const NAV_ITEM_DEFS: Omit<NavItemDef, "label">[] = [
  { id: "dashboard", icon: GridIcon },
  { id: "discover", icon: CompassIcon },
  { id: "hackernews", icon: HNIcon },
  { id: "feeds", icon: HNIcon, badge: "NEW" },
  { id: "reading", icon: ReadingIcon, badge: "NEW" },
  { id: "vocabulary", icon: BookIcon, showCount: "word" },
  { id: "patterns", icon: PatternIcon, badge: "NEW" },
  { id: "documents", icon: DocIcon },
  { id: "chat", icon: ChatIcon },
  { id: "settings", icon: SlidersIcon },
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
  const openDrawer = useDocDrawerStore((s) => s.openDrawer);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const NAV_ITEMS: NavItemDef[] = NAV_ITEM_DEFS.map((d) => ({
    ...d,
    label: t(`nav.${d.id}`),
  }));

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

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

        {/* Quick-edit drawer trigger */}
        <div className="px-2 py-3 border-t border-[hsl(var(--sidebar-border))]">
          <button
            onClick={openDrawer}
            title={t("nav.editDoc")}
            className={`w-full flex items-center rounded-lg text-sm font-medium text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-100 ${
              collapsed ? "justify-center px-0 py-[9px]" : "gap-2.5 px-3 py-[7px]"
            }`}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[18px] h-[18px] shrink-0">
              <path d="M4 13.5V16h2.5l7.4-7.4-2.5-2.5L4 13.5z" strokeLinejoin="round" />
              <path d="M14.5 4.5l1 1a1 1 0 010 1.4l-1 1-2.5-2.5 1-1a1 1 0 011.5 0z" strokeLinejoin="round" />
            </svg>
            {!collapsed && <span className="flex-1 text-left">{t("nav.editDoc")}</span>}
          </button>
        </div>

      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
