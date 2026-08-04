import { describe, expect, it, vi } from "vitest";
import {
  registerYouTubeEmbedIdentity,
  withYouTubeEmbedIdentity,
  YOUTUBE_EMBED_REFERRER,
} from "./youtubeEmbed";

describe("YouTube embed identity", () => {
  it("adds the native application identity when app:// cannot supply a referrer", () => {
    expect(withYouTubeEmbedIdentity({ Accept: "text/html" })).toEqual({
      Accept: "text/html",
      Referer: YOUTUBE_EMBED_REFERRER,
    });
  });

  it("does not replace an existing web referrer", () => {
    const headers = { referer: "https://example.com/", Accept: "text/html" };
    expect(withYouTubeEmbedIdentity(headers)).toBe(headers);
  });

  it("registers only for YouTube embed document URLs", () => {
    const onBeforeSendHeaders = vi.fn();
    registerYouTubeEmbedIdentity({ webRequest: { onBeforeSendHeaders } } as any);

    expect(onBeforeSendHeaders.mock.calls[0][0]).toEqual({
      urls: [
        "https://www.youtube.com/embed/*",
        "https://www.youtube-nocookie.com/embed/*",
      ],
    });
  });
});
