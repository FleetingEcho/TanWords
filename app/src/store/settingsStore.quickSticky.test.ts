/** The sticky quick-open button in the top bar (2026-09 user request):
 *  the id must exist in the canonical defaults, the one-time backfill must
 *  seed it into existing installs' saved lists (desktop only, without
 *  re-enabling anything the user hid), and it must be idempotent. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  return { invoke: vi.fn() };
});

vi.mock("@/ipc/backend", () => ({ invoke }));

import {
  DEFAULT_TOPBAR_ITEMS,
  DEFAULT_VISIBLE_TOPBAR_ITEMS,
  type TopBarItemId,
} from "./settings/types";
import { includeTopBarItems } from "./settings/loadFromDB";

describe("quickSticky top-bar item", () => {
  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("exists in the canonical order and fresh-install visibility defaults", () => {
    expect(DEFAULT_TOPBAR_ITEMS).toContain("quickSticky");
    expect(DEFAULT_VISIBLE_TOPBAR_ITEMS).toContain("quickSticky");
    // First in the icon group: the whole point is being easy to hit.
    expect(DEFAULT_TOPBAR_ITEMS[0]).toBe("quickSticky");
  });

  it("backfills into a saved list that predates it", () => {
    const saved: TopBarItemId[] = ["search", "theme", "updates"];
    const seeded = includeTopBarItems(saved, ["quickSticky"]);
    expect(seeded).toContain("quickSticky");
    // Canonical order is preserved around the seeded id.
    expect(seeded.indexOf("quickSticky")).toBeLessThan(seeded.indexOf("search"));
  });

  it("never re-enables controls the user deliberately hid", () => {
    const saved: TopBarItemId[] = ["search", "theme"]; // e.g. browser hidden
    const seeded = includeTopBarItems(saved, ["quickSticky"]);
    expect(seeded).not.toContain("browser");
    expect(seeded).not.toContain("voice");
  });

  it("is idempotent", () => {
    const once = includeTopBarItems(["search"], ["quickSticky"]);
    const twice = includeTopBarItems(once, ["quickSticky"]);
    expect(twice.filter((id) => id === "quickSticky")).toHaveLength(1);
  });
});
