// Picks and orders the cards for a practice session.
import { shuffle } from "./quiz";
import { isDue } from "./schedule";

export interface Reviewable {
  id: string;
  review: { reviewStage: number; lastResult?: "correct" | "incorrect" | null; nextReviewAt?: Date | null; incorrectCount?: number; attemptCount?: number };
}

export type SessionKind = "due" | "all" | "mistakes";

export function dueCount(cards: readonly Reviewable[], now: Date): number {
  return cards.filter((c) => isDue(c.review.nextReviewAt, now)).length;
}
const missCount = (c: Reviewable) => c.review.incorrectCount ?? 0;

// Cards last answered wrong, the ones missed most often first.
export const mistakes = <T extends Reviewable>(cards: readonly T[]): T[] =>
  cards.filter((c) => c.review.lastResult === "incorrect").sort((a, b) => missCount(b) - missCount(a));

// Share of a session reserved for cards that are overdue; new cards get the rest. Whichever side has
// fewer cards than its share hands the spare slots to the other side.
export const OVERDUE_SHARE = 0.65;

// The cards that are due now: overdue ones (oldest first) and new ones (never answered), mixed 65 / 35,
// then shuffled so new and old cards come in a mixed order.
export function pickDue<T extends Reviewable>(cards: readonly T[], now: Date, limit: number, rng: () => number = Math.random): T[] {
  const overdue = cards
    .filter((c) => c.review.nextReviewAt && isDue(c.review.nextReviewAt, now))
    .sort((a, b) => a.review.nextReviewAt!.getTime() - b.review.nextReviewAt!.getTime());
  const fresh = cards.filter((c) => !c.review.nextReviewAt);
  const overdueSlots = Math.min(overdue.length, Math.round(limit * OVERDUE_SHARE));
  const freshSlots = Math.min(fresh.length, limit - Math.round(limit * OVERDUE_SHARE));
  const spare = Math.max(0, limit - overdueSlots - freshSlots);
  const moreOverdue = Math.min(spare, overdue.length - overdueSlots);
  const moreFresh = Math.min(spare - moreOverdue, fresh.length - freshSlots);
  return shuffle([...overdue.slice(0, overdueSlots + moreOverdue), ...fresh.slice(0, freshSlots + moreFresh)], rng);
}

// "due": what is due now (see pickDue). "all" (Study anyway): the due cards first, then the rest, lowest step first.
// "mistakes": the cards last answered wrong, most missed first.
export function buildSession<T extends Reviewable>(cards: readonly T[], kind: SessionKind, now: Date, limit = 20, rng: () => number = Math.random): T[] {
  if (kind === "mistakes") return mistakes(cards).slice(0, limit);
  const due = pickDue(cards, now, limit, rng);
  if (kind === "due" || due.length >= limit) return due;
  const t = (c: T) => c.review.nextReviewAt?.getTime() ?? 0;
  const rest = cards.filter((c) => !isDue(c.review.nextReviewAt, now)).sort((a, b) => a.review.reviewStage - b.review.reviewStage || t(a) - t(b));
  return [...due, ...rest].slice(0, limit);
}
