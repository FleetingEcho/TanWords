import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const saveSentence = vi.fn().mockResolvedValue({ created: true });
const addWord = vi.fn().mockResolvedValue({ id: 1 });

vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));

vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({
    getWords: vi.fn().mockResolvedValue([]),
    saveSentence,
    addWord,
  }),
}));

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ targetLevels: ["C1"], selectionActions: true }),
}));

vi.mock("@/providers/select", () => ({ findBestProvider: () => null }));
vi.mock("@/components/ui/SpeakButton", () => ({ SpeakButton: () => null }));
vi.mock("@/components/shared/InlineAskPanel", () => ({
  InlineAskPanel: () => <div data-testid="answer" />,
}));

import { BrowserAskPane } from "./BrowserAskPane";

const type = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("browser.askPlaceholder"), { target: { value } });

describe("BrowserAskPane", () => {
  it("offers the toolbar's save slot, which the pane previously lacked entirely", async () => {
    render(<BrowserAskPane onClose={() => {}} />);

    type("The committee has been debating the proposal for several weeks.");

    fireEvent.click(await screen.findByText("sel.savePattern"));

    await waitFor(() =>
      expect(saveSentence).toHaveBeenCalledWith(
        "The committee has been debating the proposal for several weeks.",
        "", "", "",
        // Attribution, so a sentence kept from a web page is traceable later.
        "browser",
      ),
    );
  });

  it("switches the save slot to vocabulary for a word-length selection", async () => {
    render(<BrowserAskPane onClose={() => {}} />);

    type("consensus");

    // Same slot, different meaning — mirroring the floating toolbar.
    expect(await screen.findByText("sel.addWord")).toBeInTheDocument();
    expect(screen.queryByText("sel.savePattern")).not.toBeInTheDocument();
    // And the "go deeper" slot becomes a lookup rather than a follow-up.
    expect(screen.getByText("sel.lookup")).toBeInTheDocument();
  });

  it("keeps the input and actions visible while an answer streams", async () => {
    render(<BrowserAskPane onClose={() => {}} />);

    type("The proposal was rejected.");
    fireEvent.click(screen.getByText("sel.translate"));

    expect(await screen.findByTestId("answer")).toBeInTheDocument();
    // Asking a second thing about the same passage must not require re-pasting.
    expect(screen.getByPlaceholderText("browser.askPlaceholder")).toBeInTheDocument();
    expect(screen.getByText("sel.savePattern")).toBeInTheDocument();
  });
});
