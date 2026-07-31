import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ ttsSpeed: 1, ttsVoiceId: "0" }),
    { getState: () => ({ ttsSpeed: 1, setTtsSpeed: vi.fn() }) },
  ),
}));

import { SpeakButton } from "./SpeakButton";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";

const reset = () =>
  useTtsPlayerStore.setState({ status: "idle", sourceKey: null, sentences: [], currentIndex: 0 });

describe("SpeakButton", () => {
  beforeEach(reset);

  // It owns no audio any more: everything goes through the shared player, which
  // is what gives a long selection sentence-splitting, prefetch, and a global
  // control that can still stop it after this button has gone.
  it("hands the text to the shared player instead of playing it itself", () => {
    render(<SpeakButton text="The committee has been debating. It has not decided." />);

    fireEvent.click(screen.getByRole("button"));

    const state = useTtsPlayerStore.getState();
    expect(state.status).toBe("loading");
    // Split, so synthesis happens a sentence at a time rather than in one call.
    expect(state.sentences.length).toBe(2);
  });

  it("stops when the speaker that is already speaking is pressed again", () => {
    render(<SpeakButton text="A sentence." />);

    fireEvent.click(screen.getByRole("button"));
    expect(useTtsPlayerStore.getState().status).not.toBe("idle");

    fireEvent.click(screen.getByRole("button"));
    expect(useTtsPlayerStore.getState().status).toBe("idle");
  });

  // Two buttons, one player: starting the second has to take over rather than
  // leave both looking active.
  it("hands over when a different button is pressed", () => {
    render(
      <>
        <SpeakButton text="First." />
        <SpeakButton text="Second." />
      </>,
    );
    const [first, second] = screen.getAllByRole("button");

    fireEvent.click(first);
    expect(useTtsPlayerStore.getState().sourceKey).toBe("speak:First.");

    fireEvent.click(second);
    expect(useTtsPlayerStore.getState().sourceKey).toBe("speak:Second.");
  });

  // The deliberate inversion of the old behaviour: speech used to be killed on
  // unmount because nothing else could reach it. Now the top-bar control can,
  // so closing the selection toolbar mid-sentence no longer cuts it off.
  it("keeps playing after the button that started it unmounts", () => {
    const { unmount } = render(<SpeakButton text="A long sentence to read." />);

    fireEvent.click(screen.getByRole("button"));
    unmount();

    expect(useTtsPlayerStore.getState().status).not.toBe("idle");
    expect(useTtsPlayerStore.getState().sourceKey).toBe("speak:A long sentence to read.");
  });
});
