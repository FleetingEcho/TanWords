/** TanWords injects a little remote-provided HTML into the app window —
 *  Hacker News comment text, today. That window carries the privileged
 *  preload bridge (sidecar bearer token, file:write), so an injected
 *  <script> or <img onerror> here is a data and local-file compromise, not
 *  a cosmetic annoyance. This clamps such fragments to a minimal inline
 *  allowlist: unknown tags are unwrapped (their text stays), attributes are
 *  dropped except a vetted <a href>, and links are forced to open in the
 *  system browser via the main process's window-open handler. */

const ALLOWED_TAGS = new Set([
  "A", "P", "BR", "I", "EM", "B", "STRONG", "PRE", "CODE", "BLOCKQUOTE",
]);

function isSafeHref(href: string): boolean {
  try {
    const protocol = new URL(href, "https://invalid.invalid").protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

export function sanitizeRemoteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const sanitizeChildren = (parent: Element): void => {
    for (const node of Array.from(parent.childNodes)) {
      // Text passes through untouched — it is already markup-inert.
      if (node.nodeType === Node.TEXT_NODE) continue;
      // Comments, processing instructions — gone.
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        continue;
      }
      const el = node as Element;
      // Active-content tags: drop them WITH their content — a script's text
      // is code, not prose, and unwrapping would leave it visibly behind.
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "IFRAME"
          || el.tagName === "OBJECT" || el.tagName === "EMBED") {
        el.remove();
        continue;
      }
      if (!ALLOWED_TAGS.has(el.tagName)) {
        // Unwrap: sanitize what's inside, then dissolve the tag itself so the
        // text content isn't lost with it (HN wraps lines in plain <div>s,
        // and a hostile fragment would hide behind arbitrary nesting).
        sanitizeChildren(el);
        el.replaceWith(...Array.from(el.childNodes));
        continue;
      }
      sanitizeChildren(el);
      if (el.tagName === "A") {
        // Read href BEFORE scrubbing attributes...
        const href = el.getAttribute("href");
        for (const attr of Array.from(el.attributes)) {
          el.removeAttribute(attr.name);
        }
        if (!href || !isSafeHref(href)) {
          // An anchor that goes nowhere safe is just text.
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        // ...then write back exactly the vetted href and nothing else.
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      } else {
        for (const attr of Array.from(el.attributes)) {
          el.removeAttribute(attr.name);
        }
      }
    }
  };

  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}
