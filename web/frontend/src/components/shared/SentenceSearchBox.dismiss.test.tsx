import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));

vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({
    listPatterns: vi.fn().mockResolvedValue([]),
    saveSentencePattern: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ targetLevels: ["C1"] }),
}));

vi.mock("@/store/navStore", () => ({
  useNavStore: (selector: (state: unknown) => unknown) =>
    selector({ openVocabularySentence: vi.fn() }),
}));


vi.mock("@/providers/select", () => ({ findBestProvider: () => ({ id: "test" }) }));

const analyzeSentence = vi.fn();
vi.mock("@/features/patterns/generate", () => ({
  analyzeSentence: (...args: unknown[]) => analyzeSentence(...args),
}));

import { SentenceSearchBox } from "./SentenceSearchBox";

const SENTENCE = "I don't think we can implement that";

const ZH = "我觉得我们无法实现这一点";

/** Types the sentence and presses Enter, then waits for its analysis to land. */
async function searchFor(input: HTMLElement, text = SENTENCE, zh = ZH) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText(zh);
}

describe("SentenceSearchBox dismissal", () => {
  beforeEach(() => {
    analyzeSentence.mockReset();
    analyzeSentence.mockResolvedValue({
      sentence: SENTENCE,
      zh: "我觉得我们无法实现这一点",
      level: "B2",
      skeleton: "don't think we can + verb",
      note: "用于表达对某项计划的可行性存疑",
    });
  });

  it("hides the results when the user clicks outside, and keeps them on re-open", async () => {
    render(
      <>
        <button data-testid="elsewhere">elsewhere</button>
        <SentenceSearchBox variant="inline" />
      </>,
    );
    const input = screen.getByPlaceholderText("vocab.patterns.quickSearchPlaceholder");

    await searchFor(input);
    expect(analyzeSentence).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    await waitFor(() =>
      expect(screen.queryByText("我觉得我们无法实现这一点")).not.toBeInTheDocument());

    // Hidden, not discarded: the box still holds the query and the analysis.
    expect(input).toHaveValue(SENTENCE);

    fireEvent.focus(input);
    expect(await screen.findByText("我觉得我们无法实现这一点")).toBeInTheDocument();
    expect(analyzeSentence).toHaveBeenCalledTimes(1);
  });

  it("re-opens on Enter without asking the model again when the query is unchanged", async () => {
    render(<SentenceSearchBox variant="inline" />);
    const input = screen.getByPlaceholderText("vocab.patterns.quickSearchPlaceholder");

    await searchFor(input);
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByText("我觉得我们无法实现这一点")).not.toBeInTheDocument());

    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("我觉得我们无法实现这一点")).toBeInTheDocument();
    expect(analyzeSentence).toHaveBeenCalledTimes(1);
  });

  it("analyzes again once the query actually changes", async () => {
    render(<SentenceSearchBox variant="inline" />);
    const input = screen.getByPlaceholderText("vocab.patterns.quickSearchPlaceholder");

    await searchFor(input);

    analyzeSentence.mockResolvedValue({
      sentence: "we should ship it today",
      zh: "我们今天就该发布",
      level: "B1",
      skeleton: "should + verb",
      note: "建议",
    });
    await searchFor(input, "we should ship it today", "我们今天就该发布");

    expect(analyzeSentence).toHaveBeenCalledTimes(2);
  });

  it("does not cancel an in-flight analysis when dismissed", async () => {
    let resolveAnalysis: (value: unknown) => void = () => {};
    analyzeSentence.mockReturnValue(new Promise((resolve) => { resolveAnalysis = resolve; }));

    render(
      <>
        <button data-testid="elsewhere">elsewhere</button>
        <SentenceSearchBox variant="inline" />
      </>,
    );
    const input = screen.getByPlaceholderText("vocab.patterns.quickSearchPlaceholder");
    fireEvent.change(input, { target: { value: SENTENCE } });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    resolveAnalysis({
      sentence: SENTENCE,
      zh: "我觉得我们无法实现这一点",
      level: "B2",
      skeleton: "don't think we can + verb",
      note: "语气中性偏谨慎",
    });

    // The request that was already running still lands, so re-opening shows a
    // finished analysis rather than restarting it.
    fireEvent.focus(input);
    expect(await screen.findByText("我觉得我们无法实现这一点")).toBeInTheDocument();
    expect(analyzeSentence).toHaveBeenCalledTimes(1);
  });
});
