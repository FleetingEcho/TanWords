import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  // CodeMirror measures its own layout. jsdom reporting zeroes is fine; not
  // implementing the methods at all is not.
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as never;
  Range.prototype.getBoundingClientRect = () =>
    ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }) as never;
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { selectNextOccurrence } from "@codemirror/search";
import { RawMarkdownEditor } from "./RawMarkdownEditor";

function renderEditor(value: string, onChange: (next: string) => void = () => {}) {
  const utils = render(<RawMarkdownEditor value={value} onChange={onChange} label="Raw Markdown" />);
  const dom = utils.container.querySelector<HTMLElement>(".cm-editor")!;
  return { ...utils, dom, view: EditorView.findFromDOM(dom)! };
}

describe("RawMarkdownEditor", () => {
  it("shows the source and labels itself for assistive tech", () => {
    const { view } = renderEditor("# Heading\n\nbody");
    expect(view.state.doc.toString()).toBe("# Heading\n\nbody");
    expect(screen.getByLabelText("Raw Markdown")).toBeInTheDocument();
  });

  it("reports edits upward", async () => {
    const onChange = vi.fn();
    const { view } = renderEditor("a", onChange);
    view.dispatch({ changes: { from: 1, insert: "b" } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("ab"));
  });

  it("takes an outside edit without echoing it back", () => {
    const onChange = vi.fn();
    const { rerender, dom } = renderEditor("first", onChange);
    onChange.mockClear();
    rerender(<RawMarkdownEditor value="second" onChange={onChange} label="Raw Markdown" />);

    expect(EditorView.findFromDOM(dom)!.state.doc.toString()).toBe("second");
    // The guard that matters: a parent-driven value must not be reported back
    // as though the user typed it, or the two ends ping-pong.
    expect(onChange).not.toHaveBeenCalledWith("second");
  });

  it("selects the next occurrence while keeping the earlier one — the point of Ctrl+D", () => {
    const { view } = renderEditor("foo bar foo baz foo");
    view.dispatch({ selection: { anchor: 0, head: 3 } });

    selectNextOccurrence(view);
    expect(view.state.selection.ranges).toHaveLength(2);

    selectNextOccurrence(view);
    expect(view.state.selection.ranges).toHaveLength(3);
    expect(view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to))).toEqual([
      "foo", "foo", "foo",
    ]);
  });

  it("edits every cursor at once", () => {
    const { view } = renderEditor("foo bar foo");
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    selectNextOccurrence(view);

    view.dispatch(view.state.replaceSelection("qux"));
    expect(view.state.doc.toString()).toBe("qux bar qux");
  });

  it("opens the app's own find bar, not the library's panel", async () => {
    const { dom } = renderEditor("needle in a haystack");
    screen.getByTitle("Find and replace (⌘F)").click();

    const find = await screen.findByLabelText("Find");
    expect(find).toBeInTheDocument();
    // The bundled panel would style itself with markup this project does not
    // own; it must stay shut.
    expect(dom.querySelector(".cm-panel.cm-search")).toBeNull();

    // Replace is behind a disclosure, the way VS Code hides it until asked.
    expect(screen.queryByLabelText("Replace")).toBeNull();
    screen.getByTitle("Show replace").click();
    // Distinct from the "Replace next" button beside it: two controls sharing
    // one accessible name is ambiguous to a screen reader, not just to a test.
    expect(await screen.findByLabelText("Replace")).toBeInTheDocument();
  });

  it("counts matches, which the library's panel never showed", async () => {
    renderEditor("foo bar foo baz foo");
    screen.getByTitle("Find and replace (⌘F)").click();

    const find = await screen.findByLabelText("Find");
    fireEvent.change(find, { target: { value: "foo" } });
    expect(await screen.findByText("3")).toBeInTheDocument();
  });

  it("replaces every match on demand", async () => {
    const onChange = vi.fn();
    const { view } = renderEditor("foo bar foo", onChange);
    screen.getByTitle("Find and replace (⌘F)").click();

    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    screen.getByTitle("Show replace").click();
    fireEvent.change(await screen.findByLabelText("Replace"), { target: { value: "qux" } });
    screen.getByTitle("Replace all").click();

    await waitFor(() => expect(view.state.doc.toString()).toBe("qux bar qux"));
  });

  it("formats on demand and goes quiet once there is nothing to do", async () => {
    const onChange = vi.fn();
    const { rerender } = renderEditor("#Title\n\n\n* a\n* b", onChange);

    const button = screen.getByTitle("Format Markdown");
    expect(button).toBeEnabled();
    button.click();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("# Title\n\n- a\n- b\n"));

    rerender(<RawMarkdownEditor value={"# Title\n\n- a\n- b\n"} onChange={onChange} label="Raw Markdown" />);
    // Not synchronous: deciding this walks every line, so it runs once typing
    // settles rather than on the keystroke. The button holds its last answer in
    // between, which is why this waits rather than asserting straight away.
    await waitFor(() => expect(screen.getByTitle("Format Markdown")).toBeDisabled());
  });

  it("still offers line numbers and wrapping", () => {
    renderEditor("one\ntwo");
    expect(screen.getByTitle("Toggle line numbers")).toBeInTheDocument();
    expect(screen.getByTitle("Toggle word wrap")).toBeInTheDocument();
  });

  it("opens the find bar on what was selected", async () => {
    const { view } = renderEditor("alpha beta gamma");
    view.dispatch({ selection: { anchor: 6, head: 10 } });
    screen.getByTitle("Find and replace (⌘F)").click();

    // Searching for what you highlighted is what every other editor does;
    // retyping it into an empty box is the thing being fixed here.
    expect(await screen.findByLabelText<HTMLInputElement>("Find")).toHaveValue("beta");
  });

  it("does not seed the find bar from a whole paragraph", async () => {
    const { view } = renderEditor("first line\nsecond line");
    view.dispatch({ selection: { anchor: 0, head: 22 } });
    screen.getByTitle("Find and replace (⌘F)").click();

    // A multi-line selection is not a search term, it is text that happened to
    // be highlighted.
    expect(await screen.findByLabelText<HTMLInputElement>("Find")).toHaveValue("");
  });

  it("closes the find bar on Escape from the editor, not just from the bar", async () => {
    const { view } = renderEditor("needle");
    screen.getByTitle("Find and replace (⌘F)").click();
    await screen.findByLabelText("Find");

    fireEvent.keyDown(view.contentDOM, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Find")).toBeNull());
  });

  it("replaces immediately after typing, before the query has settled", async () => {
    const { view } = renderEditor("foo bar foo");
    screen.getByTitle("Find and replace (⌘F)").click();

    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    screen.getByTitle("Show replace").click();
    fireEvent.change(await screen.findByLabelText("Replace"), { target: { value: "qux" } });
    // No pause between the last keystroke and the click: the command has to run
    // against the query as typed, not against whatever last reached the editor.
    screen.getByTitle("Replace all").click();

    await waitFor(() => expect(view.state.doc.toString()).toBe("qux bar qux"));
  });

  it("continues a list on Enter", () => {
    const { view } = renderEditor("- item");
    view.dispatch({ selection: { anchor: 6 } });

    // Driven through the key, not by calling the command: `defaultKeymap` binds
    // Enter as well, and which of the two wins is the whole point.
    fireEvent.keyDown(view.contentDOM, { key: "Enter" });
    expect(view.state.doc.toString()).toBe("- item\n- ");
  });
});
