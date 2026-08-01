import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { RawMarkdownEditor } from "./RawMarkdownEditor";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

it("keeps the raw Markdown textarea transparent over the highlighted layer", () => {
  render(
    <RawMarkdownEditor
      value="# Raw Markdown"
      onChange={() => {}}
      label="Raw Markdown"
    />,
  );

  expect(screen.getByRole("textbox", { name: "Raw Markdown" })).toHaveStyle({
    color: "rgba(0, 0, 0, 0)",
  });
  expect(document.querySelector(".rm-heading")).not.toBeNull();
  expect(document.querySelector(".rm-heading-text")?.textContent).toBe("Raw Markdown");
});
