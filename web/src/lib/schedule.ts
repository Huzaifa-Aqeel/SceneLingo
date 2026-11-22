// Review schedule (FR-PRA-007). A card sits on a ladder of gaps. "Got it" moves it up one step and
// "Still learning" moves it down one step. The card comes back after the gap of the step it lands on.

export const LADDER_DAYS = [1, 3, 7, 14, 30, 60]; // the wait for a card on step 0, 1, 2 ... 5
export const TOP_STAGE = LADDER_DAYS.length - 1;

// "again" = Still learning, "good" = Got it.
export type Rating = "again" | "good";
export const RATING_LABEL: Record<Rating, string> = { again: "Still learning", good: "Got it" };

export interface Schedule { stage: number; dueAt: Date }

const DAY = 86_400_000;

export function nextReview(stage: number, rating: Rating, now: Date): Schedule {
  const at = Math.min(Math.max(Math.floor(stage) || 0, 0), TOP_STAGE);
  const to = rating === "good" ? Math.min(at + 1, TOP_STAGE) : Math.max(at - 1, 0);
  const days = LADDER_DAYS[to]!;
  return { stage: to, dueAt: new Date(now.getTime() + days * DAY) };
}

// A card that has never been reviewed is due now.
export const isDue = (nextReviewAt: Date | null | undefined, now: Date): boolean => !nextReviewAt || nextReviewAt.getTime() <= now.getTime();
