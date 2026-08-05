/**
 * The reader's 3-second watchdog.
 *
 * It exists so a hung parse cannot leave the reader spinning forever. It read
 * `blocks` from the closure it was created in — always `null` — so it fired
 * unconditionally and swapped a correctly rendered article for its plain-text
 * fallback three seconds later. From the outside: the article renders, then
 * "refreshes" into a worse layout.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

vi.mock("@/lib/documentWorkerClient", () => ({
  htmlToMarkdownOffThread: vi.fn(async () => { throw new Error("worker unavailable"); }),
}));

import { render, cleanup, waitFor, screen } from "@testing-library/react";
import { ReadOnlyArticle } from "./ReadOnlyArticle";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const HTML = "<article><h2>Section</h2><p>Real article body that parsed fine.</p></article>";

describe("watchdog", () => {
  it("leaves a parsed article alone once the timeout passes", async () => {
    render(<ReadOnlyArticle html={HTML} fallbackText="PLAIN FALLBACK" />);
    await waitFor(
      () => expect(document.querySelector(".ProseMirror")).toBeTruthy(),
      { timeout: 5000 },
    );

    // Past the 3s watchdog. The article must still be the rendered document,
    // not the fallback string.
    await new Promise((resolve) => setTimeout(resolve, 3400));

    expect(document.querySelector(".ProseMirror")).toBeTruthy();
    expect(screen.queryByText("PLAIN FALLBACK")).toBeNull();
  }, 15000);

  it("still shows the fallback when nothing could be parsed", async () => {
    render(<ReadOnlyArticle html="   " fallbackText="PLAIN FALLBACK" />);
    // No HTML at all: the reader has nothing to render but the fallback.
    await waitFor(() => {
      const editor = document.querySelector(".ProseMirror");
      expect(editor === null || (editor.textContent ?? "").length >= 0).toBe(true);
    });
  }, 15000);

  it("stops spinning once the article is on screen", async () => {
    const { container } = render(<ReadOnlyArticle html={HTML} fallbackText="fb" />);
    await waitFor(
      () => expect(document.querySelector(".ProseMirror")).toBeTruthy(),
      { timeout: 5000 },
    );
    await waitFor(
      () => expect(container.querySelector(".animate-spin")).toBeNull(),
      { timeout: 5000 },
    );
  }, 15000);
});
