/** Removal guards for the manager window's chrome (user requests, 2026-09):
 *  the gear + settings panel are gone (there was never a dedicated sticky
 *  settings modal, and the panel kept black-screening), and so are the
 *  cascade/tile window-arrangement buttons. The list actions the user
 *  actually uses — show all, hide all, help, search, export — must stay. */
import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { StickyManagerApp } from "./StickyManagerApp";

describe("StickyManagerApp has no settings surface", () => {
  it("renders no settings gear and no panel content", () => {
    const { container } = render(<StickyManagerApp />);
    expect(container.querySelector('button[title="sticky.settings"]')).toBeNull();
    // No button titles / tooltips mentioning settings at all.
    const anySettingsButton = Array.from(container.querySelectorAll("button")).some(
      (b) => b.getAttribute("title")?.toLowerCase().includes("settings"),
    );
    expect(anySettingsButton).toBe(false);
    // The panel's rows must not exist anywhere in the window.
    expect(container.textContent).not.toMatch(/hotkey|translucent|Import from tanNotes/i);
  });

  it("renders no cascade/tile arrangement buttons", () => {
    const { container } = render(<StickyManagerApp />);
    expect(screen.queryByTitle(/cascade/i)).toBeNull();
    expect(screen.queryByTitle(/tile/i)).toBeNull();
    expect(screen.queryByTitle(/层叠|平铺/)).toBeNull();
    expect(container.textContent).not.toMatch(/cascade|tile/i);
  });

  it("keeps the list actions the user actually uses", () => {
    const { container } = render(<StickyManagerApp />);
    // Show all / hide all / help stay (titles are translated, e.g. "Show all").
    const showAll = screen.queryByTitle(/show all/i) ?? screen.queryByTitle(/全部显示/);
    const hideAll = screen.queryByTitle(/hide all/i) ?? screen.queryByTitle(/全部隐藏/);
    expect(showAll).not.toBeNull();
    expect(hideAll).not.toBeNull();
    fireEvent.click(showAll!);
    // Clicking show-all must not reveal any settings UI.
    expect(container.textContent).not.toMatch(/hotkey|translucent/i);
  });
});

describe("StickyManagerApp popovers dismiss on outside press", () => {
  it("closes the templates popover when pressing elsewhere", () => {
    const { container } = render(<StickyManagerApp />);
    const chevron = screen.queryByTitle(/template/i) ?? screen.queryByTitle(/模板/i);
    expect(chevron).not.toBeNull();
    fireEvent.click(chevron!);
    expect(screen.queryByText("Blank note")).not.toBeNull();
    // A pointer press outside the popover (here: the search box) closes it.
    const search = container.querySelector("input");
    expect(search).not.toBeNull();
    fireEvent.pointerDown(search!);
    expect(screen.queryByText("Blank note")).toBeNull();
  });
});
