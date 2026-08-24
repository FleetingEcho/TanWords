import type { NavPage } from "@/store/navStore";

/** Resolve which built-in navigator item receives the active marker. */
export function resolveShellActiveNav(
  page: NavPage,
  workspaceActive: boolean,
  settingsOpen: boolean,
): NavPage | null {
  if (settingsOpen) return "settings";
  return workspaceActive ? null : page;
}
