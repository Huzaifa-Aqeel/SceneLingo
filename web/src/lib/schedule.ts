// Review schedule (FR-PRA-007). Cards climb a ladder of growing gaps. The learner's rating decides how far
// a card moves: Again sends it back to the start, Difficult keeps its place, Good climbs one step, Easy two.

export const INTERVAL_DAYS = [3, 7, 14, 30, 60];
export const RETRY_MINUTES = 10;
export const HARD_DAYS = 1;

export const RATINGS = ["again", "hard", "good", "easy"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABEL: Record<Rating, string> = { again: "Again", hard: "Difficult", good: "Good", easy: "Easy" };

export interface Schedule { stage: number; dueAt: Date; minutes: number }

const DAY = 86_400_000;

export function nextReview(stage: number, rating: Rating, now: Date): Schedule {
  const at = Math.min(Math.max(Math.floor(stage) || 0, 0), INTERVAL_DAYS.length);
  if (rating === "again") return { stage: 0, minutes: RETRY_MINUTES, dueAt: new Date(now.getTime() + RETRY_MINUTES * 60_000) };
  if (rating === "hard") return { stage: at, minutes: HARD_DAYS * 1440, dueAt: new Date(now.getTime() + HARD_DAYS * DAY) };
  const s = Math.min(at + (rating === "easy" ? 2 : 1), INTERVAL_DAYS.length);
  const days = INTERVAL_DAYS[s - 1]!;
  return { stage: s, minutes: days * 1440, dueAt: new Date(now.getTime() + days * DAY) };
}

// "10 min", "1 day", "3 days", "2 months": what each rating button promises.
export function describeGap(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const days = Math.round(minutes / 1440);
  if (days < 1) return `${Math.round(minutes / 60)} h`;
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "month" : "months"}`;
}

export const gapFor = (stage: number, rating: Rating, now: Date): string => describeGap(nextReview(stage, rating, now).minutes);

// A card that has never been reviewed is due now.
export const isDue = (nextReviewAt: Date | null | undefined, now: Date): boolean => !nextReviewAt || nextReviewAt.getTime() <= now.getTime();
