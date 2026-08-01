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

import { ReadOnlyBlockNote } from "./ReadOnlyBlockNote";

describe("ReadOnlyBlockNote render", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders article text through the BlockNote fallback path", async () => {
    render(
      <ReadOnlyBlockNote
        html="<article><h1>Title</h1><p>Hello article body</p></article>"
        fallbackText="Fallback body text"
      />,
    );

    await waitFor(() => expect(screen.getByText(/Hello article body/)).toBeTruthy(), { timeout: 5000 });
  });
});
