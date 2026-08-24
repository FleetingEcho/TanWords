import { describe, expect, it } from "vitest";
import {
  activeRetained,
  effectiveMainPage,
  pageOwnsStartupReadiness,
  isMainBlockActive,
  type PageHostEnv,
} from "@/pages/pageHostResolve";
import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from "@/platform/types";
import type { NavPage } from "@/store/navStore";

const DESKTOP: PageHostEnv = { isDesktop: true, capabilities: DESKTOP_CAPABILITIES };
const WEB: PageHostEnv = { isDesktop: false, capabilities: WEB_CAPABILITIES };

const ALL_PAGES: NavPage[] = [
  "dashboard", "calendar", "feeds", "reading", "music", "vocabulary",
  "documents", "chat", "browser", "terminal", "tools", "dsh", "settings",
];

describe("activeRetained", () => {
  it("tools is always retained on both hosts", () => {
    expect(activeRetained("tools", DESKTOP)).toBe("tools");
    expect(activeRetained("tools", WEB)).toBe("tools");
  });

  it("terminal/dsh are retained only when the host can run them", () => {
    expect(activeRetained("terminal", DESKTOP)).toBe("terminal");
    expect(activeRetained("terminal", WEB)).toBeNull();
    expect(activeRetained("dsh", DESKTOP)).toBe("dsh");
    expect(activeRetained("dsh", WEB)).toBeNull();
  });

  it("ordinary pages are never retained", () => {
    for (const p of ALL_PAGES) {
      if (p === "tools" || p === "terminal" || p === "dsh") continue;
      expect(activeRetained(p, DESKTOP)).toBeNull();
      expect(activeRetained(p, WEB)).toBeNull();
    }
  });
});

describe("effectiveMainPage", () => {
  it("falls back to dashboard for capability-missing routes on the host that lacks them", () => {
    // Desktop runs everything; web falls back for the four gated pages.
    expect(effectiveMainPage("music", WEB)).toBe("dashboard");
    expect(effectiveMainPage("browser", WEB)).toBe("dashboard");
    expect(effectiveMainPage("terminal", WEB)).toBe("dashboard");
    expect(effectiveMainPage("dsh", WEB)).toBe("dashboard");
  });

  it("keeps gated pages on desktop", () => {
    expect(effectiveMainPage("music", DESKTOP)).toBe("music");
    expect(effectiveMainPage("browser", DESKTOP)).toBe("browser");
  });

  it("passes ordinary pages through unchanged on both hosts", () => {
    for (const p of ALL_PAGES) {
      if (["music", "browser", "terminal", "dsh"].includes(p)) continue;
      expect(effectiveMainPage(p, DESKTOP)).toBe(p);
      expect(effectiveMainPage(p, WEB)).toBe(p);
    }
  });
});

describe("pageOwnsStartupReadiness", () => {
  it("dashboard owns readiness on both hosts", () => {
    expect(pageOwnsStartupReadiness("dashboard", DESKTOP)).toBe(true);
    expect(pageOwnsStartupReadiness("dashboard", WEB)).toBe(true);
  });

  it("web fallback routes own readiness because they render Dashboard", () => {
    expect(pageOwnsStartupReadiness("music", WEB)).toBe(true);
    expect(pageOwnsStartupReadiness("browser", WEB)).toBe(true);
    expect(pageOwnsStartupReadiness("terminal", WEB)).toBe(true);
    expect(pageOwnsStartupReadiness("dsh", WEB)).toBe(true);
  });

  it("desktop gated routes do not own readiness (the host fires it for them)", () => {
    expect(pageOwnsStartupReadiness("music", DESKTOP)).toBe(false);
    expect(pageOwnsStartupReadiness("browser", DESKTOP)).toBe(false);
    expect(pageOwnsStartupReadiness("terminal", DESKTOP)).toBe(false);
    expect(pageOwnsStartupReadiness("dsh", DESKTOP)).toBe(false);
  });

  it("ordinary pages do not own readiness on either host", () => {
    for (const p of ["calendar", "feeds", "reading", "vocabulary", "documents", "chat", "settings", "tools"] as NavPage[]) {
      expect(pageOwnsStartupReadiness(p, DESKTOP)).toBe(false);
      expect(pageOwnsStartupReadiness(p, WEB)).toBe(false);
    }
  });
});

describe("isMainBlockActive", () => {
  it("is false exactly for retained routes the host can run", () => {
    // Desktop: tools, terminal, dsh are retained.
    expect(isMainBlockActive("tools", DESKTOP)).toBe(false);
    expect(isMainBlockActive("terminal", DESKTOP)).toBe(false);
    expect(isMainBlockActive("dsh", DESKTOP)).toBe(false);
    // Web: only tools is retained; terminal/dsh fall through to the main block.
    expect(isMainBlockActive("tools", WEB)).toBe(false);
    expect(isMainBlockActive("terminal", WEB)).toBe(true);
    expect(isMainBlockActive("dsh", WEB)).toBe(true);
  });

  it("is true for every ordinary page", () => {
    for (const p of ALL_PAGES) {
      if (p === "tools" || (p === "terminal") || p === "dsh") continue;
      expect(isMainBlockActive(p, DESKTOP)).toBe(true);
    }
  });
});
