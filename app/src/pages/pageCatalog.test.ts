import { describe, expect, it } from "vitest";
import {
  PAGE_CATALOG,
  getPageDefinition,
  assertCatalogComplete,
  type PageDefinition,
} from "@/pages/pageCatalog";
import type { NavPage } from "@/store/navStore";
import { DEFAULT_SIDEBAR_TABS } from "@/store/settings/types";
import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from "@/platform/types";

/** The full runtime list of NavPage values. `NavPage` is a string union, so it
 *  has no value-side representation; derive the list from the settings default
 *  tab order (every non-settings page) plus `settings`. This is the same set
 *  the sidebar and command bar navigate among, so the completeness test stays
 *  in sync with what the app actually offers. */
const ALL_NAV_PAGES: NavPage[] = [...DEFAULT_SIDEBAR_TABS, "settings"];

describe("pageCatalog", () => {
  it("has exactly one entry for every NavPage", () => {
    // No duplicates.
    const ids = PAGE_CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Complete and no extras that aren't NavPages.
    expect(new Set(ids)).toEqual(new Set(ALL_NAV_PAGES));
    assertCatalogComplete(ALL_NAV_PAGES);
  });

  it("getPageDefinition resolves every NavPage", () => {
    for (const id of ALL_NAV_PAGES) {
      const def = getPageDefinition(id);
      expect(def, `expected a catalog entry for "${id}"`).toBeDefined();
    }
  });

  it("every entry has valid, self-consistent metadata", () => {
    for (const def of PAGE_CATALOG) {
      expect(typeof def.id).toBe("string");
      expect(def.titleKey).toBe(`nav.${def.id}`);
      // A React component is either a function or a class object.
      expect(def.icon).toBeDefined();
      expect(["function", "object"]).toContain(typeof def.icon);
      expect(typeof def.load).toBe("function");
      expect(["react", "retained", "native"]).toContain(def.host);
      expect(["multiple", "singleton"]).toContain(def.multiplicity);
      expect(def.minWidth).toBeGreaterThan(0);
      expect(def.minHeight).toBeGreaterThan(0);
    }
  });

  it("capability, when set, names a real HostCapabilities key", () => {
    const knownCaps = Object.keys(DESKTOP_CAPABILITIES) as (keyof typeof DESKTOP_CAPABILITIES)[];
    for (const def of PAGE_CATALOG) {
      if (!def.capability) continue;
      expect(knownCaps).toContain(def.capability);
    }
  });

  it("assertCatalogComplete throws when a NavPage is missing", () => {
    // Cast a bogus id through `any` to exercise the guard without claiming it
    // is a real NavPage.
    expect(() => assertCatalogComplete([..."__missing__" as any as NavPage[]])).toThrow();
  });

  it("the host-gated pages match the documented capability surface", () => {
    // The sidebar filters on these; pin them so adding a capability doesn't
    // silently change which pages appear.
    const capsById = new Map(PAGE_CATALOG.filter((d) => d.capability).map((d) => [d.id, d.capability]));
    expect(capsById.get("browser")).toBe("browser");
    expect(capsById.get("music")).toBe("music");
    expect(capsById.get("terminal")).toBe("terminal");
    expect(capsById.get("dsh")).toBe("dsh");
  });

  it("host capability flags are consistent between desktop and web for the gated pages", () => {
    // The four gated pages must be desktop-only, matching the platform types
    // the sidebar and PageHost rely on. If this ever changes, the catalog's
    // capability entries and the fallback logic in PageHost must change too.
    const gated: PageDefinition[] = PAGE_CATALOG.filter((d) => d.capability);
    for (const def of gated) {
      const cap = def.capability!;
      expect(DESKTOP_CAPABILITIES[cap], `desktop should expose ${def.id}`).toBe(true);
      expect(WEB_CAPABILITIES[cap], `web should hide ${def.id}`).toBe(false);
    }
  });

  it("retained pages are tools, terminal, and dsh", () => {
    const retained = PAGE_CATALOG.filter((d) => d.host === "retained").map((d) => d.id);
    expect(retained.sort()).toEqual(["dsh", "terminal", "tools"]);
  });
});
