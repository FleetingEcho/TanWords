export type SceneMode = "explore" | "semantic" | "task" | "test";
export type LearningStatus = "new" | "learning" | "familiar" | "mastered";
export type ExampleKind = "collocation" | "action" | "sentence";
export type RelationType = "located_near" | "used_for" | "followed_by" | "belongs_to";

export interface KitchenObjectDef {
  key: string;
  labelEn: string;
  labelZh: string;
  category: "appliance" | "cookware" | "utensil" | "fixture" | "storage" | "ingredient";
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  allowedActions: string[];
}

export interface SceneDefinition {
  key: string;
  nameEn: string;
  nameZh: string;
  version: number;
  objects: KitchenObjectDef[];
  actions: string[];
}

export interface SceneExample {
  kind: ExampleKind;
  content_en: string;
  content_zh: string;
}

export interface SceneVocabularyItem {
  id?: number;
  object_key: string;
  word_id?: number | null;
  word: string;
  zh: string;
  ipa: string;
  level: string;
  category: string;
  importance: number;
  learning_status: LearningStatus;
  examples: SceneExample[];
}

export interface SceneRelation {
  source_key: string;
  relation: RelationType;
  target_key: string;
}

export type SceneTaskStep =
  | { type: "find"; object_key: string; instruction_en: string; instruction_zh: string }
  | { type: "select"; action: string; instruction_en: string; instruction_zh: string };

export interface SceneTask {
  id?: number;
  title_en: string;
  title_zh: string;
  steps: SceneTaskStep[];
}

export interface GeneratedSceneLesson {
  vocabulary: SceneVocabularyItem[];
  relations: SceneRelation[];
  tasks: SceneTask[];
}

export interface SceneLesson extends GeneratedSceneLesson {
  id: number;
  scene_id: number;
  target_levels: string;
  prompt_version: number;
  generated_at: string;
}

export interface SceneSummary {
  scene_id: number;
  scene_key: string;
  name: string;
  lesson_id: number | null;
  learned: number;
  total: number;
  last_visited_at: string | null;
}

export interface SceneAttemptInput {
  sessionId: number;
  sceneVocabularyId: number;
  mode: SceneMode;
  correct: boolean;
  responseMs: number;
  hintsUsed: number;
}

export interface SceneWordAddResult {
  added: number;
  linked: number;
  skipped: number;
}
