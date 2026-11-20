// Multiple-choice questions built from the learner's own saved cards (no AI call needed).
import { blankOut } from "./text";

export interface Option { text: string; correct: boolean }

export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// Up to `count` options: the right meaning plus wrong ones taken from other cards.
// Returns null when there aren't enough distinct meanings to make a fair question.
// `preferred` are tried first (the same category), then the rest.
export function buildOptions(correct: string, others: readonly string[], rng: () => number = Math.random, count = 4, preferred: readonly string[] = []): Option[] | null {
  const right = correct.trim();
  const seen = new Set([right.toLowerCase()]);
  const wrong: string[] = [];
  for (const o of [...shuffle(preferred, rng), ...shuffle(others, rng)]) {
    const t = o.trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); wrong.push(t); }
    if (wrong.length === count - 1) break;
  }
  if (!right || wrong.length < 1) return null;
  return shuffle([{ text: right, correct: true }, ...wrong.map((text) => ({ text, correct: false }))], rng);
}

// ---------------------------------------------------------------- the three question formats

export type QuizFormat = "meaning" | "complete" | "context";
export const QUIZ_MIN_CARDS = 4;

interface QuizCard { id: string; category: string; selectedText: string; selectionKind: string; sourceSentence: string; meaningEn: string; contextualMeaningEn: string }
export interface Question<C extends QuizCard = QuizCard> {
  card: C;
  format: QuizFormat;
  options: Option[];
  // The subtitle split around the saved text (complete and context formats).
  sentence: { before: string; match: string; after: string } | null;
}

// One question of the given format, or null when the card or its neighbours can't support it.
export function buildQuestion<C extends QuizCard>(card: C, all: readonly C[], format: QuizFormat, rng: () => number = Math.random): Question<C> | null {
  const others = all.filter((c) => c.id !== card.id);
  const same = others.filter((c) => c.category === card.category); // wrong options from the same category are fairer
  const sentence = blankOut(card.sourceSentence, card.selectedText);
  let options: Option[] | null = null;
  if (format === "meaning") {
    options = buildOptions(card.meaningEn, others.map((c) => c.meaningEn), rng, 4, same.map((c) => c.meaningEn));
  } else if (format === "complete") {
    if (!sentence || card.selectionKind === "sentence") return null;
    options = buildOptions(card.selectedText, others.filter((c) => c.selectionKind !== "sentence").map((c) => c.selectedText), rng, 4, same.filter((c) => c.selectionKind !== "sentence").map((c) => c.selectedText));
  } else {
    if (!sentence) return null;
    options = buildOptions(card.contextualMeaningEn, others.map((c) => c.contextualMeaningEn), rng, 4, same.map((c) => c.contextualMeaningEn));
  }
  return options && options.length >= 3 ? { card, format, options, sentence: format === "meaning" ? null : sentence } : null;
}

// Gives each card a format in turn (meaning, complete, context), falling back to "meaning" when a card can't take it.
export function planQuiz<C extends QuizCard>(session: readonly C[], all: readonly C[], rng: () => number = Math.random): Question<C>[] {
  const order: QuizFormat[] = ["meaning", "complete", "context"];
  const start = Math.floor(rng() * order.length);
  const out: Question<C>[] = [];
  session.forEach((card, i) => {
    const wanted = order[(start + i) % order.length]!;
    const q = buildQuestion(card, all, wanted, rng) ?? buildQuestion(card, all, "meaning", rng);
    if (q) out.push(q);
  });
  return out;
}
