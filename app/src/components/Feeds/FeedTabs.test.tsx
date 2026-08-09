import { fireEvent, render, screen, within } from "@testing-library/react";
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
  },
];

function renderTabs(onSelect = vi.fn()) {
  const result = render(
    <FeedTabs
      feeds={feeds}
      unreadByFeed={new Map([[1, 3]])}
      failedFeeds={new Set()}
      selected="all"
      syncing={false}
      onSelect={onSelect}
      onDelete={vi.fn()}
      onPreferences={vi.fn(async () => {})}
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
  return { ...result, onSelect };
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
});
