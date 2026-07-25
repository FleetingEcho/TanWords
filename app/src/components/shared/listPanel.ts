/** Shared width for the app's left-hand list panels (Vocabulary's word list, Documents'
 *  database/local-folder selectors) — a single source of truth so they can't quietly
 *  drift apart the way their background colors (bg-card vs bg-sidebar) once did. */
export const LIST_PANEL_WIDTH = "w-80";
export const LIST_PANEL_COLLAPSED_WIDTH = "w-11";

/** Shared icon color/hover for every list panel's collapse/expand toggle (the chevron
 *  button, in both its "collapse" and "expand" spot) — plain `variant="ghost"` alone
 *  leaves the icon at full foreground strength with no hover background, which is why
 *  the same ChevronsRight/ChevronsLeft icon was rendering a visibly different shade
 *  from one panel to the next. Combine with each button's own size/shape classes. */
export const LIST_PANEL_TOGGLE_CLASS = "text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";
