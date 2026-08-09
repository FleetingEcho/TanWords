import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

// Every widget-side DB hook resolves empty here — the failure mode under test
// is the parent's stats query, not the per-card fetches.
vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({
    listPatterns: async () => [],
    getRssFeeds: async () => [],
    getRssEntries: async () => [],
    getRssUnreadCounts: async () => [],
  }),
}));

import { DashboardWidgetGrid } from "./DashboardWidgetGrid";

describe("DashboardWidgetGrid", () => {
  it("keeps skeletons while stats are still loading", () => {
    const { container } = render(<DashboardWidgetGrid stats={null} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("drops all skeletons once the stats query has failed (e.g. no DB connected yet)", async () => {
    const { container } = render(<DashboardWidgetGrid stats={null} statsFailed />);
    await waitFor(() => {
      expect(container.querySelectorAll(".animate-pulse").length).toBe(0);
    });
  });

  it("reports readiness after every independently queried widget settles", async () => {
    const onInitialDataSettled = vi.fn();
    render(<DashboardWidgetGrid stats={null} onInitialDataSettled={onInitialDataSettled} />);

    await waitFor(() => expect(onInitialDataSettled).toHaveBeenCalledOnce());
  });
});
