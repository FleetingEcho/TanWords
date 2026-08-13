/** The cosmetic-injection preload, as source. Runs in the isolated world on
 *  every top frame; its sync IPC is answered from main's prewarmed cache, so
 *  it never blocks on the sidecar.
 *
 *  Exported so its two hard-won behaviours can be tested rather than only
 *  shipped: that it survives a document-start with no `documentElement` yet,
 *  and that a refused scriptlet does not take the stylesheet down with it. */
export const COSMETIC_PRELOAD_SOURCE = `(function(){
  if (window.self !== window.top) return;
  var url = '';
  try { url = location.href; } catch(e) {}
  if (!url) return;
  var c = null;
  try { c = require('electron').ipcRenderer.sendSync('adblock:cosmetics', url); } catch(e) {}
  if (!c || (!c.stylesheet && !c.script)) return;
  // A preload runs at document-start, which on a fresh document is BEFORE the
  // parser has produced <html>: document.documentElement and document.head are
  // both null, and appending to null throws — which used to abort the whole
  // preload, taking the stylesheet down with the script. Inject as soon as a
  // root exists, and if there is none yet, watch for it.
  function inject() {
    var root = document.documentElement || document.head;
    if (!root) return false;
    if (c.stylesheet) {
      try {
        var s = document.createElement('style');
        s.textContent = c.stylesheet + '{display:none!important}';
        root.appendChild(s);
      } catch (e) {}
    }
    // Kept separate from the stylesheet on purpose: scriptlets are the part
    // that can still be refused (a page may enforce Trusted Types before the
    // panel's header pass has relaxed it), and a refusal must not cost us the
    // cosmetic hiding that already succeeded.
    if (c.script) {
      try {
        var sc = document.createElement('script');
        sc.textContent = c.script;
        root.appendChild(sc);
        sc.remove();
      } catch (e) {}
    }
    return true;
  }
  if (!inject()) {
    try {
      var obs = new MutationObserver(function(_m, o) { if (inject()) o.disconnect(); });
      obs.observe(document, { childList: true });
    } catch (e) {}
  }
})();`;

/** Drops only the two Trusted Types directives from one CSP header value,
 *  leaving every other directive (`script-src`, `frame-ancestors`, …) intact.
 *
 *  Why this is needed at all: uBO's ad rules for YouTube are *scriptlets*
 *  (`json-prune` on the player response, `set-constant`), not network rules —
 *  video ads come from the same googlevideo host as the video itself, so
 *  nothing can block them by URL. Scriptlets have to execute in the page's
 *  main world, and the only document-start hook Electron gives an isolated
 *  preload is building a `<script>` element. Under
 *  `require-trusted-types-for 'script'` — which YouTube sends — assigning a
 *  string to `script.textContent` throws, so the scriptlets never ran and
 *  video ads played while banner ads were correctly hidden.
 *
 *  The tradeoff, stated plainly: Trusted Types is the visited site's own
 *  hardening against DOM XSS, and this turns it off for main-frame documents
 *  while blocking is enabled. A real browser extension does not pay this —
 *  it injects into an isolated MAIN world that bypasses Trusted Types
 *  natively — but no Electron API offers that at document-start. It is
 *  narrowed as far as it can be: enforcing CSP headers only (report-only is
 *  left alone since it blocks nothing), main-frame documents only, on the
 *  panel's own partition only, and removed again the moment blocking is
 *  turned off. `script-src` is deliberately left standing — the probe that
 *  found this confirmed YouTube's `script-src` does not refuse the injected
 *  script once Trusted Types is out of the way. */
export function stripTrustedTypes(csp: string): string {
  if (!/trusted-types/i.test(csp)) return csp;
  return csp
    .split(";")
    .filter((directive) => !/^\s*(require-trusted-types-for|trusted-types)\s*(\s|$)/i.test(directive))
    .join(";");
}

/** Origin of a source URL, for the decision cache key: party-ness and
 *  `$domain=` depend on the document's host, not its full path, so keying on
 *  the origin keeps one entry per site rather than one per page. */
export function sourceOriginOf(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).origin;
  } catch {
    return "";
  }
}

export function toIntBounds(b: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  };
}

/** JS that injects cosmetic resources directly into the page's MAIN world
 *  (webContents.executeJavaScript runs there). Used as the late fallback when
 *  the preload missed its cache hit — CSS hiding still works once it lands,
 *  scriptlets are best-effort. `stylesheet` is a selector list; the caller
 *  wraps it in `{display:none!important}` per the shared convention. */
export function buildCosmeticInjectionJs(c: { stylesheet: string; script: string }): string {
  const parts: string[] = [];
  if (c.stylesheet) {
    parts.push(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(c.stylesheet + "{display:none!important}")};(document.head||document.documentElement).appendChild(s)})()`);
  }
  if (c.script) {
    parts.push(c.script);
  }
  return parts.join("\n");
}
