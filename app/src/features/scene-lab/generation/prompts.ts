import { KITCHEN_MANIFEST } from "../kitchenManifest";

export const SCENE_PROMPT_VERSION = 1;

export function buildKitchenPrompt(targetLevels: string, excludeWords: string[]) {
  const objects = KITCHEN_MANIFEST.objects.map((item) => ({ key: item.key, label: item.labelEn, category: item.category, actions: item.allowedActions }));
  const system = "You design practical English vocabulary lessons. Return only one valid JSON object matching the requested schema. Never invent object keys or actions.";
  const user = `Create a Kitchen scene lesson for a CEFR ${targetLevels} learner.
Allowed objects: ${JSON.stringify(objects)}
Allowed actions: ${JSON.stringify(KITCHEN_MANIFEST.actions)}
Avoid these known words where practical: ${excludeWords.slice(0, 200).join(", ")}.
Generate 25-35 useful items, including concrete nouns, precise verbs, collocations, and action phrases. Prefer genuinely useful B2-C2 language over elementary labels.
Return: {"vocabulary":[{"object_key":"sink","word":"rinse","zh":"冲洗","ipa":"/rɪns/","level":"B2","category":"action","importance":4,"examples":[{"kind":"collocation|action|sentence","content_en":"...","content_zh":"..."}]}],"relations":[{"source_key":"sink|rinse","relation":"located_near|used_for|followed_by|belongs_to","target_key":"faucet|wash"}],"tasks":[{"title_en":"...","title_zh":"...","steps":[{"type":"find","object_key":"sink","instruction_en":"...","instruction_zh":"..."},{"type":"select","action":"rinse","instruction_en":"...","instruction_zh":"..."}]}]}.
Include 3-5 coherent tasks. Output JSON only.`;
  return { system, user };
}
