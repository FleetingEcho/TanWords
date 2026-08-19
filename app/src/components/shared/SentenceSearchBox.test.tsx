import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSentences: vi.fn(),
  saveSentence: vi.fn(),
  generateSentenceCandidate: vi.fn(),
  analyzeSentence: vi.fn(),
}));

vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({
    listSentences: mocks.listSentences,
    saveSentence: mocks.saveSentence,
  }),
}));
vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (select: (state: any) => unknown) => select({ targetLevels: ["B1"] }),
}));
vi.mock("@/store/navStore", () => ({
  useNavStore: (select: (state: any) => unknown) => select({ openVocabularySentence: vi.fn() }),
}));
vi.mock("@/providers/select", () => ({ findBestProvider: () => ({ generate: vi.fn() }) }));
vi.mock("@/features/patterns/generate", () => ({
  generateSentenceCandidate: mocks.generateSentenceCandidate,
  analyzeSentence: mocks.analyzeSentence,
}));
vi.mock("@/platform", () => ({ hostCapabilities: { nativeTts: false } }));
vi.mock("@/components/ui/SpeakButton", () => ({ SpeakButton: () => null }));
vi.mock("@/hooks/useDismissOnOutside", () => ({ useDismissOnOutside: () => {} }));
vi.mock("@/store/browserPanelStore", () => ({ BrowserPanelBlocker: () => null }));

import { SentenceSearchBox } from "./SentenceSearchBox";

const candidate = {
  sentence: "I bought a crisp apple at the market.",
  zh: "我在市场买了一个爽脆的苹果。",
  level: "B1",
  skeleton: "buy + noun + at + place",
  note: "用于描述购买行为。",
};

describe("SentenceSearchBox empty-result generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSentences.mockResolvedValue([]);
    mocks.saveSentence.mockResolvedValue(true);
  });

  it("shows no result plus a skeleton, then lets the user dismiss without saving", async () => {
    let finish!: (item: typeof candidate) => void;
    mocks.generateSentenceCandidate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<SentenceSearchBox />);

    const input = screen.getByPlaceholderText("vocab.sentences.quickSearchPlaceholder");
    fireEvent.change(input, { target: { value: "苹果" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("vocab.sentences.noMatch")).toBeTruthy();
    expect(screen.getByLabelText("common.loading")).toBeTruthy();
    finish(candidate);
    expect(await screen.findByText(candidate.sentence)).toBeTruthy();

    fireEvent.click(screen.getByText("common.cancel"));
    expect(screen.queryByText(candidate.sentence)).toBeNull();
    expect(mocks.saveSentence).not.toHaveBeenCalled();
  });

  it("saves exactly the generated candidate only after Add is chosen", async () => {
    mocks.generateSentenceCandidate.mockResolvedValue(candidate);
    render(<SentenceSearchBox />);

    const input = screen.getByPlaceholderText("vocab.sentences.quickSearchPlaceholder");
    fireEvent.change(input, { target: { value: "apple" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(candidate.sentence)).toBeTruthy();
    expect(mocks.saveSentence).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("vocab.sentences.add"));
    await waitFor(() => expect(mocks.saveSentence).toHaveBeenCalledWith(
      candidate.sentence,
      candidate.zh,
      candidate.note,
      candidate.level,
      "manual",
    ));
  });

  it("regenerates the candidate and only saves the replacement", async () => {
    const replacement = {
      ...candidate,
      sentence: "The apple tree blossomed early this year.",
      zh: "今年苹果树很早就开花了。",
    };
    mocks.generateSentenceCandidate
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce(replacement);
    render(<SentenceSearchBox />);

    const input = screen.getByPlaceholderText("vocab.sentences.quickSearchPlaceholder");
    fireEvent.change(input, { target: { value: "苹果" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(candidate.sentence)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("vocab.sentences.regenerate"));
    expect(await screen.findByText(replacement.sentence)).toBeTruthy();
    expect(screen.queryByText(candidate.sentence)).toBeNull();

    fireEvent.click(screen.getByText("vocab.sentences.add"));
    await waitFor(() => expect(mocks.saveSentence).toHaveBeenCalledWith(
      replacement.sentence,
      replacement.zh,
      replacement.note,
      replacement.level,
      "manual",
    ));
  });

  it("offers opt-in generation when saved results already match", async () => {
    mocks.listSentences.mockResolvedValue([{
      id: 1,
      sentence: "The transition was seamless.",
      zh: "天衣无缝",
      note: "",
      level: "B2",
      source: "manual",
      article_id: null,
      starred: false,
      created_at: "",
      updated_at: "",
    }]);
    mocks.generateSentenceCandidate.mockResolvedValue(candidate);
    render(<SentenceSearchBox />);
    await waitFor(() => expect(mocks.listSentences).toHaveBeenCalled());

    const input = screen.getByPlaceholderText("vocab.sentences.quickSearchPlaceholder");
    fireEvent.change(input, { target: { value: "seamless" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("The transition was seamless.")).toBeTruthy();
    expect(mocks.generateSentenceCandidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("vocab.sentences.generateSentence"));
    expect(await screen.findByText(candidate.sentence)).toBeTruthy();
  });
});
