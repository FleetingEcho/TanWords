import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/Layout/CommandBar", () => ({
  CommandBar: () => <header data-testid="command-bar">command bar</header>,
}));
vi.mock("@/components/Layout/MobileNavDock", () => ({
  MobileNavDock: () => <div data-testid="mobile-dock" />,
}));
vi.mock("@/components/Vocabulary/hooks/useMediaQuery", () => ({
  useIsNarrow: () => false,
  useMediaQuery: () => false,
}));

import { MainLayout } from "./Sidebar";
import { useSettingsStore } from "@/store/settingsStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";

describe("MainLayout immersive mode", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      uiLanguage: "en",
      layoutMode: "flexible",
      appBackgroundImage: "",
      visibleSidebarTabs: ["terminal", "tools"],
    });
    usePodcastPlayerStore.setState({ status: "idle", track: null });
  });

  it("hides both navigation surfaces until terminal minimize", () => {
    const view = render(
      <MainLayout activeNav="terminal" onNavigate={() => {}} immersive>
        <div>live terminal</div>
      </MainLayout>,
    );

    expect(screen.queryByTestId("command-bar")).not.toBeInTheDocument();
    expect(document.querySelector("aside")).toHaveClass("hidden");
    expect(screen.getByText("live terminal")).toBeVisible();

    view.rerender(
      <MainLayout activeNav="terminal" onNavigate={() => {}} immersive={false}>
        <div>live terminal</div>
      </MainLayout>,
    );

    expect(screen.getByTestId("command-bar")).toBeInTheDocument();
    expect(document.querySelector("aside")).toHaveClass("flex");
  });
});
