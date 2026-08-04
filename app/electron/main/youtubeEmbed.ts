import type { Session } from "electron";

/** YouTube requires desktop WebViews to identify the embedding application
 * through an HTTP Referer. The normal page origin is app://app, which Chromium
 * cannot send as an HTTP referrer, so use the installed application ID in the
 * HTTPS form recommended for native app identifiers. */
export const YOUTUBE_EMBED_REFERRER = "https://com.tanner.tanwords/";

export function withYouTubeEmbedIdentity(headers: Record<string, string>): Record<string, string> {
  const existing = Object.keys(headers).find((name) => name.toLowerCase() === "referer");
  if (existing && headers[existing]) return headers;
  return { ...headers, Referer: YOUTUBE_EMBED_REFERRER };
}

/** Adds identity only to the initial iframe document request. Requests made
 * inside YouTube's own frame already carry a youtube.com referrer and should
 * not be rewritten. */
export function registerYouTubeEmbedIdentity(session: Session) {
  session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "https://www.youtube.com/embed/*",
        "https://www.youtube-nocookie.com/embed/*",
      ],
    },
    (details, callback) => {
      callback({ requestHeaders: withYouTubeEmbedIdentity(details.requestHeaders) });
    },
  );
}
