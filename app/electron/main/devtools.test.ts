import { describe, expect, it } from "vitest";
import { isDevToolsShortcut, type KeyInput } from "./devtools";

const press = (over: Partial<KeyInput>): KeyInput => ({
  type: "keyDown",
  key: "i",
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...over,
});

describe("isDevToolsShortcut", () => {
  it("accepts the macOS binding", () => {
    expect(isDevToolsShortcut(press({ key: "i", meta: true, alt: true }))).toBe(true);
    expect(isDevToolsShortcut(press({ key: "j", meta: true, alt: true }))).toBe(true);
  });

  it("accepts the Windows/Linux binding", () => {
    expect(isDevToolsShortcut(press({ key: "i", control: true, shift: true }))).toBe(true);
    expect(isDevToolsShortcut(press({ key: "j", control: true, shift: true }))).toBe(true);
  });

  it("accepts F12 regardless of case", () => {
    expect(isDevToolsShortcut(press({ key: "F12" }))).toBe(true);
    expect(isDevToolsShortcut(press({ key: "f12" }))).toBe(true);
  });

  it("ignores key-up so the inspector toggles once per press", () => {
    expect(isDevToolsShortcut(press({ key: "F12", type: "keyUp" }))).toBe(false);
    expect(isDevToolsShortcut(press({ key: "i", meta: true, alt: true, type: "keyUp" }))).toBe(false);
  });

  it("leaves ordinary typing and neighbouring shortcuts alone", () => {
    // Bare letters — this handler sees every keystroke in every input.
    expect(isDevToolsShortcut(press({ key: "i" }))).toBe(false);
    expect(isDevToolsShortcut(press({ key: "j" }))).toBe(false);
    // Cmd+I is italic, not the inspector.
    expect(isDevToolsShortcut(press({ key: "i", meta: true }))).toBe(false);
    // Ctrl+I without shift is a tab character in some editors.
    expect(isDevToolsShortcut(press({ key: "i", control: true }))).toBe(false);
    // Neither half of the pair on its own.
    expect(isDevToolsShortcut(press({ key: "i", alt: true }))).toBe(false);
    expect(isDevToolsShortcut(press({ key: "i", shift: true }))).toBe(false);
  });
});
