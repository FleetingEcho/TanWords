import { describe, expect, it } from "vitest";
import { commonBase, targetFolder } from "./importPaths";

describe("commonBase", () => {
  it("is the deepest shared directory", () => {
    expect(commonBase(["notes/rust/a.md", "notes/rust/async/b.md"])).toBe("notes/rust");
    expect(commonBase(["notes/rust/a.md", "misc/c.md"])).toBe("");
    expect(commonBase(["a.md", "b.md"])).toBe("");
  });

  it("uses a single file's own directory", () => {
    expect(commonBase(["notes/rust/a.md"])).toBe("notes/rust");
  });

  it("has no base for an empty selection", () => {
    expect(commonBase([])).toBe("");
  });
});

describe("targetFolder", () => {
  it("keeps the structure below the base", () => {
    expect(targetFolder("notes/rust/a.md", "notes/rust", "Study")).toBe("Study");
    expect(targetFolder("notes/rust/async/b.md", "notes/rust", "Study")).toBe("Study/async");
  });

  it("recreates a whole folder when the base is its parent", () => {
    // "Import this folder" passes the folder's parent, so `rust` survives.
    expect(targetFolder("notes/rust/a.md", "notes", "Study")).toBe("Study/rust");
    expect(targetFolder("notes/rust/async/b.md", "notes", "Study")).toBe("Study/rust/async");
  });

  it("imports to the library root when no folder was picked", () => {
    expect(targetFolder("notes/rust/a.md", "notes", "")).toBe("rust");
    expect(targetFolder("a.md", "", "")).toBe("");
  });

  it("does not strip a base that merely shares a name prefix", () => {
    // "notes2" starts with "notes" as a *string*; it is not under that folder.
    expect(targetFolder("notes2/a.md", "notes", "Study")).toBe("Study/notes2");
  });

  it("handles a file sitting directly at the vault root", () => {
    expect(targetFolder("a.md", "", "Study")).toBe("Study");
  });
});
