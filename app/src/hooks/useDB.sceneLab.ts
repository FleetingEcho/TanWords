import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError, reportWriteError } from "./useDB.errors";
import type {
  GeneratedSceneLesson, SceneAttemptInput, SceneLesson, SceneMode,
  SceneSummary, SceneWordAddResult,
} from "@/features/scene-lab/types";
import type { SceneDefinition } from "@/features/scene-lab/types";

export interface SaveSceneLessonPayload {
  manifest: SceneDefinition;
  targetLevels: string;
  promptVersion: number;
  generationKey: string;
  lesson: GeneratedSceneLesson;
}

export function useDBSceneLab() {
  const listScenes = useCallback(async (): Promise<SceneSummary[]> => {
    try { return await invoke<SceneSummary[]>("db_list_scenes"); }
    catch (error) { logError("listScenes", error); return []; }
  }, []);

  const getSceneLesson = useCallback(async (lessonId: number): Promise<SceneLesson | null> => {
    try { return await invoke<SceneLesson | null>("db_get_scene_lesson", { lessonId }); }
    catch (error) { logError("getSceneLesson", error); return null; }
  }, []);

  const saveSceneLesson = useCallback(async (payload: SaveSceneLessonPayload): Promise<number> => {
    const { manifest, targetLevels, promptVersion, generationKey, lesson } = payload;
    try {
      return await invoke<number>("db_save_scene_lesson", { input: {
        scene_key: manifest.key,
        scene_name: manifest.nameEn,
        scene_type: "prebuilt",
        asset_path: "procedural:kitchen-v1",
        generation_version: manifest.version,
        target_levels: targetLevels,
        prompt_version: promptVersion,
        generation_key: generationKey,
        objects: manifest.objects.map((item) => ({
          object_key: item.key, label: item.labelEn, position: item.position,
          metadata: { category: item.category, allowedActions: item.allowedActions },
        })),
        vocabulary: lesson.vocabulary,
        relations: lesson.relations,
        tasks: lesson.tasks,
      }});
    } catch (error) {
      reportWriteError("saveSceneLesson", error, "保存场景课程失败");
      return 0;
    }
  }, []);

  const startSceneSession = useCallback(async (lessonId: number, mode: SceneMode): Promise<number> => {
    try { return await invoke<number>("db_start_scene_session", { lessonId, mode }); }
    catch (error) { reportWriteError("startSceneSession", error, "开始学习记录失败"); return 0; }
  }, []);

  const finishSceneSession = useCallback(async (sessionId: number): Promise<void> => {
    try { await invoke("db_finish_scene_session", { sessionId }); }
    catch (error) { reportWriteError("finishSceneSession", error, "保存学习进度失败"); }
  }, []);

  const saveSceneAttempt = useCallback(async (input: SceneAttemptInput): Promise<void> => {
    try {
      await invoke("db_save_scene_attempt", {
        sessionId: input.sessionId, sceneVocabularyId: input.sceneVocabularyId,
        mode: input.mode, correct: input.correct, responseMs: input.responseMs,
        hintsUsed: input.hintsUsed,
      });
    } catch (error) { reportWriteError("saveSceneAttempt", error, "保存答题记录失败"); }
  }, []);

  const addSceneWordsToVocabulary = useCallback(async (ids: number[]): Promise<SceneWordAddResult> => {
    try { return await invoke<SceneWordAddResult>("db_add_scene_words_to_vocabulary", { sceneVocabularyIds: ids }); }
    catch (error) {
      reportWriteError("addSceneWordsToVocabulary", error, "添加场景词汇失败");
      return { added: 0, linked: 0, skipped: ids.length };
    }
  }, []);

  return useMemo(() => ({
    listScenes, getSceneLesson, saveSceneLesson, startSceneSession,
    finishSceneSession, saveSceneAttempt, addSceneWordsToVocabulary,
  }), [listScenes, getSceneLesson, saveSceneLesson, startSceneSession, finishSceneSession, saveSceneAttempt, addSceneWordsToVocabulary]);
}
