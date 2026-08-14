import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardStats: vi.fn(),
  settings: {
    uiLanguage: "en",
    dashboardBanner: "",
    dashboardBannerPosition: { x: 50, y: 50 },
    nickname: "",
    isLoaded: true,
    appBackgroundImage: "",
    appBackgroundVisible: true,
  },
}));

vi.mock("@/hooks/useDB", () => ({
  useDB: () => ({ getDashboardStats: mocks.getDashboardStats }),
}));

vi.mock("@/hooks/useT", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (selector: (state: typeof mocks.settings) => unknown) => selector(mocks.settings),
}));

vi.mock("@/store/navStore", () => ({
  useNavStore: (selector: (state: Record<string, () => void>) => unknown) => selector({
    navigate: vi.fn(),
    openVocabularyPatterns: vi.fn(),
  }),
}));

vi.mock("./DashboardWidgetGrid", async () => {
  const React = await import("react");
  return {
    DashboardWidgetGrid: ({ onInitialDataSettled }: { onInitialDataSettled?: () => void }) => {
      React.useEffect(() => onInitialDataSettled?.(), [onInitialDataSettled]);
      return <div data-testid="dashboard-grid" />;
    },
  };
});
vi.mock("./QuickActionsBar", () => ({ QuickActionsBar: () => null }));
vi.mock("./UploadsCard", () => ({ UploadsCard: () => null }));

import type { DashboardStats } from "@/hooks/useDB";
import { DashboardPage } from "./DashboardPage";

const stats: DashboardStats = {
  word_count: 17,
  pattern_count: 8,
  chat_count: 4,
  doc_count: 3,
  recent_words: [],
  recent_docs: [],
};

beforeEach(() => {
  delete document.documentElement.dataset.tanwordsShellReady;
  mocks.getDashboardStats.mockReset();
  mocks.settings.isLoaded = true;
  mocks.settings.appBackgroundImage = "";
  mocks.settings.appBackgroundVisible = true;
});

afterEach(() => cleanup());

describe("DashboardPage startup readiness", () => {
  it("makes stat surfaces transparent when the app background image is visible", async () => {
    mocks.settings.appBackgroundImage = "data:image/jpeg;base64,wallpaper";
    mocks.getDashboardStats.mockResolvedValue(stats);

    render(<DashboardPage />);

    const wordsTile = await screen.findByRole("button", { name: /dash\.stat\.words/ });
    expect(wordsTile).toHaveClass("bg-transparent");
    expect(wordsTile).not.toHaveClass("bg-card");
  });

  it("keeps Splash waiting until the first real database result has committed", async () => {
    let resolveStats!: (value: DashboardStats | null) => void;
    mocks.getDashboardStats.mockReturnValue(new Promise((resolve) => {
      resolveStats = resolve;
    }));
    const onReady = vi.fn();
    window.addEventListener("tanwords:shell-ready", onReady);

    render(<DashboardPage />);

    expect(document.documentElement.dataset.tanwordsShellReady).toBeUndefined();
    expect(onReady).not.toHaveBeenCalled();

    await act(async () => resolveStats(stats));

    await waitFor(() => expect(document.documentElement.dataset.tanwordsShellReady).toBe("1"));
    expect(onReady).toHaveBeenCalledOnce();
    expect(screen.getByText("17")).toBeInTheDocument();
    window.removeEventListener("tanwords:shell-ready", onReady);
  });

  it("also waits for persisted settings and still settles if the query fails", async () => {
    mocks.settings.isLoaded = false;
    mocks.getDashboardStats.mockRejectedValue(new Error("database unavailable"));
    const { rerender } = render(<DashboardPage />);

    await waitFor(() => expect(screen.getAllByText("0")).toHaveLength(4));
    expect(document.documentElement.dataset.tanwordsShellReady).toBeUndefined();

    mocks.settings.isLoaded = true;
    rerender(<DashboardPage />);

    await waitFor(() => expect(document.documentElement.dataset.tanwordsShellReady).toBe("1"));
  });
});
