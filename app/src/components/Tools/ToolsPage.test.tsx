import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform", () => ({
  hostCapabilities: { terminal: true },
}));

vi.mock("./ImageReducerTool", () => ({
  ImageReducerTool: () => <div>Image reducer workspace</div>,
}));

import { ToolsPage } from "./ToolsPage";

describe("ToolsPage", () => {
  it("contains utility tools without embedding the standalone terminal", () => {
    const view = render(<ToolsPage visible />);

    expect(screen.queryByRole("button", { name: /Terminal/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Image reducer/i }));
    expect(screen.getByText("Image reducer workspace")).toBeInTheDocument();

    view.rerender(<ToolsPage visible={false} />);
    expect(screen.getByTestId("tools-page-host")).not.toBeVisible();
  });
});
