// Picks and orders the cards for a practice session.
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

// New and overdue cards first (oldest due first), then the rest, lowest stage first.
export function buildSession<T extends Reviewable>(cards: readonly T[], kind: SessionKind, now: Date, limit = 20): T[] {
  if (kind === "mistakes") return mistakes(cards).slice(0, limit);
  const t = (c: T) => c.review.nextReviewAt?.getTime() ?? 0;
  const due = cards.filter((c) => isDue(c.review.nextReviewAt, now)).sort((a, b) => t(a) - t(b));
  if (kind === "due") return due.slice(0, limit);
  const rest = cards.filter((c) => !isDue(c.review.nextReviewAt, now)).sort((a, b) => a.review.reviewStage - b.review.reviewStage || t(a) - t(b));
  return [...due, ...rest].slice(0, limit);
}
