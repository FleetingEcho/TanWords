import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_WORD_FILTERS,
  WORD_FILTER_STORAGE_KEY,
  compactCount,
  loadWordFilters,
  persistWordFilters,
} from "./wordFilterDefs";

// The persisted working set is user-facing state across upgrades: a stale or
// hand-edited snapshot must degrade to "no constraint", never wedge the list.
describe("word filter persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a valid working set", () => {
    const f = {
      levels: ["C1", "B2"] as ("C1" | "B2")[],
      statuses: ["learning", "mastered"] as ("learning" | "mastered")[],
      starred: true,
      enrichFilter: "raw" as const,
      dueOnly: true,
      source: "chat",
      tags: ["科学技术", "economics"],
      scenes: ["dining.cafe", "travel.airport"],
    };
    persistWordFilters(f);
    expect(loadWordFilters()).toEqual(f);
  });

  it("returns defaults when nothing was ever stored", () => {
    expect(loadWordFilters()).toEqual(DEFAULT_WORD_FILTERS);
  });

  it("survives corrupt JSON", () => {
    localStorage.setItem(WORD_FILTER_STORAGE_KEY, "{not json");
    expect(loadWordFilters()).toEqual(DEFAULT_WORD_FILTERS);
  });

  it("survives a non-object payload", () => {
    localStorage.setItem(WORD_FILTER_STORAGE_KEY, JSON.stringify("learning"));
    expect(loadWordFilters()).toEqual(DEFAULT_WORD_FILTERS);
  });

  it("drops unknown enum values and dedupes", () => {
    localStorage.setItem(
      WORD_FILTER_STORAGE_KEY,
      JSON.stringify({
        levels: ["C2", "C9", "C2", 42],
        statuses: ["learning", "bogus"],
        starred: 1, // truthy non-boolean — not accepted, must be === true
        enrichFilter: "halfway",
        source: "telegram", // unknown source → "no constraint", never an empty list
        dueOnly: "yes",
      })
    );
    expect(loadWordFilters()).toEqual({
      ...DEFAULT_WORD_FILTERS,
      levels: ["C2"],
      statuses: ["learning"],
    });
  });

  it("sanitizes free-text tags (quotes stripped the same way the SQL write path does)", () => {
    localStorage.setItem(
      WORD_FILTER_STORAGE_KEY,
      JSON.stringify({ tags: ['politics', 'bad"tag', "  spaced  ", "", "politics", 7] })
    );
    expect(loadWordFilters().tags).toEqual(["politics", "badtag", "spaced"]);
  });

  it("keeps valid scene keys, drops junk and duplicates, and caps the payload", () => {
    localStorage.setItem(
      WORD_FILTER_STORAGE_KEY,
      JSON.stringify({
        scenes: [
          "dining.cafe", "dining.cafe", "Dining.Cafe", "not a key!", "UPPER",
          "", 42, "x".repeat(200), "meta.repair",
        ],
      })
    );
    // "Dining.Cafe" lowercases nowhere (sanitizer keeps case), "not a key!"
    // and "UPPER" fail the dotted-key charset, "" and 42 drop as usual, and
    // the 200-char key truncates to the 100-char cap rather than dropping.
    expect(loadWordFilters().scenes).toEqual([
      "dining.cafe",
      "x".repeat(100),
      "meta.repair",
    ]);
  });

  it("caps oversized scene-key payloads", () => {
    localStorage.setItem(
      WORD_FILTER_STORAGE_KEY,
      JSON.stringify({
        scenes: Array.from({ length: 60 }, (_, i) => `dining.scene-${i}`),
      })
    );
    expect(loadWordFilters().scenes).toHaveLength(30);
  });

  it("a v1 snapshot (no scenes field) loads with an empty scene set", () => {
    // Hand-write a v1-shaped payload under the v2 key: everything except scenes.
    localStorage.setItem(
      WORD_FILTER_STORAGE_KEY,
      JSON.stringify({ levels: ["C1"], tags: ["old"] })
    );
    expect(loadWordFilters()).toEqual({ ...DEFAULT_WORD_FILTERS, levels: ["C1"], tags: ["old"] });
  });

  it("caps oversized tag payloads", () => {
    localStorage.setItem(
      WORD_FILTER_STORAGE_KEY,
      JSON.stringify({ tags: Array.from({ length: 80 }, (_, i) => `tag-${i}`) })
    );
    expect(loadWordFilters().tags).toHaveLength(50);
  });
});

describe("compactCount", () => {
  it("keeps small numbers exact and folds thousands", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1000)).toBe("1k");
    expect(compactCount(1345)).toBe("1.3k");
    expect(compactCount(10000)).toBe("10k");
  });
});
