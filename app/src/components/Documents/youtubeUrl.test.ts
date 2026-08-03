import { describe, it, expect } from "vitest";
import { isYouTubeUrl, youTubeId } from "./youtubeUrl";
import { liftYouTube, lowerYouTube } from "./mediaTransforms";

describe("YouTube URL parsing", () => {
  it("reads the id out of every link shape YouTube hands out", () => {
    const cases: Array<[string, string]> = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      // Real links arrive with timestamps, playlists and tracking junk.
      ["https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
      ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ];
    for (const [url, id] of cases) expect(youTubeId(url)).toBe(id);
  });

  it("rejects anything that is not a YouTube link", () => {
    for (const url of ["https://vimeo.com/12345", "https://example.com/watch?v=short", "", "not a url"]) {
      expect(isYouTubeUrl(url)).toBe(false);
    }
  });
});

describe("YouTube round trip through markdown", () => {
  const url = "https://youtu.be/dQw4w9WgXcQ";

  it("becomes a plain link on the way out and a player on the way back", () => {
    const lowered = lowerYouTube([{ type: "youtube", props: { url } }]);
    expect(lowered[0].type).toBe("paragraph");
    expect(lowered[0].content[0].href).toBe(url);

    expect(liftYouTube(lowered)).toEqual([{ type: "youtube", props: { url } }]);
  });

  it("leaves a link that sits inside a sentence alone", () => {
    const paragraph = {
      type: "paragraph",
      content: [
        { type: "text", text: "see ", styles: {} },
        { type: "link", href: url, content: [{ type: "text", text: url, styles: {} }] },
      ],
    };
    expect(liftYouTube([paragraph])).toEqual([paragraph]);
  });

  it("leaves non-YouTube links alone", () => {
    const paragraph = {
      type: "paragraph",
      content: [{ type: "link", href: "https://example.com", content: [{ type: "text", text: "x", styles: {} }] }],
    };
    expect(liftYouTube([paragraph])).toEqual([paragraph]);
  });
});
