import type { SceneTask, SceneTaskStep } from "../types";

export interface TaskState { stepIndex: number; mistakes: number; hintsUsed: number; complete: boolean }
export const initialTaskState: TaskState = { stepIndex: 0, mistakes: 0, hintsUsed: 0, complete: false };

export function answerTask(task: SceneTask, state: TaskState, answer: { type: "find" | "select"; value: string }): { state: TaskState; correct: boolean } {
  const step: SceneTaskStep | undefined = task.steps[state.stepIndex];
  if (!step || state.complete) return { state, correct: false };
  const correct = step.type === answer.type && (step.type === "find" ? step.object_key : step.action) === answer.value;
  if (!correct) return { state: { ...state, mistakes: state.mistakes + 1 }, correct: false };
  const next = state.stepIndex + 1;
  return { correct: true, state: { ...state, stepIndex: next, complete: next >= task.steps.length } };
}

export function currentTaskInstruction(task: SceneTask, state: TaskState, chinese = true): string {
  const step = task.steps[state.stepIndex];
  return step ? (chinese ? step.instruction_zh : step.instruction_en) : "";
}
