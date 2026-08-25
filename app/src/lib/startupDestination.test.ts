import { describe, expect, it } from "vitest";
import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from "@/platform/types";
import { resolveStartupDestination } from "./startupDestination";

describe("resolveStartupDestination", () => {
  it("keeps an available page", () => {
    expect(resolveStartupDestination(
      { kind: "page", page: "terminal" }, new Set(), DESKTOP_CAPABILITIES, true,
    )).toEqual({ kind: "page", page: "terminal" });
  });

  it("falls back when a page is unavailable on this host", () => {
    expect(resolveStartupDestination(
      { kind: "page", page: "terminal" }, new Set(), WEB_CAPABILITIES, false,
    )).toEqual({ kind: "page", page: "dashboard" });
  });

  it("keeps an existing enabled workspace", () => {
    expect(resolveStartupDestination(
      { kind: "workspace", workspaceId: "ws-1" }, new Set(["ws-1"]), DESKTOP_CAPABILITIES, true,
    )).toEqual({ kind: "workspace", workspaceId: "ws-1" });
  });

  it("falls back for a missing or disabled workspace", () => {
    expect(resolveStartupDestination(
      { kind: "workspace", workspaceId: "missing" }, new Set(["ws-1"]), DESKTOP_CAPABILITIES, true,
    )).toEqual({ kind: "page", page: "dashboard" });
    expect(resolveStartupDestination(
      { kind: "workspace", workspaceId: "ws-1" }, new Set(["ws-1"]), DESKTOP_CAPABILITIES, false,
    )).toEqual({ kind: "page", page: "dashboard" });
  });
});
