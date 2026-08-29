import React from "react";
import { ClipboardPaste, Globe, Settings, TerminalSquare, Wrench } from "lucide-react";
import {
  GridIcon, BookIcon, DocIcon, ChatIcon,
  FeedIcon, MusicIcon, DshIcon, CalendarIcon,
} from "@/components/ui/icons";
import type { NavPage } from "@/store/navStore";
import type { HostCapabilities } from "@/platform/types";

/** The single source of truth for every navigable page.

 *  Before this catalog existed, `App.tsx` owned the lazy imports and the page
 *  switch while `Sidebar.tsx` separately owned the labels, icons, ordering, and
 *  capability filtering — two parallel definitions that had to be edited
 *  together to add a page. This catalog replaces both. It is the seam used by
 *  full-page navigation, the sidebar, the (future) page picker, and the
 *  (future) workspace pane host. Adding a page now means one entry here plus an
 *  `nav.${id}` i18n key.
 *
 *  `load` reshapes each page module to the `{ default: Component }` shape
 *  `React.lazy` expects, preserving the code-splitting and "load on first
 *  navigation, no idle prefetch" behaviour that keeps unused routes out of the
 *  startup chunk. */
export type PageHostKind = "react" | "retained" | "native";
export type PageMultiplicity = "multiple" | "singleton";

/** The lazy-loaded page module, normalized to the shape `React.lazy` wants.
 *  Pages with named exports are reshaped to `default` by their `load` entry. */
export interface PageModule {
  default: React.ComponentType<any>;
}

export interface PageDefinition {
  id: NavPage;
  /** i18n key for the page's display name, e.g. `nav.dashboard`. */
  titleKey: string;
  icon: React.ComponentType<{ className?: string }>;
  /** False for app destinations that are navigable but are not workspace
   * widgets and therefore must not appear in the workspace page picker. */
  workspaceWidget?: boolean;
  /** When set, the page is only offered on hosts with this capability. The
   *  sidebar and picker filter on it; a stale persisted nav state still falls
   *  back to Dashboard rather than rendering a page the host can't support. */
  capability?: keyof HostCapabilities;
  host: PageHostKind;
  multiplicity: PageMultiplicity;
  /** Minimum pane size in CSS pixels. Workspace dividers clamp against these
   *  so a page never gets squeezed below a usable size. Conservative defaults
   *  for now; refined per-page in Phase 3. */
  minWidth: number;
  minHeight: number;
  load: () => Promise<PageModule>;
}

/** Default minimums for ordinary React pages. Pages that genuinely need more
 *  room override these in their entry. */
const DEFAULT_MIN_WIDTH = 320;
const DEFAULT_MIN_HEIGHT = 240;

const reshaped = <T, K extends string>(m: T, key: K): PageModule =>
  ({ default: (m as any)[key] as React.ComponentType<any> });

export const PAGE_CATALOG: PageDefinition[] = [
  {
    id: "dashboard",
    titleKey: "nav.dashboard",
    icon: GridIcon,
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Dashboard/DashboardPage").then((m) => reshaped(m, "DashboardPage")),
  },
  {
    id: "calendar",
    titleKey: "nav.calendar",
    icon: CalendarIcon,
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Calendar/CalendarPage").then((m) => reshaped(m, "CalendarPage")),
  },
  {
    id: "feeds",
    titleKey: "nav.feeds",
    icon: FeedIcon,
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Feeds/FeedsPage").then((m) => reshaped(m, "FeedsPage")),
  },
  {
    id: "reading",
    titleKey: "nav.reading",
    icon: ClipboardPaste,
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Reader/ReadingPage").then((m) => reshaped(m, "ReadingPage")),
  },
  {
    id: "vocabulary",
    titleKey: "nav.vocabulary",
    icon: BookIcon,
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Vocabulary/VocabularyPage").then((m) => reshaped(m, "VocabularyPage")),
  },
  {
    id: "documents",
    titleKey: "nav.documents",
    icon: DocIcon,
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Documents/DocumentsPage").then((m) => reshaped(m, "DocumentsPage")),
  },
  {
    id: "chat",
    titleKey: "nav.chat",
    icon: ChatIcon,
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/AiChat/AiChatPage").then((m) => reshaped(m, "AiChatPage")),
  },
  {
    id: "settings",
    titleKey: "nav.settings",
    icon: Settings,
    workspaceWidget: false,
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Settings/SettingsPage").then((m) => reshaped(m, "SettingsPage")),
  },
  {
    id: "music",
    titleKey: "nav.music",
    icon: MusicIcon,
    capability: "music",
    host: "react",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Music/MusicPage"),
  },
  {
    id: "browser",
    titleKey: "nav.browser",
    icon: Globe,
    capability: "browser",
    // Native `WebContentsView` on desktop; an `<iframe>` fallback on web (the
    // fallback is hidden from the sidebar via `capability`, but a stale route
    // still renders it). Phase 4 gives this a dedicated bounds-measuring
    // adapter; for now it renders inline like a react page.
    host: "native",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Browser/BrowserPage"),
  },
  {
    id: "tools",
    titleKey: "nav.tools",
    icon: Wrench,
    // Retained: an in-progress utility keeps its state across ordinary
    // navigation. The adapter owns the visited/visible lifecycle that used to
    // live in App.tsx.
    host: "retained",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Tools/ToolsPage").then((m) => reshaped(m, "ToolsPage")),
  },
  {
    id: "terminal",
    titleKey: "nav.terminal",
    icon: TerminalSquare,
    capability: "terminal",
    host: "retained",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Terminal/TerminalPage").then((m) => reshaped(m, "TerminalPage")),
  },
  {
    id: "dsh",
    titleKey: "nav.dsh",
    icon: DshIcon,
    capability: "dsh",
    host: "retained",
    multiplicity: "singleton",
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    load: () => import("@/components/Dsh/DshPage").then((m) => reshaped(m, "DshPage")),
  },
];

const CATALOG_BY_ID = new Map<NavPage, PageDefinition>(
  PAGE_CATALOG.map((d) => [d.id, d]),
);

/** Lookup by id. Returns `undefined` for an unknown id rather than throwing,
 *  so callers can fall back gracefully. */
export function getPageDefinition(id: NavPage): PageDefinition | undefined {
  return CATALOG_BY_ID.get(id);
}

/** Warm a page's lazy chunk without mounting it.
 *
 *  Calling `load()` fetches the same dynamic-import chunk `React.lazy` will
 *  request later — the module registry caches by URL, so the later mount
 *  resolves instantly. Used at boot to overlap the destination page's chunk
 *  download with the settings round-trip; a prefetch of a page the user never
 *  opens costs one idle fetch and no mount. */
export function prefetchPage(id: NavPage): void {
  void getPageDefinition(id)?.load().catch(() => {});
}

/** Every NavPage must have exactly one catalog entry. The completeness test
 *  asserts this; it is also the invariant the sidebar/picker rely on. */
export function assertCatalogComplete(allPages: readonly NavPage[]): void {
  const ids = new Set(PAGE_CATALOG.map((d) => d.id));
  for (const p of allPages) {
    if (!ids.has(p)) {
      throw new Error(
        `pageCatalog is incomplete: NavPage "${p}" has no entry. Add it to PAGE_CATALOG.`,
      );
    }
  }
  if (CATALOG_BY_ID.size !== PAGE_CATALOG.length) {
    throw new Error("pageCatalog has duplicate ids.");
  }
}
