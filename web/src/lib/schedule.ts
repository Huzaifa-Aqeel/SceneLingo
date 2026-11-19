// Simple, deterministic review schedule (FR-PRA-007). A correct answer moves the card up one step;
// a wrong one sends it back to the start and brings it back within minutes.

export const INTERVAL_DAYS = [1, 3, 7, 14, 30];
export const RETRY_MINUTES = 10;

export interface Schedule { stage: number; dueAt: Date }

export function nextReview(stage: number, correct: boolean, now: Date): Schedule {
  if (!correct) return { stage: 0, dueAt: new Date(now.getTime() + RETRY_MINUTES * 60_000) };
  const s = Math.min(Math.max(stage, 0) + 1, INTERVAL_DAYS.length);
  const days = INTERVAL_DAYS[s - 1]!;
  return { stage: s, dueAt: new Date(now.getTime() + days * 86_400_000) };
}

// A card that has never been reviewed is due now.
export const isDue = (nextReviewAt: Date | null | undefined, now: Date): boolean => !nextReviewAt || nextReviewAt.getTime() <= now.getTime();
