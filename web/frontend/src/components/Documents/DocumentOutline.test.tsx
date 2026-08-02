import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string) => key,
}));

import { DocumentOutline } from "./DocumentOutline";

describe("DocumentOutline", () => {
  it("extracts heading text from nested inline content such as links", () => {
    const editor = {
      document: [
        {
          id: "h1",
          type: "heading",
          props: { level: 1 },
          content: [
            {
              type: "link",
              content: [{ type: "text", text: "Real heading", styles: {} }],
            },
          ],
        },
      ],
    };
    render(<DocumentOutline editor={editor} tick={0} />);
    expect(screen.getByText("Real heading")).toBeTruthy();
    expect(screen.queryByText("Untitled heading")).toBeNull();
  });
});
