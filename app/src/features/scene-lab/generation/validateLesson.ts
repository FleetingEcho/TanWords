import { jsonrepair } from "jsonrepair";
import { KITCHEN_ACTIONS, KITCHEN_OBJECT_KEYS } from "../kitchenManifest";
import type { GeneratedSceneLesson, RelationType, SceneTaskStep, SceneVocabularyItem } from "../types";

const RELATIONS = new Set<RelationType>(["located_near", "used_for", "followed_by", "belongs_to"]);

export function parseSceneLesson(raw: string): GeneratedSceneLesson {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("AI 没有返回有效的场景课程");
  return validateSceneLesson(JSON.parse(jsonrepair(raw.slice(start))));
}

export function validateSceneLesson(value: any): GeneratedSceneLesson {
  const seen = new Set<string>();
  const vocabulary: SceneVocabularyItem[] = [];
  for (const item of Array.isArray(value?.vocabulary) ? value.vocabulary : []) {
    const word = String(item?.word ?? "").trim().toLowerCase();
    const objectKey = String(item?.object_key ?? "");
    if (!word || seen.has(word) || !KITCHEN_OBJECT_KEYS.has(objectKey)) continue;
    seen.add(word);
    const examples = (Array.isArray(item.examples) ? item.examples : [])
      .filter((ex: any) => ["collocation", "action", "sentence"].includes(ex?.kind) && String(ex?.content_en ?? "").trim())
      .map((ex: any) => ({ kind: ex.kind, content_en: String(ex.content_en).trim(), content_zh: String(ex.content_zh ?? "").trim() }));
    vocabulary.push({
      object_key: objectKey, word, zh: String(item.zh ?? "").trim(), ipa: String(item.ipa ?? "").trim(),
      level: String(item.level ?? "").trim(), category: String(item.category ?? "").trim(),
      importance: Math.min(5, Math.max(1, Number(item.importance) || 3)), learning_status: "new", examples,
    });
  }
  const allowedTargets = new Set([...KITCHEN_OBJECT_KEYS, ...KITCHEN_ACTIONS, ...vocabulary.map((item) => item.word)]);
  const relations = (Array.isArray(value?.relations) ? value.relations : []).filter((rel: any) =>
    RELATIONS.has(rel?.relation) && allowedTargets.has(rel?.source_key) && allowedTargets.has(rel?.target_key)
  ).map((rel: any) => ({ source_key: String(rel.source_key), relation: rel.relation as RelationType, target_key: String(rel.target_key) }));
  const tasks = (Array.isArray(value?.tasks) ? value.tasks : []).map((task: any) => {
    const steps: SceneTaskStep[] = (Array.isArray(task?.steps) ? task.steps : []).filter((step: any) =>
      (step?.type === "find" && KITCHEN_OBJECT_KEYS.has(step.object_key)) ||
      (step?.type === "select" && KITCHEN_ACTIONS.has(step.action))
    ).map((step: any) => step.type === "find"
      ? { type: "find", object_key: String(step.object_key), instruction_en: String(step.instruction_en ?? ""), instruction_zh: String(step.instruction_zh ?? "") }
      : { type: "select", action: String(step.action), instruction_en: String(step.instruction_en ?? ""), instruction_zh: String(step.instruction_zh ?? "") });
    return { title_en: String(task?.title_en ?? "Kitchen task"), title_zh: String(task?.title_zh ?? "厨房任务"), steps };
  }).filter((task: any) => task.steps.length > 0);
  if (vocabulary.length === 0) throw new Error("AI 返回的词汇无法匹配 Kitchen 物体");
  return { vocabulary, relations, tasks };
}
