const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = withNativeWind(getDefaultConfig(__dirname), {
  input: "./global.css",
});

// --- expo-sqlite web setup ---
// https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/#web-setup
// 1) Metro must resolve .wasm files as assets so the wa-sqlite binary that
//    backs expo-sqlite on web can be bundled/served.
if (!config.resolver.assetExts.includes("wasm")) {
  config.resolver.assetExts.push("wasm");
}
// 2) wa-sqlite's worker needs SharedArrayBuffer, which browsers only expose
//    on cross-origin-isolated pages — send COOP/COEP on every dev response.
//    Compose with Expo's own middleware enhancer instead of replacing it.
const previousEnhanceMiddleware = config.server.enhanceMiddleware;

// --- web dev CORS proxy (reader mode + RSS fetch arbitrary 3rd-party URLs,
//     which browsers refuse cross-origin; native fetch is unaffected) ---
// GET /__cors-proxy?u=<encoded http(s) url> → server-side fetch, streamed
// back same-origin with ACAO:* and X-Final-Url (post-redirect target).
// Dev-only by construction: metro middleware doesn't exist in exported web builds.
const PROXY_PREFIX = "/__cors-proxy";
const PROXY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// undici already decompressed the body → don't forward negotiated
// encoding/length or hop-by-hop headers.
const PROXY_SKIP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "te",
  "trailer",
  "upgrade",
  "host",
]);

async function handleCorsProxy(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const target = new URL(req.url ?? "", "http://localhost").searchParams.get("u");
    if (req.method !== "GET" || !target || !/^https?:\/\//i.test(target)) {
      res.statusCode = 400;
      res.end("usage: GET /__cors-proxy?u=<http(s) url>");
      return;
    }
    const upstream = await fetch(target, {
      redirect: "follow",
      headers: {
        "User-Agent": PROXY_UA,
        Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(30_000),
    });
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (!PROXY_SKIP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.setHeader("X-Final-Url", upstream.url || target);
    if (!upstream.body) {
      res.end();
      return;
    }
    require("stream").Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.statusCode = 502;
    res.end(`cors-proxy: ${e instanceof Error ? e.message : String(e)}`);
  }
}

config.server.enhanceMiddleware = (middleware, server) => {
  const inner = previousEnhanceMiddleware
    ? previousEnhanceMiddleware(middleware, server)
    : middleware;
  return (req, res, next) => {
    if (req.url?.startsWith(PROXY_PREFIX)) {
      handleCorsProxy(req, res); // async; owns the response
      return;
    }
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    inner(req, res, next);
  };
};

module.exports = config;
