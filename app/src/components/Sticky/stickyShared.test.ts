import { afterEach, describe, expect, it } from "vitest";
import {
  STICKY_PANEL_OPACITY_STORAGE_KEY,
  STICKY_SORT_STORAGE_KEY,
  loadStickyPanelOpacity,
  loadStickySortMode,
  saveStickyPanelOpacity,
  saveStickySortMode,
  sortStickyItems,
  type StickyListItem,
} from "./stickyShared";

function note(
  id: number,
  title: string,
  created_at: string,
  updated_at: string,
): StickyListItem {
  return {
    id,
    title,
    preview: title,
    word_count: 1,
    color: "yellow",
    corner: "rounded",
    opacity: 100,
    always_on_top: false,
    x: null,
    y: null,
    w: 320,
    h: 280,
    collapsed: false,
    is_open: false,
    created_at,
    updated_at,
  };
}

const NOTES = [
  note(1, "Bravo", "2026-01-01 00:00:00", "2026-03-01 00:00:00"),
  note(2, "alpha", "2026-02-01 00:00:00", "2026-01-01 00:00:00"),
  note(3, "Charlie", "2026-03-01 00:00:00", "2026-02-01 00:00:00"),
];

describe("sticky note sorting", () => {
  afterEach(() => localStorage.removeItem(STICKY_SORT_STORAGE_KEY));

  it("supports creation, update, and both title orders without mutating results", () => {
    expect(sortStickyItems(NOTES, "created").map((item) => item.id)).toEqual([3, 2, 1]);
    expect(sortStickyItems(NOTES, "updated").map((item) => item.id)).toEqual([1, 3, 2]);
    expect(sortStickyItems(NOTES, "title-asc").map((item) => item.id)).toEqual([2, 1, 3]);
    expect(sortStickyItems(NOTES, "title-desc").map((item) => item.id)).toEqual([3, 1, 2]);
    expect(NOTES.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("defaults invalid preferences to creation time and persists valid choices", () => {
    localStorage.setItem(STICKY_SORT_STORAGE_KEY, "not-a-sort");
    expect(loadStickySortMode()).toBe("created");
    saveStickySortMode("title-desc");
    expect(loadStickySortMode()).toBe("title-desc");
  });

  it("loads, persists, and clamps the manager panel opacity", () => {
    localStorage.removeItem(STICKY_PANEL_OPACITY_STORAGE_KEY);
    expect(loadStickyPanelOpacity()).toBe(95);
    saveStickyPanelOpacity(65);
    expect(loadStickyPanelOpacity()).toBe(65);
    saveStickyPanelOpacity(5);
    expect(loadStickyPanelOpacity()).toBe(20);
    localStorage.removeItem(STICKY_PANEL_OPACITY_STORAGE_KEY);
  });
});
