import { describe, expect, it } from "vitest";
import {
  findSelectionOverlayHost,
  positionSelectionToolbar,
} from "./selectionToolbarPosition";

describe("positionSelectionToolbar", () => {
  it("places the toolbar on whole pixels without a transform", () => {
    expect(positionSelectionToolbar(
      { top: 140.75, left: 250.25 },
      { width: 301, height: 37 },
      800,
    )).toEqual({ top: 96, left: 100 });
  });

  it("keeps the toolbar inside the viewport", () => {
    expect(positionSelectionToolbar(
      { top: 80, left: 10 },
      { width: 300, height: 36 },
      800,
    )).toEqual({ top: 36, left: 8 });
  });
});

describe("findSelectionOverlayHost", () => {
  it("routes overlays into the dialog containing the selected text", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const text = document.createTextNode("selected text");
    dialog.append(text);
    document.body.append(dialog);
    const range = document.createRange();
    range.selectNodeContents(text);

    expect(findSelectionOverlayHost(range)).toBe(dialog);
    dialog.remove();
  });

  it("leaves ordinary page selections in the global overlay layer", () => {
    const text = document.createTextNode("selected text");
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);

    expect(findSelectionOverlayHost(range)).toBeNull();
    text.remove();
  });
});
