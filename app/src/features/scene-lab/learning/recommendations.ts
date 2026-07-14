import type { SceneVocabularyItem } from "../types";

export function recommendedWords(items: SceneVocabularyItem[], weakIds: Set<number>): SceneVocabularyItem[] {
  return items.filter((item) => item.id && !item.word_id && item.importance >= 3 &&
    (item.learning_status === "new" || item.learning_status === "learning") && weakIds.has(item.id));
}
