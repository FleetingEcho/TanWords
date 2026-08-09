import { describe, expect, it } from "vitest";
import {
  findSelectionOverlayHost,
  positionSelectionToolbar,
} from "./selectionToolbarPosition";
import { anchorFromRange } from "./selectionAskHelpers";

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

  it("places a mobile toolbar below native selection when there is room", () => {
    expect(positionSelectionToolbar(
      { top: 100, bottom: 120, left: 160 },
      { width: 200, height: 36 },
      320,
      { preferBelow: true, viewportHeight: 640 },
    )).toEqual({ top: 128, left: 60 });
  });

  it("moves a mobile toolbar above selection near the viewport bottom", () => {
    expect(positionSelectionToolbar(
      { top: 590, bottom: 610, left: 160 },
      { width: 200, height: 36 },
      320,
      { preferBelow: true, viewportHeight: 640 },
    )).toEqual({ top: 546, left: 60 });
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

describe("anchorFromRange", () => {
  // jsdom has no layout; the rect only feeds toolbar placement, tested above.
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);

  function selection(content: string): Range {
    document.body.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = content;
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p.firstChild!);
    return range;
  }

  it("offers actions on a multi-paragraph selection", () => {
    // The old ceiling was 320, which quietly swallowed a two-paragraph drag —
    // a perfectly reasonable thing to want translated.
    const text = "One of the apps I run made the compromise difficult to ignore. ".repeat(6);
    expect(text.length).toBeGreaterThan(320);
    expect(anchorFromRange(selection(text))?.text).toBe(text.trim());
  });

  it("stays out of the way of a drag across the whole page", () => {
    expect(anchorFromRange(selection("word ".repeat(400)))).toBeNull();
  });

  it("ignores a selection with no English in it", () => {
    expect(anchorFromRange(selection("这一段全是中文，没有可查的词。"))).toBeNull();
  });
});
