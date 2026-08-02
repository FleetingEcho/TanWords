import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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


import { SelectionAsk } from "./SelectionAsk";

describe("SelectionAsk in a modal event boundary", () => {
  it("opens when a modal descendant stops the bubbled mouseup event", async () => {
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
});
