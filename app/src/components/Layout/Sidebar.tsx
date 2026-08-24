import React from "react";
import { PanelLeft, Settings } from "lucide-react";
import { SIDEBAR_WIDTH, useLayoutStore } from "@/store/layoutStore";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { useSettingsStore, type SidebarTabId } from "@/store/settingsStore";
import { DEFAULT_SIDEBAR_TABS } from "@/store/settings/types";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { CommandBar } from "@/components/Layout/CommandBar";
import type { NavPage } from "@/store/navStore";
import { hostCapabilities } from "@/platform";
import { getPageDefinition, type PageDefinition } from "@/pages/pageCatalog";
import { useIsNarrow, useMediaQuery } from "@/components/Vocabulary/hooks/useMediaQuery";
import { MobileNavDock, type DockNavItem } from "@/components/Layout/MobileNavDock";
import { WorkspaceNavSection } from "@/components/Layout/WorkspaceNavSection";
import { usePageDragSource } from "@/components/Workspaces/DropZones";
import { usePointerDragSource } from "@/components/Workspaces/usePointerDragSource";
import { useWorkspacesEnabled } from "@/pages/workspaceFeature";

interface NavItemDef {
  id: SidebarTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  showCount?: "word";
}

/** Sidebar nav items derive from the central page catalog: the icon and the
 *  capability gate come from each page's `PageDefinition`, so this file no
 *  longer keeps a parallel list of icons and `hostCapabilities` checks that
 *  have to be edited in lockstep with `App.tsx` (now `pageCatalog.tsx`).
 *
 *  `settings` is intentionally absent — it is pinned separately below the
 *  customizable tabs so it stays reachable regardless of `visibleSidebarTabs`,
 *  and the catalog's `settings` entry exists for full-page navigation, not for
 *  the sidebar row list. */
const NAV_ITEM_DEFS: Omit<NavItemDef, "label">[] = DEFAULT_SIDEBAR_TABS
  .map((id) => getPageDefinition(id))
  .filter((d): d is PageDefinition => !!d && (!d.capability || hostCapabilities[d.capability]))
  .map((d) => ({ id: d.id as SidebarTabId, icon: d.icon }));

/** Shared button chrome for both the customizable nav items and the pinned Settings
 *  entry below them, so active/collapsed styling stays in one place. */
