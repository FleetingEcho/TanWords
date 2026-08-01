/** Length of the longest suffix of `lowerBuf` that's also a prefix of `tag` —
 * i.e. how much trailing text could still turn into `tag` once more chunks
 * arrive, and so must be held back rather than emitted yet. */
function trailingPartialTagLength(lowerBuf: string, tag: string): number {
  const max = Math.min(lowerBuf.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (lowerBuf.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

/** Some OpenAI-compatible reasoning models (DeepSeek-R1, QwQ, local Ollama
 * models, etc.) inline their chain-of-thought as a literal `<think>...</think>`
 * span at the start of `content` instead of exposing it through a separate
 * field the way the official APIs do — left alone, that shows up verbatim in
 * translations/chat/notes. Strips those spans from a chunk stream, buffering
 * across chunk boundaries since the tag can be split mid-token. */
export class ThinkTagFilter {
  private buf = "";
  private inThink = false;

  /** Feed the next raw chunk; returns the sanitized text safe to emit now. */
  push(chunk: string): string {
    this.buf += chunk;
    let out = "";
    while (true) {
      const lower = this.buf.toLowerCase();
      if (!this.inThink) {
        const start = lower.indexOf("<think>");
        if (start === -1) {
          const keep = trailingPartialTagLength(lower, "<think>");
          out += this.buf.slice(0, this.buf.length - keep);
          this.buf = this.buf.slice(this.buf.length - keep);
          break;
        }
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + "<think>".length);
        this.inThink = true;
      } else {
        const end = lower.indexOf("</think>");
        if (end === -1) {
          const keep = trailingPartialTagLength(lower, "</think>");
          this.buf = this.buf.slice(this.buf.length - keep);
          break;
        }
        this.buf = this.buf.slice(end + "</think>".length);
        this.inThink = false;
      }
    }
    return out;
  }

  /** Call once the source stream ends: releases any buffered plain content.
   * An unterminated `<think>` span (model cut off mid-thought) is dropped
   * rather than leaked. */
  flush(): string {
    return this.inThink ? "" : this.buf;
  }
}
