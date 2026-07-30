import React from "react";
import { createPortal } from "react-dom";
import { findSelectionOverlayHost } from "./selectionToolbarPosition";

/** Marks the AI replies in the chat transcript as selectable targets — your
 *  own messages, and the Chinese glosses in cards, have nothing to offer. */
export const AI_MESSAGE_ATTR = "data-ai-message";

/** Longer than this and it isn't a word or a sentence any more — probably a
 *  drag-select of half the page, where none of these actions make sense. */
export const MAX_SELECTION = 320;
/** How much surrounding text goes to the model as context. */
export const CONTEXT_CHARS = 700;

export interface Anchor {
  text: string;
  /** Viewport rect of the selection, for placing the toolbar and the panel.
   *  Recomputed from `range` while scrolling so both track the text. */
  top: number;
  bottom: number;
  left: number;
  /** Text around the selection, for disambiguating what it means *here*. */
  context: string;
  /** Attribution recorded on anything saved from this selection. */
  source: string;
  /** True when the selection sits in an AI chat reply, where "ask" should go
   *  to the composer instead of a card. */
  inChat: boolean;
  /** Live range over the selected text. Its rect follows the document as it
   *  scrolls, which is what lets the card stay pinned to the sentence it's
   *  explaining instead of being dismissed the moment the page moves. */
  range: Range;
}

/** "translate" is a straight rendering into Chinese; "explain" is the tutor
 *  answer (meaning in context, structure, what's worth stealing); "deep" is
 *  the full vocabulary breakdown — the same content the word modal shows,
 *  rendered in this card instead so a lookup while reading doesn't take over
 *  the screen and lose your place. */
export type AskMode = "explain" | "translate" | "deep";

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
