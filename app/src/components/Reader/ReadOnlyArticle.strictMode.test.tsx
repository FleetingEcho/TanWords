import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToMarkdown } from "@/lib/htmlToMarkdown";

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

vi.mock("@/lib/documentWorkerClient", () => ({
  htmlToMarkdownOffThread: vi.fn(async (html: string) => htmlToMarkdown(html)),
}));

import { ReadOnlyArticle } from "./ReadOnlyArticle";

describe("ReadOnlyArticle under StrictMode", () => {
  afterEach(() => vi.clearAllMocks());

  it("still renders article content after the double-invoked effect", async () => {
    const { container } = render(
      <StrictMode>
        <ReadOnlyArticle
          html="<article><h1>Title</h1><p>Hello article body</p></article>"
          fallbackText="Fallback body text"
        />
      </StrictMode>,
    );

    await waitFor(
      () => {
        const bn = container.querySelector(".ProseMirror");
        expect(bn?.textContent ?? "").toContain("Hello article body");
      },
      { timeout: 5000 },
    );
  });
});
