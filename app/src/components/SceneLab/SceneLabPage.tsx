import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import type { SceneLesson, SceneSummary } from "@/features/scene-lab/types";
import { useSceneLessonGenerator } from "@/features/scene-lab/hooks/useSceneLessonGenerator";
import { SceneLibrary } from "./SceneLibrary";
import { KitchenWorkspace } from "./Kitchen/KitchenWorkspace";

export default function SceneLabPage() {
  const db = useDB();
  const { generateKitchen, isGenerating } = useSceneLessonGenerator();
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [lesson, setLesson] = useState<SceneLesson | null>(null);
  const refresh = useCallback(() => db.listScenes().then(setScenes), [db]);
  useEffect(() => { refresh(); }, [refresh]);
  const open = async (id: number) => { const value = await db.getSceneLesson(id); if (value) setLesson(value); };
  const generate = async () => { try { const id = await generateKitchen(); if (id) { await refresh(); await open(id); } } catch (error: any) { toast.error(error?.message || "生成失败"); } };
  if (lesson) return <KitchenWorkspace lesson={lesson} onLessonChange={setLesson} onExit={() => { setLesson(null); refresh(); }} />;
  return <SceneLibrary scenes={scenes} generating={isGenerating} onGenerate={generate} onOpen={open} />;
}
