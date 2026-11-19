// Multiple-choice questions built from the learner's own saved cards (no AI call needed).

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
export function buildOptions(correct: string, others: readonly string[], rng: () => number = Math.random, count = 4): Option[] | null {
  const right = correct.trim();
  const seen = new Set([right.toLowerCase()]);
  const wrong: string[] = [];
  for (const o of shuffle(others, rng)) {
    const t = o.trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); wrong.push(t); }
    if (wrong.length === count - 1) break;
  }
  if (!right || wrong.length < 1) return null;
  return shuffle([{ text: right, correct: true }, ...wrong.map((text) => ({ text, correct: false }))], rng);
}
