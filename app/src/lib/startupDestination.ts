import type { NavDestination } from "@/store/navStore";
import type { StartupDestination } from "@/store/settingsStore";
import type { HostCapabilities } from "@/platform/types";
import { PAGE_CATALOG } from "@/pages/pageCatalog";

/** Resolve a persisted preference against this host and the currently loaded
 * workspace collection. Invalid, deleted, disabled, or unsupported targets
 * deliberately fall back to Dashboard. */
export function resolveStartupDestination(
  preference: StartupDestination,
  workspaceIds: ReadonlySet<string>,
  capabilities: HostCapabilities,
  workspacesEnabled: boolean,
): NavDestination {
  if (preference.kind === "workspace") {
    return workspacesEnabled && workspaceIds.has(preference.workspaceId)
      ? { kind: "workspace", workspaceId: preference.workspaceId }
      : { kind: "page", page: "dashboard" };
  }

  const definition = PAGE_CATALOG.find((candidate) => candidate.id === preference.page);
  const available = definition
    && definition.id !== "settings"
    && (!definition.capability || capabilities[definition.capability]);
  return available
    ? { kind: "page", page: definition.id }
    : { kind: "page", page: "dashboard" };
}
