/**
 * SM-2 Spaced Repetition Algorithm
 * Based on the SuperMemo SM-2 algorithm used by Anki
 */

export interface SRSRecord {
  entityId: number;
  entityType: string;
  srsLevel: number;
  srsEase: number;
  reviewCount: number;
  lastReviewedAt?: string;
  nextReviewAt?: string;
}

/**
 * Calculate the next review date based on SM-2 algorithm
 */
export function calculateNextReview(
  quality: number, // 0-5 (0=complete blackout, 5=perfect)
  currentEase: number,
  currentLevel: number,
  reviewCount: number
): { ease: number; level: number; interval: number } {
  // SM-2 algorithm
  let newEase = currentEase;
  let newLevel: number;

  if (quality >= 3) {
    // Correct response
    if (reviewCount === 0) {
      newLevel = 1;
    } else if (reviewCount === 1) {
      newLevel = 6;
    } else {
      newLevel = Math.round(currentLevel * currentEase);
    }
  } else {
    // Incorrect response - reset
    newLevel = 1;
  }

  // Update ease factor
  newEase = Math.max(
    1.3,
    currentEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  // Cap the interval
  const maxInterval = 365;
  newLevel = Math.min(newLevel, maxInterval);

  return {
    ease: newEase,
    level: newLevel,
    interval: newLevel,
  };
}

/**
 * Get the star rating (1-5) from SRS level
 */
export function getStarsFromLevel(level: number): number {
  if (level === 0) return 0;
  if (level <= 2) return 1;
  if (level <= 7) return 2;
  if (level <= 15) return 3;
  if (level <= 30) return 4;
  return 5;
}

/**
 * Get the human-readable next review label
 */
export function getNextReviewLabel(nextReviewAt?: string): string {
  if (!nextReviewAt) return "新词";

  const now = new Date();
  const next = new Date(nextReviewAt);
  const diffDays = Math.ceil(
    (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays <= 0) return "待复习";
  if (diffDays === 1) return "明天";
  if (diffDays <= 7) return `${diffDays} 天后`;
  return next.toLocaleDateString("zh-CN");
}
