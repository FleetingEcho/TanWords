import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextMatches } from "./documentSearch";

vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string) => key,
}));

import { DocumentContentSearch } from "./DocumentContentSearch";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findTextMatches", () => {
  it("finds case-insensitive substring matches", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>ccdxx CC</p><pre>cc-code</pre>";

    const matches = findTextMatches(root, "cc");

    expect(matches.map((range) => range.toString())).toEqual(["cc", "CC", "cc"]);
  });

  it("returns no matches for an empty query", () => {
    const root = document.createElement("div");
    root.textContent = "content";
    expect(findTextMatches(root, "  ")).toEqual([]);
  });
});

describe("DocumentContentSearch", () => {
  it("does not force-scroll again when the highlighted content mutates", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>ccdxx</p>";
    document.body.append(root);
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const highlights = new Map<string, unknown>();
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { highlights },
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: class Highlight {},
    });

    render(<DocumentContentSearch rootRef={{ current: root }} />);
    fireEvent.change(screen.getByLabelText("doc.searchContent"), {
      target: { value: "cc" },
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    await act(async () => {
      root.append(document.createTextNode("unrelated editor mutation"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("does not re-highlight a stale query when a mutation fires after the query was cleared", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>ccdxx</p>";
    document.body.append(root);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const highlights = new Map<string, unknown>();
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { highlights },
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: class Highlight {},
    });

    render(<DocumentContentSearch rootRef={{ current: root }} />);
    const input = screen.getByLabelText("doc.searchContent");

    fireEvent.change(input, { target: { value: "cc" } });
    await waitFor(() => expect(highlights.has("tanwords-document-search")).toBe(true));

    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => expect(highlights.has("tanwords-document-search")).toBe(false));

    // A document mutation (e.g. an async image or mermaid render finishing)
    // that lands after the query was already cleared must not resurrect the
    // highlight for the query that was active when it was scheduled.
    await act(async () => {
      root.append(document.createTextNode("late unrelated mutation"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(highlights.has("tanwords-document-search")).toBe(false);
    expect(highlights.has("tanwords-document-search-active")).toBe(false);
    root.remove();
  });

  it("atomically clears the custom-highlight registry when the query is cleared", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>use user future</p>";
    document.body.append(root);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const highlights = new Map<string, unknown>();
    const clear = vi.spyOn(highlights, "clear");
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { highlights },
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: class Highlight {},
    });

    render(<DocumentContentSearch rootRef={{ current: root }} />);
    const input = screen.getByLabelText("doc.searchContent");
    fireEvent.change(input, { target: { value: "use" } });
    await waitFor(() => expect(highlights.size).toBeGreaterThan(0));
    clear.mockClear();

    fireEvent.change(input, { target: { value: "" } });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(highlights.size).toBe(0);
    root.remove();
  });
});
