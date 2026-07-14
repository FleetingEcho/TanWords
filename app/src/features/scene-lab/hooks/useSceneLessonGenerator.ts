import { useCallback, useState } from "react";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { useDB } from "@/hooks/useDB";
import { KITCHEN_MANIFEST } from "../kitchenManifest";
import { buildKitchenPrompt, SCENE_PROMPT_VERSION } from "../generation/prompts";
import { parseSceneLesson } from "../generation/validateLesson";

export function useSceneLessonGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const db = useDB();
  const targetLevels = useSettingsStore((state) => state.targetLevels.join("/"));

  const generateKitchen = useCallback(async (): Promise<number> => {
    const provider = findBestProvider();
    if (!provider) throw new Error("请先在设置中配置 AI 提供商");
    setIsGenerating(true);
    try {
      const known = (await db.getWords()).map((item) => item.word);
      const { system, user } = buildKitchenPrompt(targetLevels, known);
      const chunks: string[] = [];
      for await (const chunk of provider.generate(system, user)) chunks.push(chunk);
      const lesson = parseSceneLesson(chunks.join(""));
      const generationKey = `kitchen:v${KITCHEN_MANIFEST.version}:p${SCENE_PROMPT_VERSION}:${targetLevels}:${Date.now()}`;
      return await db.saveSceneLesson({ manifest: KITCHEN_MANIFEST, targetLevels, promptVersion: SCENE_PROMPT_VERSION, generationKey, lesson });
    } finally { setIsGenerating(false); }
  }, [db, targetLevels]);
  return { generateKitchen, isGenerating };
}
