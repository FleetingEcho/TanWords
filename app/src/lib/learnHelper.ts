import type { HNStory } from "@/hooks/useHackerNews";

/**
 * Construct a synthetic HNStory-like object for the Learn drawer.
 * Used when opening an article from RSS or a custom URL where there
 * is no real HN story.
 */
export function makeSyntheticStory(title: string, url: string): HNStory {
  return {
    id: -Date.now(),
    title,
    url,
    score: 0,
    by: "",
    time: Math.floor(Date.now() / 1000),
    descendants: 0,
  };
}
