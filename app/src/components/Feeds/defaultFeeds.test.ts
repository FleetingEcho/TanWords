import { describe, expect, it } from "vitest";
import { DEFAULT_FEEDS, FEED_CATEGORIES, INITIAL_FEEDS } from "./defaultFeeds";

describe("default RSS feeds", () => {
  it("automatically subscribes to the three default podcasts", () => {
    expect(INITIAL_FEEDS.map((feed) => feed.title)).toEqual(["Syntax", "Practical AI", "TED Talks Daily"]);
  });

  it("offers popular technical publications in a separate news group", () => {
    expect(FEED_CATEGORIES[0]).toBe("news");
    expect(DEFAULT_FEEDS.filter((feed) => feed.category === "news").map((feed) => feed.title))
      .toEqual([
        "TechCrunch",
        "The Verge",
        "WIRED",
        "Ars Technica",
        "MIT Technology Review",
        "IEEE Spectrum",
      ]);
  });
});
