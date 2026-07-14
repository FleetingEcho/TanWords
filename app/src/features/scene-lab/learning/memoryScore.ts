import type { LearningStatus } from "../types";

export interface MemoryEvidence { correct: boolean; responseMs: number; hintsUsed: number; ageDays?: number }

export function memoryScore(attempts: MemoryEvidence[]): number {
  if (!attempts.length) return 0;
  const total = attempts.reduce((score, item) => {
    const accuracy = item.correct ? 55 : 0;
    const speed = item.correct ? Math.max(0, 25 - item.responseMs / 400) : 0;
    const noHint = Math.max(0, 15 - item.hintsUsed * 7.5);
    const delayed = item.correct && (item.ageDays ?? 0) >= 1 ? 5 : 0;
    return score + accuracy + speed + noHint + delayed;
  }, 0);
  return Math.round(total / attempts.length);
}

export function learningStatus(attempts: MemoryEvidence[]): LearningStatus {
  const score = memoryScore(attempts);
  if (attempts.length >= 6 && score >= 80) return "mastered";
  if (attempts.length >= 3 && score >= 62) return "familiar";
  if (attempts.length > 0) return "learning";
  return "new";
}
