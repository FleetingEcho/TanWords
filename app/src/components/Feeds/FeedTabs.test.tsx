import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RssFeed } from "@/hooks/useDB.types";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));

import { FeedTabs } from "./FeedTabs";

const feeds: RssFeed[] = [
  {
    id: 1,
    title: "Syntax",
    url: "https://feed.syntax.fm",
    site_link: "https://syntax.fm",
    description: "",
    last_fetched_at: null,
    created_at: "2026-08-08T00:00:00Z",
    is_podcast: true,
    category: "podcast",
    category_override: null,
    is_pinned: true,
    pin_order: 0,
    is_paused: false,
  },
];

function renderTabs(onSelect = vi.fn(), testFeeds = feeds, onPausedChange = vi.fn(async () => {})) {
  const result = render(
    <FeedTabs
      feeds={testFeeds}
      unreadByFeed={new Map([[1, 3]])}
      failedFeeds={new Set()}
      selected="all"
      syncing={false}
      onSelect={onSelect}
      onDelete={vi.fn()}
      onPreferences={vi.fn(async () => {})}
      onPausedChange={onPausedChange}
      onAdd={vi.fn()}
      onRefresh={vi.fn()}
      viewMode="list"
      onSetViewMode={vi.fn()}
      showTitleTranslations={false}
      onToggleTitleTranslations={vi.fn()}
      recentlyRead={[]}
      onOpenRecent={vi.fn()}
      onClearRecentlyRead={vi.fn()}
      onRemoveRecent={vi.fn()}
      bookmarks={[]}
      onOpenBookmark={vi.fn()}
      onRemoveBookmark={vi.fn()}
      bookmarkPendingUrls={new Set()}
    />,
  );
  return { ...result, onSelect, onPausedChange };
}

describe("FeedTabs compact source selector", () => {
  it("replaces compact horizontal feed tabs with a drill-down selector", () => {
    const { container, onSelect } = renderTabs();

    const compactTrigger = screen.getByRole("button", { name: "feeds.chooseSource" });
    expect(compactTrigger.closest(".lg\\:hidden")).not.toBeNull();

    const desktopTabs = container.querySelector(".rss-tabs-scroll");
    expect(desktopTabs).toHaveClass("hidden", "lg:flex");

    fireEvent.click(compactTrigger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Syntax/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("offers stop and resume controls for each feed", () => {
    const active = renderTabs();
    fireEvent.click(screen.getByRole("button", { name: /feeds.more/ }));
    fireEvent.click(screen.getByRole("button", { name: "feeds.pauseUpdates" }));
    expect(active.onPausedChange).toHaveBeenCalledWith(1, true);
    active.unmount();

    const pausedFeed = [{ ...feeds[0], is_paused: true }];
    const paused = renderTabs(vi.fn(), pausedFeed);
    fireEvent.click(screen.getByRole("button", { name: /feeds.more/ }));
    fireEvent.click(screen.getByRole("button", { name: "feeds.resumeUpdates" }));
    expect(paused.onPausedChange).toHaveBeenCalledWith(1, false);
  });

  it("shows progress immediately while a pause change is being saved", async () => {
    let finishSave!: () => void;
    const onPausedChange = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    renderTabs(vi.fn(), feeds, onPausedChange);

    fireEvent.click(screen.getByRole("button", { name: /feeds.more/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "feeds.pauseUpdates" }));

    expect(within(dialog).getByRole("status", { name: "feeds.updatingPauseState" })).toBeInTheDocument();
    await act(async () => { finishSave(); });
  });
});
