import type { NavPage } from "@/store/navStore";
import type { HostCapabilities } from "@/platform/types";
import { hostCapabilities, isDesktopHost } from "@/platform";

/** Pure page-resolution logic for the full-page host, kept out of the React
 *  component so it can be unit-tested without rendering. Each function takes
 *  the host environment as an optional argument (defaulting to this host's
 *  real values) so tests can exercise both the desktop and web capability
 *  surfaces deterministically.
 *
 *  These three predicates together reproduce exactly what `App.tsx` used to
 *  inline: which retained page owns the screen, which page a route falls
 *  back to, and whether the destination owns startup readiness itself. */

export type RetainedId = "tools" | "terminal" | "dsh";

export interface PageHostEnv {
  isDesktop: boolean;
  capabilities: HostCapabilities;
}

export const DESKTOP_PAGE_ENV: PageHostEnv = { isDesktop: true, capabilities: hostCapabilities };
export const PAGE_ENV: PageHostEnv = { isDesktop: isDesktopHost, capabilities: hostCapabilities };

/** Which retained page (if any) is the active destination. `null` means the
 *  main block owns the screen. `tools` is always retained; `terminal`/`dsh`
 *  are retained only on hosts that can run them — otherwise a stale route
 *  falls back to Dashboard through the main block. */
export function activeRetained(page: NavPage, env: PageHostEnv = PAGE_ENV): RetainedId | null {
  if (page === "tools") return "tools";
  if (page === "terminal" && env.capabilities.terminal) return "terminal";
  if (page === "dsh" && env.capabilities.dsh) return "dsh";
  return null;
}

/** The page to render in the main block after capability fallbacks. A route
 *  whose capability is missing on this host falls back to Dashboard. */
export function effectiveMainPage(page: NavPage, env: PageHostEnv = PAGE_ENV): NavPage {
  if (page === "music" && !env.isDesktop) return "dashboard";
  if (page === "browser" && !env.capabilities.browser) return "dashboard";
  if (page === "terminal" && !env.capabilities.terminal) return "dashboard";
  if (page === "dsh" && !env.capabilities.dsh) return "dashboard";
  return page;
}

/** Whether the active destination owns startup readiness itself (Dashboard,
 *  or a web-fallback route that renders Dashboard) or whether the host fires
 *  `markStartupReady` on its behalf. */
export function pageOwnsStartupReadiness(page: NavPage, env: PageHostEnv = PAGE_ENV): boolean {
  return page === "dashboard"
    || (!env.isDesktop && page === "music")
    || (!env.capabilities.browser && page === "browser")
    || (!env.capabilities.terminal && page === "terminal")
    || (!env.capabilities.dsh && page === "dsh");
}

/** True when the main (non-retained) block should render for this page — i.e.
 *  no retained page owns the screen. */
export function isMainBlockActive(page: NavPage, env: PageHostEnv = PAGE_ENV): boolean {
  return activeRetained(page, env) === null;
}
