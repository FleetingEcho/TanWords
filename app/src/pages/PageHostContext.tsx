import React from "react";

/** Host facts a page truly needs. Most pages render unchanged and never read
 *  this context; only pages with a real viewport or native-lifecycle exception
 *  (Terminal, Browser, DSH) consult it. The host decides whether a page's
 *  content occupies the whole application or a single pane, so pages do not
 *  take an `embedded` prop.
 *
 *  Keeping this surface small is deliberate: every field here is something a
 *  page cannot derive from its own props or from the stores it already
 *  imports. A page that needs "am I visible" already gets it here; a page that
 *  needs "which word am I showing" still reads that from navStore or its own
 *  params, not from the host. */
export interface PageHostContextValue {
  /** `full` = the page owns the application viewport; `workspace` = the page
   *  renders inside one pane of a split layout. Phase 1 only uses `full`. */
  mode: "full" | "workspace";
  /** Stable id for this hosted instance. In full mode it is the page id; in
   *  workspace mode it is the pane's `instanceId`. Pages that key caches or
   *  listeners per instance use this. */
  instanceId: string;
  /** Whether the page is currently on screen. Retained/native pages use this
   *  to show/hide native surfaces and pause expensive work while hidden. */
  visible: boolean;
  /** Ask the host to make this pane the focused one (workspace mode). No-op
   *  in full mode, where the page is already the whole viewport. */
  requestFocus: () => void;
  /** Ask the host to open this page as a full application page (workspace
   *  mode only). No-op in full mode. */
  requestOpenFullPage: () => void;
}

const NOOP = () => {};

const FULL_MODE_DEFAULT: PageHostContextValue = {
  mode: "full",
  instanceId: "",
  visible: true,
  requestFocus: NOOP,
  requestOpenFullPage: NOOP,
};

const PageHostContext = React.createContext<PageHostContextValue>(FULL_MODE_DEFAULT);

export function PageHostProvider({ value, children }: { value: PageHostContextValue; children: React.ReactNode }) {
  return <PageHostContext.Provider value={value}>{children}</PageHostContext.Provider>;
}

export function usePageHost(): PageHostContextValue {
  return React.useContext(PageHostContext);
}
