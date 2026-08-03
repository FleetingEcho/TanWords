import React from "react";
import { ClipboardPaste, Globe, PanelLeft, Settings } from "lucide-react";
import { useLayoutStore } from "@/store/layoutStore";
import { useT } from "@/hooks/useT";
import {
  GridIcon, BookIcon, DocIcon, ChatIcon,
  FeedIcon, MusicIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { useSettingsStore, type SidebarTabId } from "@/store/settingsStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { CommandBar } from "@/components/Layout/CommandBar";
import type { NavPage } from "@/store/navStore";
import { hostCapabilities } from "@/platform";
import { useIsNarrow } from "@/components/Vocabulary/hooks/useMediaQuery";

interface NavItemDef {
  id: SidebarTabId;
  label: string;
  icon: React.FC<{ className?: string }>;
  badge?: string;
  showCount?: "word";
}

const BASE_NAV_ITEM_DEFS: Omit<NavItemDef, "label">[] = [
  { id: "dashboard", icon: GridIcon },
  { id: "browser", icon: Globe },
  { id: "feeds", icon: FeedIcon },
  { id: "reading", icon: ClipboardPaste },
  { id: "documents", icon: DocIcon },
  { id: "vocabulary", icon: BookIcon, showCount: "word" },
  { id: "chat", icon: ChatIcon },
  { id: "music", icon: MusicIcon },
];

const NAV_ITEM_DEFS = BASE_NAV_ITEM_DEFS.filter((item) => {
  if (item.id === "browser") return hostCapabilities.browser;
  if (item.id === "music") return hostCapabilities.music;
  return true;
});

/** Fixed bottom tabs for flexible/narrow viewports. Feeds stays reachable
 * through Reading on the web-oriented shell; Settings is pinned for reach. */
const MOBILE_TAB_DEFS: { id: NavPage; icon: React.FC<{ className?: string }> }[] = [
  { id: "dashboard" as NavPage, icon: GridIcon as React.FC<{ className?: string }> },
  { id: "vocabulary" as NavPage, icon: BookIcon as React.FC<{ className?: string }> },
  { id: "reading" as NavPage, icon: ClipboardPaste as React.FC<{ className?: string }> },
  { id: "chat" as NavPage, icon: ChatIcon as React.FC<{ className?: string }> },
  { id: "documents" as NavPage, icon: DocIcon as React.FC<{ className?: string }> },
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
      aria-current={active ? "page" : undefined}
      // The active item is marked, not filled. A dictionary marks the sense
      // you are reading with a rule in the margin rather than by shading the
      // whole line — and a rule leaves the label at full contrast, which a
      // tinted block does not. The rule slides up from nothing on hover, so
      // pointing at an item already shows where it would take you.
      className={`group relative h-auto w-full flex items-center rounded-lg text-sm font-medium transition-colors duration-100 ${
        collapsed ? "justify-center px-0 py-[9px]" : "gap-2.5 px-3 py-[7px]"
      } ${
        // Both states name their own hover fill *and* hover colour, because the
        // ghost variant otherwise supplies `hover:bg-accent
        // hover:text-accent-foreground` — a matched pair meant for a solid
        // accent fill (bright pink in `dim`, bright purple in tokyo-night, with
        // dark text on top). Override one and not the other and the item
        // vanishes when you point at it: dark text on the `--muted` fill, or
        // the active item's light hue on the bright accent fill.
        //
        // Every item hovers to the same quiet `--muted` fill. The active one
        // keeps its hue through it; the others just come up to full contrast,
        // since hue here means "this is the page you are on" and the rule at
        // the left edge is what previews that.
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
  const hasCustomAppBackground = useSettingsStore((s) => !!s.appBackgroundImage && s.appBackgroundVisible);
  const podcastActive = usePodcastPlayerStore((s) => s.status !== "idle" && s.track !== null);
  const layoutMode = useSettingsStore((s) => s.layoutMode);
  const isNarrow = useIsNarrow();
  // Fixed is a wide-screen preference only. Below lg the mobile shell stays
  // in charge so a phone never gets a fixed desktop layout.
  const effectiveMode = layoutMode === "fixed" && !isNarrow ? "fixed" : "flexible";
  const mobile = effectiveMode === "flexible" && isNarrow;
  const NAV_ITEMS: NavItemDef[] = NAV_ITEM_DEFS
    .filter((d) => visibleSidebarTabs.includes(d.id))
    .map((d) => ({ ...d, label: t(`nav.${d.id}`) }));

  return (
    <div
      data-layout-mode={effectiveMode}
      className={`flex h-screen overflow-hidden ${hasCustomAppBackground ? "" : "bg-background"}`}
    >
      <aside
        className={`${mobile ? "hidden" : "flex"} shrink-0 flex-col h-screen border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] select-none transition-[width] duration-200 ${
          collapsed ? "w-[60px]" : "w-[210px]"
        }`}
      >
        <div className={`app-drag-region flex items-center pt-5 pb-3 ${collapsed ? "px-2 justify-center" : "px-4 justify-between"}`}>
          {/* The product's name, set the way the app sets a headword — rather
            * than the word "NAVIGATION", which labels something already
            * obvious from the list underneath it. Quiet enough to stay a
            * corner mark: the sign-in and lock screens are where this
            * treatment is allowed to be loud. */}
          {!collapsed && (
            <p className="flex items-baseline gap-1.5 leading-none">
              <span className="font-serif text-[15px] font-bold tracking-tight text-[hsl(var(--sidebar-foreground))]">
                TanWords
              </span>
              <span className="font-serif text-[11px] italic text-primary/70">n.</span>
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

      {/* Only the podcast bar is docked at the bottom and needs room reserved.
        * Speech used to have a bar of its own here too; its controls now live
        * in the top bar, so reserving space for it would just shove the page
        * up by 80px the moment anything started reading. */}
      <main
        // Phones stack the player bar on top of the tab bar, so an active
        // player needs its 3.25rem reserved as well or the last row of any
        // list sits underneath it.
        className={`flex min-w-0 flex-1 flex-col overflow-hidden box-border transition-[padding-bottom] duration-200 ${
          podcastActive
            ? "pb-[calc(8.25rem+env(safe-area-inset-bottom))] lg:pb-16"
            : "pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0"
        }`}
      >
        <CommandBar activePage={activeNav as NavPage} />
        {/* `overflow-x-hidden` is load-bearing, not defensive: `overflow-y: auto`
          * alone computes the *other* axis to `auto` too, so any page whose
          * content overran the viewport by a few pixels gave the whole shell a
          * horizontal scrollbar and slid the header and tab bar sideways with
          * it. Content that genuinely needs to scroll sideways (code blocks,
          * wide tables) scrolls inside its own box. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
      </main>

      {mobile && (
        <nav
          className="fixed bottom-0 inset-x-0 z-40 border-t border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] pb-[env(safe-area-inset-bottom)] select-none"
          aria-label="main navigation"
        >
          <div className="grid grid-cols-5">
            {MOBILE_TAB_DEFS.map(({ id, icon: Icon }) => {
              const isActive = activeNav === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onNavigate(id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  <span>{t(`nav.${id}`)}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
