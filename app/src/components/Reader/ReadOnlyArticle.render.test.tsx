import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  htmlToMarkdownOffThread: vi.fn(async () => {
    throw new Error("worker unavailable in test");
  }),
}));

import { ReadOnlyArticle } from "./ReadOnlyArticle";

describe("ReadOnlyArticle render", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders article text through the fallback path", async () => {
    render(
      <ReadOnlyArticle
        html="<article><h1>Title</h1><p>Hello article body</p></article>"
        fallbackText="Fallback body text"
      />,
    );

    await waitFor(() => expect(screen.getByText(/Hello article body/)).toBeTruthy(), { timeout: 5000 });
  });

  it("hides the outline column when the article has no headings", async () => {
    const { container } = render(
      <ReadOnlyArticle
        html="<article><p>Just a plain paragraph, no headings at all.</p></article>"
        fallbackText="Fallback body text"
      />,
    );

    await waitFor(
      () => expect(container.querySelector(".ProseMirror")?.textContent ?? "").toContain("Just a plain paragraph"),
      { timeout: 5000 },
    );
    expect(container.querySelector("aside")).toBeNull();
    expect(container.textContent ?? "").not.toContain("outline");
  });

  it("renders the header slot inside the article column", async () => {
    const { container } = render(
      <ReadOnlyArticle
        html="<article><h2>Section One</h2><p>Hello article body</p></article>"
        fallbackText="Fallback body text"
        header={<h1>How Do I Profile eBPF Code?</h1>}
      />,
    );

    await waitFor(() => expect(screen.getByText("How Do I Profile eBPF Code?")).toBeTruthy(), { timeout: 5000 });
    // The article has a heading, so the compact outline rail shows one marker.
    await waitFor(() => expect(container.querySelectorAll(".document-scroll-outline button").length).toBe(1), { timeout: 5000 });
  });
});
