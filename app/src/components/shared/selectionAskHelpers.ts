import React from "react";
import { createPortal } from "react-dom";
import { findSelectionOverlayHost } from "./selectionToolbarPosition";

/** Marks the AI replies in the chat transcript as selectable targets — your
 *  own messages, and the Chinese glosses in cards, have nothing to offer. */
export const AI_MESSAGE_ATTR = "data-ai-message";

/** Longer than this and the selection is a drag across the whole page rather
 *  than something you're asking about. A couple of paragraphs is well within
 *  what translate, ask and copy can handle, so the ceiling is generous; the
 *  narrower limit below is the one that guards the sentence library. */
export const MAX_SELECTION = 1200;

/** Past this, a selection is no longer a sentence worth keeping as a pattern —
 *  the library is for structures you'd reuse, not for stretches of article. */
export const MAX_PATTERN = 320;
/** How much surrounding text goes to the model as context. */
export const CONTEXT_CHARS = 700;

/** What an "ask" needs to know about the thing being asked about. Split out
 *  of `Anchor` because the Browser page asks about a selection made inside a
 *  native child webview, where there is no DOM range, no viewport rect, and
 *  no in-app element to attribute — just text pulled across from the page. */
export interface AskTarget {
  text: string;
  /** Text around the selection, for disambiguating what it means *here*. */
  context: string;
  /** Attribution recorded on anything saved from this selection. */
  source: string;
  /** Viewport rect of the selection. Only the floating layout needs it. */
  top?: number;
  bottom?: number;
  left?: number;
}

export interface Anchor extends AskTarget {
  /** Required here, unlike on `AskTarget`: an in-app selection always has a
   *  viewport rect, and the floating toolbar/card are placed from it.
   *  Recomputed from `range` while scrolling so both track the text. */
  top: number;
  bottom: number;
  left: number;
  /** True when the selection sits in an AI chat reply, where "ask" should go
   *  to the composer instead of a card. */
  inChat: boolean;
  /** Live range over the selected text. Its rect follows the document as it
   *  scrolls, which is what lets the card stay pinned to the sentence it's
   *  explaining instead of being dismissed the moment the page moves. */
  range: Range;
  /** True when the selection was made by our own touch gestures rather than
   *  the browser. Nothing is in `window.getSelection()` in that case, so the
   *  highlight has to be painted by us. */
  touch?: boolean;
}

/** "translate" is a straight rendering into Chinese; "explain" is the tutor
 *  answer (meaning in context, structure, what's worth stealing); "deep" is
 *  the full vocabulary breakdown — the same content the word modal shows,
 *  rendered in this card instead so a lookup while reading doesn't take over
 *  the screen and lose your place. */
export type AskMode = "explain" | "translate" | "deep";

/** Everything the toolbar needs about a selected range, or null if that range
 *  isn't something to offer actions on. Shared by the mouse path and the touch
 *  path so both surfaces agree on what counts as a lookup. */
export function anchorFromRange(range: Range, touch = false): Anchor | null {
  const text = range.toString().trim();
  // Two letters in a row is the cheapest test for "this is English" — it keeps
  // the toolbar off Chinese UI copy, numbers and punctuation.
  if (!text || text.length > MAX_SELECTION || !/[A-Za-z]{2}/.test(text)) return null;
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el || el.closest(IGNORED)) return null;
  const rect = range.getBoundingClientRect();
  const block = el.closest("p, li, blockquote, h1, h2, h3, td") ?? el;
  return {
    text,
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left + rect.width / 2,
    context: (block.textContent ?? "").slice(0, CONTEXT_CHARS),
    range: range.cloneRange(),
    source: sourceFor(el),
    inChat: !!el.closest(`[${AI_MESSAGE_ATTR}]`),
    touch,
  };
}

export function renderSelectionOverlay(anchor: Anchor, content: React.ReactNode) {
  const host = findSelectionOverlayHost(anchor.range);
  return host ? createPortal(content, host) : content;
}

/** Recomputes an anchor's viewport position from its range. Returns null once
 *  the text has scrolled out of view. */
export function reposition(anchor: Anchor): Anchor | null {
  const r = anchor.range.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // range detached or collapsed
  return { ...anchor, top: r.top, bottom: r.bottom, left: r.left + r.width / 2 };
}

export function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** A selection carries whatever punctuation the drag caught — strip it before
 *  the text is used as a vocabulary entry or a lookup key. */
export function cleanWord(text: string) {
  return text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
}

export function isWordish(text: string) {
  return wordCount(text) <= 3 && !/[.!?]$/.test(text);
}

/** Selecting inside these is never a lookup — it's editing, or picking text
 *  out of the answer panel itself. */
export const IGNORED = 'input, textarea, [contenteditable=""], [contenteditable="true"], [data-no-selection]';

/** Where the selection came from, recorded on anything saved from it. */
export function sourceFor(el: Element | null | undefined): string {
  if (el?.closest(`[${AI_MESSAGE_ATTR}]`)) return "chat";
  if (el?.closest("[data-reader-selectable]")) return "reader";
  return "app";
}
