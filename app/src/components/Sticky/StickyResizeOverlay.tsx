/** The 8-way resize overlay for the frameless sticky window.
 *
 *  Regression guard (2026-09): this overlay must NEVER be a plain
 *  `absolute inset-0` div — a transparent div still hit-tests, and painted
 *  last it sat above the header/toolbar/editor and swallowed EVERY click in
 *  the note ("cannot click anything on this window"). The wrapper is
 *  pointer-events-none; the handle strips inside FloatingBrowserResizeHandles
 *  opt back in with pointer-events-auto, so only the thin edges/corners are
 *  interactive. */
import type { ReactNode } from "react";

export function StickyResizeOverlay({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none absolute inset-0">{children}</div>;
}
