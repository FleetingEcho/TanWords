import type { WritingResponse } from "./types";

const ALLOWED_LEVELS = new Set(["B1", "B2", "C1", "C2"]);
const ELEMENTARY_WORDS = new Set(["hi", "hello", "hey", "bye", "yes", "no", "good", "bad", "nice", "thanks", "thank you", "please", "sorry"]);

export function filterSuggestedVocabulary(items: WritingResponse["vocabulary"]): WritingResponse["vocabulary"] {
  return items.flatMap((item) => {
    const word = item?.word?.trim();
    const level = item?.level?.toUpperCase();
    if (!word || !item?.meaning || !level || !ALLOWED_LEVELS.has(level) || ELEMENTARY_WORDS.has(word.toLowerCase())) return [];
    return [{ ...item, word, level: level as "B1" | "B2" | "C1" | "C2" }];
  });
}
