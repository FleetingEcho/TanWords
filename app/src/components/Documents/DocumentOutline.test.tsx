import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string) => key,
}));

import { DocumentScrollOutline } from "./DocumentOutline";

describe("DocumentOutline", () => {
  it("extracts heading text from nested inline content such as links", () => {
    const editor = {
      document: [
        {
          id: "h1",
          type: "heading",
          props: { level: 1 },
          content: [
            {
              type: "link",
              content: [{ type: "text", text: "Real heading", styles: {} }],
            },
          ],
        },
      ],
    };
    const viewportRef = createRef<HTMLDivElement>();
    viewportRef.current = document.createElement("div");
    Object.assign(editor, {
      getViewDom: () => document.createElement("div"),
      setTextCursorPosition: vi.fn(),
    });
    render(<DocumentScrollOutline editor={editor} viewportRef={viewportRef} />);
    expect(screen.getByText("Real heading")).toBeTruthy();
    expect(screen.queryByText("Untitled heading")).toBeNull();
  });

  it("shows a readable hover-card TOC alongside the compact heading rail", () => {
    const viewport = document.createElement("div");
    const root = document.createElement("div");
    for (const id of ["intro", "details"]) {
      const heading = document.createElement("h2");
      heading.dataset.id = id;
      root.appendChild(heading);
    }
    const viewportRef = createRef<HTMLDivElement>();
    viewportRef.current = viewport;
    const setTextCursorPosition = vi.fn();
    const editor = {
      getOutlineHeadings: () => [
        { id: "intro", level: 1, text: "Introduction" },
        { id: "details", level: 2, text: "Details" },
      ],
      getViewDom: () => root,
      setTextCursorPosition,
      onHistoryChange: () => () => {},
    };
    Element.prototype.scrollIntoView = vi.fn();

    render(<DocumentScrollOutline editor={editor} viewportRef={viewportRef} />);
    expect(screen.getByText("Introduction")).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
    fireEvent.click(screen.getByText("Details"));
    expect(setTextCursorPosition).toHaveBeenCalledWith("details", "start");
    expect(screen.getByText("Details").closest("button")?.getAttribute("aria-current")).toBe("location");
    expect(screen.getByText("II")).toBeTruthy();
  });

  it("smoothly scrolls the explicit RSS viewport when an outline item is clicked", async () => {
    const viewport = document.createElement("div");
    viewport.scrollTop = 300;
    viewport.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    const root = document.createElement("div");
    const heading = document.createElement("h2");
    heading.dataset.id = "target";
    heading.getBoundingClientRect = () => ({ top: 500 } as DOMRect);
    root.appendChild(heading);
    const viewportRef = createRef<HTMLDivElement>();
    viewportRef.current = viewport;
    const editor = {
      getOutlineHeadings: () => [{ id: "target", level: 1, text: "Target section" }],
      getViewDom: () => root,
      setTextCursorPosition: vi.fn(),
      onHistoryChange: () => () => {},
    };

    render(<DocumentScrollOutline editor={editor} viewportRef={viewportRef} />);
    fireEvent.click(screen.getByText("Target section"));

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 676, behavior: "smooth" }));
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith("target", "start");
  });

  it("updates the active heading when the real scroll viewport moves", async () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 400 });
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 400 } as DOMRect);
    const root = document.createElement("div");
    const first = document.createElement("h2");
    first.dataset.id = "first";
    first.getBoundingClientRect = () => ({ top: 80 - viewport.scrollTop } as DOMRect);
    const second = document.createElement("h2");
    second.dataset.id = "second";
    second.getBoundingClientRect = () => ({ top: 600 - viewport.scrollTop } as DOMRect);
    root.append(first, second);
    const viewportRef = createRef<HTMLDivElement>();
    viewportRef.current = viewport;
    const editor = {
      getOutlineHeadings: () => [
        { id: "first", level: 1, text: "First" },
        { id: "second", level: 1, text: "Second" },
      ],
      getViewDom: () => root,
      setTextCursorPosition: vi.fn(),
      onHistoryChange: () => () => {},
    };

    render(<DocumentScrollOutline editor={editor} viewportRef={viewportRef} />);
    await waitFor(() => expect(screen.getByText("First").closest("button")?.getAttribute("aria-current")).toBe("location"));
    viewport.scrollTop = 550;
    fireEvent.scroll(viewport);
    await waitFor(() => expect(screen.getByText("Second").closest("button")?.getAttribute("aria-current")).toBe("location"));
  });
});
