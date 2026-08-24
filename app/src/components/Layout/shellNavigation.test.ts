import { describe, expect, it } from "vitest";
import { resolveShellActiveNav } from "./shellNavigation";

describe("resolveShellActiveNav", () => {
  it("clears the built-in active marker while a workspace owns the screen", () => {
    expect(resolveShellActiveNav("terminal", true, false)).toBeNull();
  });

  it("still marks Settings while its modal is open over a workspace", () => {
    expect(resolveShellActiveNav("terminal", true, true)).toBe("settings");
  });
});
