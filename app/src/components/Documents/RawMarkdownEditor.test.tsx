import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { RawMarkdownEditor } from "./RawMarkdownEditor";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

it("uses the configured document text color for raw Markdown", () => {
  render(
    <RawMarkdownEditor
      value="# Raw Markdown"
      onChange={() => {}}
      label="Raw Markdown"
    />,
  );

  expect(screen.getByRole("textbox", { name: "Raw Markdown" })).toHaveStyle({
    color: "var(--document-text-color, hsl(var(--foreground)))",
  });
});
