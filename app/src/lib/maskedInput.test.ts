import { afterEach, describe, expect, it, vi } from "vitest";

/** The masking decision is made once at module load, so each case needs a
 *  fresh module against its own `CSS.supports`. */
async function load(supportsMasking: boolean) {
  vi.resetModules();
  vi.stubGlobal("CSS", { supports: () => supportsMasking });
  return (await import("./maskedInput")).maskedPasswordProps("app-lock");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("maskedPasswordProps", () => {
  it("hides the field from password managers by not being a password field", async () => {
    const props = await load(true);
    expect(props.type).toBe("text");
    expect(props.style).toMatchObject({ WebkitTextSecurity: "disc" });
  });

  it("keeps the secret covered where CSS masking is unsupported", async () => {
    const props = await load(false);
    expect(props.type).toBe("password");
    expect(props.style).toBeUndefined();
  });

  it("carries the opt-out hints the third-party managers read", async () => {
    const props = await load(true) as Record<string, unknown>;
    expect(props["data-1p-ignore"]).toBe("");
    expect(props["data-lpignore"]).toBe("true");
    expect(props["data-bwignore"]).toBe("");
    expect(props.autoComplete).toBe("off");
  });
});
