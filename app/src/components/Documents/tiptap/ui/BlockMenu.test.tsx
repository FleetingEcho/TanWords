/**
 * The block menu's dismissal.
 *
 * It shipped with no dismissal at all — only selecting an action closed it, so
 * clicking anywhere else left it open indefinitely. These cover every way it
 * should go away, because "opens correctly" is only half a menu.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../schema";
import { blocksToPmDoc } from "../blockAdapter";
import { BlockMenu } from "./BlockMenu";
import type { Block } from "../blocks";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  cleanup();
  document.body.innerHTML = "";
});

function setup() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const blocks: Block[] = [
    { type: "paragraph", props: {}, content: [{ type: "text", text: "block text", styles: {} }] },
  ];
  const editor = new Editor({
    element,
    extensions: buildExtensions(),
    content: blocksToPmDoc(blocks) as never,
  });
  editors.push(editor);

  const onClose = vi.fn();
  render(
    <BlockMenu
      editor={editor}
      target={{ node: editor.state.doc.firstChild!, pos: 0 }}
      onClose={onClose}
    />,
  );
  return { editor, onClose };
}

describe("dismissal", () => {
  it("closes on a click outside", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on scroll", () => {
    const { onClose } = setup();
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open when clicking inside itself", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores clicks on its own trigger, leaving the toggle in charge", () => {
    // Otherwise the grip's toggle and this handler fight: close then reopen.
    const { onClose } = setup();
    const trigger = document.createElement("button");
    trigger.setAttribute("data-block-menu-trigger", "");
    document.body.appendChild(trigger);
    fireEvent.mouseDown(trigger);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after an action runs", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByText("Duplicate block"));
    expect(onClose).toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const { onClose } = setup();
    cleanup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("contents", () => {
  it("offers the block actions", () => {
    setup();
    for (const key of [
      "Turn into", "Reset formatting", "Duplicate block",
      "Copy to clipboard", "Ask AI about selection", "Delete",
    ]) {
      expect(screen.getByText(key), `missing menu item: ${key}`).toBeTruthy();
    }
  });

  it("reveals the turn-into options only when asked", () => {
    setup();
    expect(screen.queryByText("Heading 1")).toBeNull();
    fireEvent.mouseDown(screen.getByText("Turn into"));
    expect(screen.getByText("Heading 1")).toBeTruthy();
  });
});
