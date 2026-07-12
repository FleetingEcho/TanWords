export type { Lang, Dict } from "./types";
import type { Lang, Dict } from "./types";

// zh/en are each composed from per-feature dictionaries under ./zh and ./en
// (nav, reading, vocabulary, settings, ...) — see those directories to add
// or edit a key; this file just merges them into the flat lookup useT() reads.
import { zh } from "./zh";
import { en } from "./en";

export const translations: Record<Lang, Dict> = { zh, en };
