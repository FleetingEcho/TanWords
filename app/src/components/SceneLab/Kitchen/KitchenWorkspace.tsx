import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDB } from "@/hooks/useDB";
import type { SceneLesson, SceneMode } from "@/features/scene-lab/types";
import { KITCHEN_MANIFEST } from "@/features/scene-lab/kitchenManifest";
import { answerTask, currentTaskInstruction, initialTaskState } from "@/features/scene-lab/learning/taskMachine";
import { KitchenCanvas } from "./KitchenCanvas";
import { ObjectListFallback } from "./ObjectListFallback";
import { ObjectLessonPanel } from "../ObjectLessonPanel";

const MODES: { id: SceneMode; label: string }[] = [
  { id: "explore", label: "探索" }, { id: "semantic", label: "语义" },
  { id: "task", label: "任务" }, { id: "test", label: "测试" },
];

function canUseWebGL() {
  try { const canvas = document.createElement("canvas"); return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")); }
  catch { return false; }
}

export function KitchenWorkspace({ lesson, onExit, onLessonChange }: { lesson: SceneLesson; onExit: () => void; onLessonChange: (lesson: SceneLesson) => void }) {
  const db = useDB();
  const [mode, setMode] = useState<SceneMode>("explore");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const [taskIndex, setTaskIndex] = useState(0);
  const [taskState, setTaskState] = useState(initialTaskState);
  const [testIndex, setTestIndex] = useState(0);
  const [testStartedAt, setTestStartedAt] = useState(Date.now());
  const [testHints, setTestHints] = useState(0);
  const [weakIds, setWeakIds] = useState<Set<number>>(new Set());
  const [summarySelection, setSummarySelection] = useState<Set<number>>(new Set());
  const [showSummary, setShowSummary] = useState(false);
  const [use3d, setUse3d] = useState(canUseWebGL);
  const currentTask = lesson.tasks[taskIndex];
  const testWords = useMemo(() => lesson.vocabulary.filter((item) => item.id).slice(0, 12), [lesson]);
  const currentTest = testWords[testIndex % Math.max(1, testWords.length)];
  const weakKeys = useMemo(() => new Set(lesson.vocabulary.filter((item) => item.id && weakIds.has(item.id)).map((item) => item.object_key)), [lesson, weakIds]);

  useEffect(() => {
    let cancelled = false;
    db.startSceneSession(lesson.id, mode).then((id) => { if (!cancelled) setSessionId(id); });
    return () => { cancelled = true; };
  }, [lesson.id, mode]);

  const addWords = async (ids: number[]) => {
    const result = await db.addSceneWordsToVocabulary(ids);
    if (result.added + result.linked > 0) {
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      const refreshed = await db.getSceneLesson(lesson.id);
      if (refreshed) onLessonChange(refreshed);
      toast.success(`已添加 ${result.added + result.linked} 个词`);
    }
  };

  const handleObject = async (key: string) => {
    setSelectedKey(key);
    if (mode === "task" && currentTask) {
      const result = answerTask(currentTask, taskState, { type: "find", value: key });
      setTaskState(result.state);
      const taskWord = lesson.vocabulary.find((item) => item.id && item.object_key === key);
      if (taskWord?.id && sessionId) await db.saveSceneAttempt({ sessionId, sceneVocabularyId: taskWord.id, mode, correct: result.correct, responseMs: 0, hintsUsed: 0 });
      if (!result.correct && taskWord?.id) setWeakIds((prev) => new Set(prev).add(taskWord.id!));
      if (!result.correct) toast.error("不是这个物体，再找找看");
      else if (result.state.complete) toast.success("任务完成！");
    }
    if (mode === "test" && currentTest?.id) {
      const correct = currentTest.object_key === key;
      await db.saveSceneAttempt({ sessionId, sceneVocabularyId: currentTest.id, mode, correct, responseMs: Date.now() - testStartedAt, hintsUsed: testHints });
      if (!correct) setWeakIds((prev) => new Set(prev).add(currentTest.id!));
      toast[correct ? "success" : "error"](correct ? "正确" : `答案在 ${currentTest.object_key}`);
      setTestIndex((index) => index + 1); setTestStartedAt(Date.now()); setTestHints(0);
    }
  };

  const handleAction = async (action: string) => {
    if (!currentTask) return;
    const result = answerTask(currentTask, taskState, { type: "select", value: action });
    setTaskState(result.state);
    const actionWord = lesson.vocabulary.find((item) => item.id && item.word.toLowerCase() === action.toLowerCase());
    if (actionWord?.id && sessionId) await db.saveSceneAttempt({ sessionId, sceneVocabularyId: actionWord.id, mode, correct: result.correct, responseMs: 0, hintsUsed: 0 });
    if (!result.correct && actionWord?.id) setWeakIds((prev) => new Set(prev).add(actionWord.id!));
    if (!result.correct) toast.error("动作不正确");
    else if (result.state.complete) toast.success("任务完成！");
  };

  const recommended = lesson.vocabulary.filter((item) => item.id && !item.word_id && (weakIds.has(item.id) || item.learning_status === "learning"));
  const finish = async () => { if (sessionId) await db.finishSceneSession(sessionId); setSummarySelection(new Set(recommended.map((item) => item.id!))); setShowSummary(true); };

  if (showSummary) return <div className="mx-auto max-w-xl p-8"><div className="rounded-2xl border bg-card p-6"><h2 className="font-serif text-2xl font-bold">本轮完成</h2><p className="mt-2 text-sm text-muted-foreground">测试 {testIndex} 个 · 薄弱 {weakIds.size} 个</p><div className="mt-5 space-y-2">{recommended.map((item) => <label key={item.id} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3"><input type="checkbox" checked={summarySelection.has(item.id!)} onChange={() => setSummarySelection((prev) => { const next = new Set(prev); next.has(item.id!) ? next.delete(item.id!) : next.add(item.id!); return next; })} /><span className="font-semibold">{item.word}</span><span className="text-sm text-muted-foreground">{item.zh}</span></label>)}</div><div className="mt-5 flex gap-2"><Button onClick={() => addWords([...summarySelection])} disabled={!summarySelection.size}>添加推荐词</Button><Button variant="outline" onClick={() => setShowSummary(false)}>继续学习</Button><Button variant="ghost" onClick={onExit}>返回场景库</Button></div></div></div>;

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5"><Button variant="ghost" onClick={onExit}>← Scene Lab</Button><strong className="font-serif text-lg">Kitchen</strong><div className="ml-4 flex gap-1">{MODES.map((item) => <Button key={item.id} variant={mode === item.id ? "default" : "ghost"} onClick={() => { setMode(item.id); setTaskState(initialTaskState); }} className="h-8 text-xs">{item.label}</Button>)}</div><Button variant="outline" onClick={() => setUse3d((value) => !value)} className="ml-auto h-8 text-xs">{use3d ? "列表模式" : "3D 模式"}</Button><Button onClick={finish} className="h-8 text-xs">结束本轮</Button></header>
    {mode === "semantic" && <div className="flex shrink-0 gap-2 border-b px-5 py-2 text-xs">{[...new Set(KITCHEN_MANIFEST.objects.map((item) => item.category))].map((category) => <span key={category} className="rounded-full bg-muted px-2 py-1">{category}</span>)}</div>}
    {(mode === "task" && currentTask) && <div className="shrink-0 border-b bg-primary/5 px-5 py-3"><strong>{currentTask.title_zh}</strong><span className="ml-3 text-sm">{taskState.complete ? "完成！" : currentTaskInstruction(currentTask, taskState)}</span>{currentTask.steps[taskState.stepIndex]?.type === "select" && <span className="ml-3 inline-flex gap-1">{KITCHEN_MANIFEST.actions.map((action) => <Button key={action} variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(action)}>{action}</Button>)}</span>}</div>}
    {mode === "test" && currentTest && <div className="shrink-0 border-b bg-amber-500/10 px-5 py-3 text-center"><span className="text-sm text-muted-foreground">请在场景中找到：</span><strong className="ml-2 text-lg">{currentTest.zh}</strong><button onClick={() => { setSelectedKey(currentTest.object_key); setTestHints((count) => count + 1); setWeakIds((prev) => new Set(prev).add(currentTest.id!)); }} className="ml-3 text-xs text-primary underline">提示</button></div>}
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] gap-3 p-3"><div>{use3d ? <KitchenCanvas selectedKey={selectedKey} weakKeys={mode === "semantic" ? weakKeys : new Set()} onSelect={handleObject} /> : <ObjectListFallback selectedKey={selectedKey} onSelect={handleObject} />}</div><aside className="min-h-0 overflow-hidden rounded-2xl border bg-card"><ObjectLessonPanel objectKey={selectedKey} words={lesson.vocabulary} onAdd={(id) => addWords([id])} /></aside></div>
  </div>;
}
