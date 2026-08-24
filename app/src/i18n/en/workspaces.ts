import type { Dict } from "../types";

/** Workspace (custom dashboard) strings. Phase 2 ships the model, persistence,
 *  and the sidebar entry + blank screen behind the feature flag; the picker,
 *  drag, and pane-header strings arrive in Phase 3. Keys are grouped so the
 *  later phases add to this file without churning unrelated namespaces. */
export const workspaces: Dict = {
  // Sidebar / navigation
  "workspaces.section": "Workspaces",
  "workspaces.new": "New workspace",
  "workspaces.empty.title": "No workspaces yet",
  "workspaces.empty.hint": "",
  "workspaces.untitled": "Untitled workspace",
  "workspaces.create": "Create workspace",
  "workspaces.rename": "Rename",
  "workspaces.duplicate": "Duplicate",
  "workspaces.delete": "Delete",
  "workspaces.reset": "Reset layout",
  "workspaces.undo": "Undo",
  "workspaces.deleteConfirm": "Delete this workspace? Its layout is discarded; the pages themselves are not affected.",
  "workspaces.resetConfirm": "Reset this workspace's layout to one empty pane? The pages themselves are not affected.",
  "workspaces.recoveredNotice": "Your saved workspaces could not be read and were reset to a clean list. The pages themselves were not affected.",
  "workspaces.recoveredDismiss": "Dismiss",
  "workspaces.edit": "Edit",
  "workspaces.done": "Done",
  // Pane header
  "workspaces.pane.splitRight": "Split right",
  "workspaces.pane.splitBelow": "Split below",
  "workspaces.pane.maximize": "Maximize pane",
  "workspaces.pane.restore": "Restore panes",
  "workspaces.pane.close": "Close pane",
  "workspaces.pane.replace": "Replace page",
  // Blank workspace screen
  "workspaces.blank.title": "Empty workspace",
  "workspaces.blank.hint": "Add a page to get started.",
  "workspaces.blank.addPage": "Add page",
  "workspaces.back": "Back",
  // Picker (Phase 3; defined now so adapters can reference them)
  "workspaces.picker.title": "Add a page",
  "workspaces.picker.search": "Search pages…",
  "workspaces.picker.empty": "No pages match.",
  "workspaces.picker.disabled.host": "Not available on this device.",
  "workspaces.picker.disabled.singleton": "Already in use — move it here instead.",
  "workspaces.picker.moveHere": "Move here",
  "workspaces.picker.group.pages": "Pages",
  "workspaces.picker.group.tools": "Tools",
  "workspaces.picker.group.native": "Native",
  "workspaces.picker.moveHereHint": "Move the {page} page here from where it is now",
};
