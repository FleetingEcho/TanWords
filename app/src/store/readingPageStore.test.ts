import { beforeEach, describe, expect, it } from "vitest";
import { useReadingPageStore } from "./readingPageStore";

const reset = () => useReadingPageStore.setState({ view: "paste", openArticleId: null, session: 1 });

describe("readingPageStore", () => {
  beforeEach(reset);

  // The whole point: App.tsx unmounts the Reading page on navigation, so the
  // open article has to live somewhere that outlives the component.
  it("keeps the open article across a remount", () => {
    useReadingPageStore.getState().openArticle(42);

    // What a remount sees.
    expect(useReadingPageStore.getState().openArticleId).toBe(42);
    expect(useReadingPageStore.getState().session).toBe(1);
  });

  it("remembers which list view you left off on", () => {
    useReadingPageStore.getState().setView("library");
    expect(useReadingPageStore.getState().view).toBe("library");
  });

  it("returns to the library on a fresh sheet", () => {
    useReadingPageStore.getState().openArticle(42);
    useReadingPageStore.getState().backToLibrary();

    const state = useReadingPageStore.getState();
    expect(state.openArticleId).toBeNull();
    expect(state.view).toBe("library");
    // Bumped, so the scratch reader is re-keyed and the previous paste is gone
    // rather than waiting there when you switch back to "paste".
    expect(state.session).toBe(2);
  });

  it("switches from one article straight to another", () => {
    useReadingPageStore.getState().openArticle(42);
    useReadingPageStore.getState().openArticle(7);

    expect(useReadingPageStore.getState().openArticleId).toBe(7);
    // No sheet churn — nothing about the paste session changed.
    expect(useReadingPageStore.getState().session).toBe(1);
  });
});
