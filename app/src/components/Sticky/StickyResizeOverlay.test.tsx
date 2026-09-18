/** Contract tests for the sticky window's click surface.
 *
 *  Regression: the 8-way resize handles were wrapped in a bare
 *  `absolute inset-0` div painted LAST — a transparent div still hit-tests,
 *  so that invisible overlay sat above the header/toolbar/editor and the
 *  whole note was unclickable ("cannot click anything on this window",
 *  2026-09). StickyResizeOverlay now owns the wrapper (pointer-events-none)
 *  and the shared handle strips opt back in (pointer-events-auto), so only
 *  the thin edges/corners are interactive. */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StickyResizeOverlay } from "./StickyResizeOverlay";
import { FloatingBrowserResizeHandles } from "@/components/FloatingBrowser/FloatingBrowserResizeHandle";

describe("StickyResizeOverlay", () => {
  it("is a full-window overlay that never intercepts pointers", () => {
    const { container } = render(
      <StickyResizeOverlay>
        <span>handles</span>
      </StickyResizeOverlay>,
    );
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain("absolute inset-0");
    expect(overlay.className).toContain("pointer-events-none");
  });

  it("keeps the 8 resize strips interactive through the none-wrapper", () => {
    const noop = () => {};
    const { container } = render(
      <StickyResizeOverlay>
        <FloatingBrowserResizeHandles
          onResizePointerDown={noop}
          onResizePointerMove={noop}
          onResizePointerUp={noop}
        />
      </StickyResizeOverlay>,
    );
    const handles = Array.from(
      container.querySelectorAll('[class*="cursor-ns-resize"], [class*="cursor-ew-resize"], [class*="cursor-nwse-resize"], [class*="cursor-nesw-resize"]'),
    );
    expect(handles.length).toBe(8);
    for (const handle of handles) {
      expect(handle.className).toContain("pointer-events-auto");
    }
  });
});
