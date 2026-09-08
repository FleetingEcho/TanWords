import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Captures what the shell hands the dock, so the tests can assert on the
 *  fan's contents without rendering the fan itself. */
let dockItems: { id: string; label: string }[] = [];

vi.mock("@/components/Layout/MobileNavDock", () => ({
  MobileNavDock: ({ items }: { items: { id: string; label: string }[] }) => {
    dockItems = items;
    return <div data-testid="mobile-dock" />;
  },
}));
vi.mock("@/components/Layout/CommandBar", () => ({
  CommandBar: () => <header data-testid="command-bar">command bar</header>,
}));
vi.mock("@/components/Vocabulary/hooks/useMediaQuery", () => ({
  useIsNarrow: () => true,
  useMediaQuery: () => false,
}));

import { MainLayout } from "./Sidebar";
import { useSettingsStore } from "@/store/settingsStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { useLayoutStore } from "@/store/layoutStore";

describe("MainLayout mobile dock items", () => {
  beforeEach(() => {
    dockItems = [];
    useSettingsStore.setState({
      uiLanguage: "en",
      layoutMode: "flexible",
      // A minimal visible set, like a fresh profile: everything else is
      // hidden from the desktop sidebar and reachable only via Command-K.
      visibleSidebarTabs: ["dashboard", "feeds"],
      sidebarTabOrder: [
        "dashboard", "calendar", "feeds", "reading", "documents", "vocabulary",
        "chat", "music", "browser", "terminal", "dsh", "tools",
      ],
    });
    usePodcastPlayerStore.setState({ status: "idle", track: null });
    useLayoutStore.setState({ sidebarCollapsed: false });
  });

  it("offers every page the host can render, not just the visible sidebar tabs", () => {
    render(
      <MainLayout activeNav="dashboard" onNavigate={() => {}}>
        <div>content</div>
      </MainLayout>,
    );

    const ids = dockItems.map((i) => i.id);
    // Hidden from the desktop sidebar by the visible set above — but the dock
    // is the phone's only navigator, so they must still be on the fan.
    for (const page of ["vocabulary", "documents", "chat", "reading", "tools"]) {
      expect(ids).toContain(page);
    }
    expect(ids).toContain("settings");
    // The test host resolves to web capabilities: terminal/dsh/browser/music
    // cannot render here, so they stay off the fan.
    for (const page of ["terminal", "dsh", "browser", "music"]) {
      expect(ids).not.toContain(page);
    }
  });

  it("follows the user's sidebar order for the pages it shows", () => {
    render(
      <MainLayout activeNav="dashboard" onNavigate={() => {}}>
        <div>content</div>
      </MainLayout>,
    );

    const ids = dockItems.filter((i) => i.id !== "settings").map((i) => i.id);
    expect(ids.indexOf("documents")).toBeLessThan(ids.indexOf("vocabulary"));
    expect(ids.indexOf("dashboard")).toBeLessThan(ids.indexOf("feeds"));
    // Settings stays pinned at the end of the fan.
    expect(dockItems[dockItems.length - 1]?.id).toBe("settings");
  });
});
