import React from "react";
import type { PageDefinition } from "@/pages/pageCatalog";
import { ReactPageAdapter } from "./ReactPageAdapter";

export interface BrowserPageAdapterProps {
  definition: PageDefinition;
  params?: Record<string, any>;
  visible?: boolean;
}

/** Host for the Browser page.
 *
 *  On Electron the Browser page drives a native `WebContentsView` composited
 *  above the HTML; on the web build it falls back to `<iframe>`s. Phase 1
 *  renders it exactly as it was — inline through the generic React adapter —
 *  because the sidebar already hides the entry on hosts without the
 *  `browser` capability, and a stale route still falls back to Dashboard
 *  before reaching here.
 *
 *  Phase 4 replaces the body of this adapter with a dedicated bounds-measuring
 *  host that hides/snapshots the native surface during drag overlays and
 *  dialogs (per the plan's native-page rollout). Keeping the adapter as a
 *  named seam now means that swap touches one file, not `App.tsx`. */
export function BrowserPageAdapter(props: BrowserPageAdapterProps) {
  return <ReactPageAdapter {...props} />;
}
