/**
 * Web fetch goes through the dev server's /__cors-proxy (metro.config.js) —
 * browsers can't fetch arbitrary third-party article/feed URLs cross-origin.
 * Native is returned unchanged (no CORS outside browsers).
 *
 * The proxy strips nothing from the caller's perspective except CORS: it
 * forwards status/content-type and adds `X-Final-Url` (post-redirect),
 * since a proxied `resp.url` would just echo the same-origin proxy URL.
 */
import { Platform } from "react-native";

export function viaCorsProxy(url: string): string {
  return Platform.OS === "web" ? `/__cors-proxy?u=${encodeURIComponent(url)}` : url;
}

/** Post-redirect URL of a fetch that may have gone through the proxy. */
export function fetchedFinalUrl(resp: Response, originalUrl: string): string {
  return resp.headers.get("x-final-url") || resp.url || originalUrl;
}