function NavButton({
  icon: Icon,
  label,
  badge,
  active,
  collapsed,
  onClick,
  dragSource,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  /** When provided, the item is draggable as a page source for workspace
   *  drop zones. Only enabled when workspaces are on and the shell is in
   *  edit mode (so normal click-to-navigate is not intercepted). */
  dragSource?: ReturnType<typeof usePageDragSource>;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      {...(dragSource ?? {})}
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

/** A nav button that is also a draggable page source for workspaces. Split
 *  out so the hooks (`usePageDragSource` + `usePointerDragSource`) run at the
 *  top of a component, not inside a `.map` callback (rules of hooks). */
function DraggableNavButton(props: {
  item: NavItemDef;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  canDrag: boolean;
}) {
  const dragSource = props.canDrag ? usePageDragSource(props.item.id) : undefined;
  // The pointer path (touch/pen + custom preview) drops via the global
  // PointerDropDispatcher, so the source's onDrop is a no-op.
  const pointerSource = usePointerDragSource(props.item.id, () => {});
  return (
    <div {...(props.canDrag ? pointerSource : {})}>
      <NavButton
        key={props.item.id}
        icon={props.item.icon}
        label={props.item.label}
        badge={props.item.badge}
        active={props.active}
        collapsed={props.collapsed}
        onClick={props.onClick}
        dragSource={dragSource}
      />
    </div>
  );
}

interface MainLayoutProps {
  children: React.ReactNode;
  activeNav: string;
  onNavigate: (id: string) => void;
  wordCount?: number;
  /** Terminal maximize mode removes app chrome without invoking the fragile
   * browser fullscreen API or unmounting the live PTY. */
  immersive?: boolean;
}

export function MainLayout({
  children,
  activeNav,
  onNavigate,
  wordCount = 0,
  immersive = false,
}: MainLayoutProps) {
  const t = useT();
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useLayoutStore((s) => s.toggleSidebar);
  const visibleSidebarTabs = useSettingsStore((s) => s.visibleSidebarTabs);
  const sidebarTabOrder = useSettingsStore((s) => s.sidebarTabOrder);
  const hasCustomAppBackground = useSettingsStore((s) => !!s.appBackgroundImage && s.appBackgroundVisible);
  const podcastActive = usePodcastPlayerStore((s) => s.status !== "idle" && s.track !== null);
  const layoutMode = useSettingsStore((s) => s.layoutMode);
  const isNarrow = useIsNarrow();
  // Fixed is a wide-screen preference only. Below lg the mobile shell stays
  // in charge so a phone never gets a fixed desktop layout.
  const effectiveMode = layoutMode === "fixed" && !isNarrow ? "fixed" : "flexible";
  // Phone and tablet both hand navigation to the floating dock. A tablet is
  // wide enough for a sidebar but spending desktop-sidebar width on
  // a list of nine links is a poor trade, and the dock costs nothing at rest.
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  const compact = effectiveMode === "flexible" && (isNarrow || isTablet);
  // Built-in sidebar pages become draggable sources only when workspaces are
  // enabled and a workspace is the active destination — the plan's "become
  // draggable on desktop" while a workspace is open. Outside that, the items
  // stay plain click-to-navigate so page-level drag (editor handles) and
  // selection are not intercepted.
  const workspacesEnabled = useWorkspacesEnabled();
  const canDragPages = workspacesEnabled && !compact;
  // Rendered in the user's drag-reordered sequence (from Settings' Sidebar
  // tabs grid), not NAV_ITEM_DEFS' declaration order — sidebarTabOrder covers
  // every tab id, so ids this host lacks capabilities for (absent from
  // NAV_ITEM_DEFS) just drop out of the lookup below.
  const navItemDefsById = new Map(NAV_ITEM_DEFS.map((d) => [d.id, d]));
  const NAV_ITEMS: NavItemDef[] = sidebarTabOrder
    .map((id) => navItemDefsById.get(id))
    .filter((d): d is Omit<NavItemDef, "label"> => !!d && visibleSidebarTabs.includes(d.id))
    .map((d) => ({ ...d, label: t(`nav.${d.id}`) }));
  // Settings rides along in the dock: without it the CommandBar gear is the
  // only way in, since there is no sidebar to pin it below.
  const DOCK_ITEMS: DockNavItem[] = [
    ...NAV_ITEMS.map((d) => ({ id: d.id as NavPage, label: d.label, icon: d.icon })),
    { id: "settings" as NavPage, label: t("nav.settings"), icon: Settings },
  ];

  return (
    <div
      data-layout-mode={effectiveMode}
      className={`app-viewport-height flex overflow-hidden overscroll-none ${hasCustomAppBackground ? "" : "bg-background"}`}
    >
      <aside
        aria-hidden={immersive || undefined}
        style={collapsed ? undefined : { width: SIDEBAR_WIDTH }}
        // Collapsed animates to `w-0` + `overflow-hidden` (truly zero width,
        // contents clipped) rather than the old 60px icon strip. The expand
        // control lives in the CommandBar so it stays reachable when the
        // sidebar is fully gone. `border-r` only when expanded so no 1px line
        // remains at width 0.
        className={`${compact || immersive ? "hidden" : "flex"} h-full shrink-0 flex-col select-none transition-[width] duration-200 overflow-hidden ${
          collapsed ? "w-0 border-r-0" : "border-r border-[hsl(var(--sidebar-border))]"
        } ${hasCustomAppBackground ? "bg-transparent" : "bg-[hsl(var(--sidebar))]"}`}
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
            <DraggableNavButton
              key={item.id}
              item={item}
              active={activeNav === item.id}
              collapsed={collapsed}
              onClick={() => onNavigate(item.id)}
              canDrag={canDragPages}
            />
          ))}

          {/* Custom workspaces (gated behind the feature flag). Sits between
            * the built-in pages and the pinned Settings entry so it reads as
            * a user-managed section rather than a built-in tab. */}
          <WorkspaceNavSection collapsed={collapsed} />

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
        // The dock floats over the page rather than pushing it, so compact
        // widths only reserve enough for its own height plus the player bar
        // when that is docked underneath it. `lg:` can't express this: the
        // breakpoint is 768px and tablets up to 1023px are compact too.
        className={`flex min-w-0 flex-1 flex-col overflow-hidden box-border transition-[padding-bottom] duration-200 ${
          immersive
            ? "pb-0"
            : compact
            ? podcastActive
              // 64px player + dock button + 5px breathing room on each side.
              ? "pb-[calc(7.125rem+env(safe-area-inset-bottom))] sm:pb-[calc(8.125rem+env(safe-area-inset-bottom))]"
              // The phone button is 40px; from sm upward it is 56px. Keep the
              // reserved band to exactly button height + roughly 5px above/below.
              : "pb-[calc(3.125rem+env(safe-area-inset-bottom))] sm:pb-[calc(4.125rem+env(safe-area-inset-bottom))]"
            : podcastActive
              ? "pb-16"
              : "pb-0"
        }`}
      >
        {!immersive && <CommandBar activePage={activeNav as NavPage} />}
        {/* `overflow-x-hidden` is load-bearing, not defensive: `overflow-y: auto`
          * alone computes the *other* axis to `auto` too, so any page whose
          * content overran the viewport by a few pixels gave the whole shell a
          * horizontal scrollbar and slid the header and tab bar sideways with
          * it. Content that genuinely needs to scroll sideways (code blocks,
          * wide tables) scrolls inside its own box. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
      </main>

      {compact && !immersive && (
        <MobileNavDock
          items={DOCK_ITEMS}
          activeNav={activeNav}
          onNavigate={onNavigate}
          align={isTablet ? "right" : "center"}
          raised={podcastActive}
        />
      )}
    </div>
  );
}
