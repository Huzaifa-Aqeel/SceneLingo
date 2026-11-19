// Review schedule (FR-PRA-007). Cards climb a ladder of growing gaps. "Got it" moves a card up one step;
// "Still learning" sends it back to the start, due straight away, so it stays in the due list until it is known.

export const INTERVAL_DAYS = [3, 7, 14, 30, 60];

// "again" = Still learning, "good" = Got it.
export type Rating = "again" | "good";
export const RATING_LABEL: Record<Rating, string> = { again: "Still learning", good: "Got it" };

export interface Schedule { stage: number; dueAt: Date; minutes: number }

const DAY = 86_400_000;

export function nextReview(stage: number, rating: Rating, now: Date): Schedule {
  if (rating === "again") return { stage: 0, minutes: 0, dueAt: now };
  const at = Math.min(Math.max(Math.floor(stage) || 0, 0), INTERVAL_DAYS.length);
  const s = Math.min(at + 1, INTERVAL_DAYS.length);
  const days = INTERVAL_DAYS[s - 1]!;
  return { stage: s, minutes: days * 1440, dueAt: new Date(now.getTime() + days * DAY) };
}

// "Today", "3 days", "2 months": what each button promises.
export function describeGap(minutes: number): string {
  const days = Math.round(minutes / 1440);
  if (days < 1) return "Today";
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "month" : "months"}`;
}

export const gapFor = (stage: number, rating: Rating, now: Date): string => describeGap(nextReview(stage, rating, now).minutes);

// A card that has never been reviewed is due now.
export const isDue = (nextReviewAt: Date | null | undefined, now: Date): boolean => !nextReviewAt || nextReviewAt.getTime() <= now.getTime();
