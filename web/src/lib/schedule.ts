// Review schedule (FR-PRA-007). Cards climb a ladder of growing gaps. "Got it" moves a card up one step;
// "Still learning" sends it back to the start and brings it back within minutes.

export const INTERVAL_DAYS = [3, 7, 14, 30, 60];
export const RETRY_MINUTES = 10;

// "again" = Still learning, "good" = Got it.
export type Rating = "again" | "good";
export const RATING_LABEL: Record<Rating, string> = { again: "Still learning", good: "Got it" };

export interface Schedule { stage: number; dueAt: Date; minutes: number }

const DAY = 86_400_000;

export function nextReview(stage: number, rating: Rating, now: Date): Schedule {
  if (rating === "again") return { stage: 0, minutes: RETRY_MINUTES, dueAt: new Date(now.getTime() + RETRY_MINUTES * 60_000) };
  const at = Math.min(Math.max(Math.floor(stage) || 0, 0), INTERVAL_DAYS.length);
  const s = Math.min(at + 1, INTERVAL_DAYS.length);
  const days = INTERVAL_DAYS[s - 1]!;
  return { stage: s, minutes: days * 1440, dueAt: new Date(now.getTime() + days * DAY) };
}

// "10 min", "3 days", "2 months": what each button promises.
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
