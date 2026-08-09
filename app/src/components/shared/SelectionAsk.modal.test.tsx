import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { coarseMatchMedia } = vi.hoisted(() => ({
  coarseMatchMedia: vi.fn((query: string) => ({
    matches: query === "(pointer: coarse)",
    media: query,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    onchange: null,
  })),
}));

vi.mock("@/platform", () => ({
  isWebHost: true,
  hostCapabilities: { nativeTts: false },
}));

vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({
    getWords: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({
    targetLevels: ["C1"],
    selectionActions: true,
  }),
}));

vi.mock("@/providers/select", () => ({
  findBestProvider: () => null,
}));

vi.mock("@/components/ui/SpeakButton", () => ({
  SpeakButton: () => null,
}));

import { SelectionAsk } from "./SelectionAsk";

beforeEach(() => {
  window.matchMedia = coarseMatchMedia as unknown as typeof window.matchMedia;
  Range.prototype.getBoundingClientRect = () => ({
    top: 100,
    bottom: 120,
    left: 100,
    right: 180,
    width: 80,
    height: 20,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.documentElement.removeAttribute("data-touch-select");
});

describe("SelectionAsk in a modal event boundary", () => {
  it("opens when a modal descendant stops the bubbled mouseup event", async () => {
    render(
      <>
        <div role="dialog" onMouseUp={(event) => event.stopPropagation()}>
          <p data-testid="message">benchmark</p>
        </div>
        <SelectionAsk />
      </>,
    );

    const message = screen.getByTestId("message");
    const range = document.createRange();
    range.selectNodeContents(message.firstChild!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.mouseUp(message);

    const action = await screen.findByText("sel.addWord");
    expect(action).toBeInTheDocument();
    expect(action.closest('[role="dialog"]')).not.toBeNull();
  });

  it("augments mobile Web native selection without taking it over", async () => {
    render(
      <>
        <p data-testid="message">benchmark</p>
        <SelectionAsk />
      </>,
    );

    expect(document.documentElement).not.toHaveAttribute("data-touch-select");
    const message = screen.getByTestId("message");
    const contextMenu = new Event("contextmenu", { bubbles: true, cancelable: true });
    message.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(false);

    const range = document.createRange();
    range.selectNodeContents(message.firstChild!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    expect(await screen.findByText("sel.addWord")).toBeInTheDocument();
    expect(selection.toString()).toBe("benchmark");
  });
});
