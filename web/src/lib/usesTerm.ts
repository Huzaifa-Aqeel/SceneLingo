// Does an example sentence actually use the word or phrase being taught? A card that teaches "groggy" with
// examples about "sleepy" and "drowsy" teaches nothing, so examples that avoid the term are rejected.
// Normal endings are accepted (groggy / groggier, stop / stopped, carry / carries), and so are changed
// pronouns ("help me, help you" / "help us, help them").

const SUFFIXES = ["", "s", "es", "ed", "d", "ing", "ings", "ly", "ily", "er", "ers", "est", "ier", "iest", "ies", "ied", "y", "ness", "iness"];

// Words that change with the speaker or add little: they never decide whether a phrase was used.
const FLEX = new Set(
  ("a an the of to in on at for with and or but as is are was were be been am do does did my your his her its our their me you him us them i we he she they it " +
    "myself yourself himself herself itself ourselves yourselves themselves one ones someone something somebody anyone anything that this these those not no's")
    .split(" ")
);

const WORD = /[\p{L}]+(?:['’][\p{L}]+)?/gu;
const words = (s: string): string[] => (String(s ?? "").normalize("NFKC").toLowerCase().replace(/’/g, "'").match(WORD) ?? []);

// The forms a word's stem can take: "stop" -> stop, stopp; "carry" -> carry, carr; "wake" -> wake, wak.
function stems(w: string): string[] {
  const s = new Set([w]);
  if (/[ey]$/.test(w) && w.length > 3) s.add(w.slice(0, -1));
  if (/[^aeiou]$/.test(w) && w.length >= 3) s.add(w + w.slice(-1));
  return [...s];
}

export function formOf(token: string, word: string): boolean {
  if (token === word) return true;
  return stems(word).some((st) => SUFFIXES.some((suf) => token === st + suf));
}

// kind "sentence": the whole line is the selection and examples can't reuse it, so nothing is required.
export function usesTerm(example: string, term: string, kind?: string): boolean {
  if (kind === "sentence") return true;
  const content = words(term).filter((w) => !FLEX.has(w));
  if (content.length === 0) return true; // nothing checkable (for example "you and I")
  const tokens = words(example);
  const matched = content.filter((w) => tokens.some((t) => formOf(t, w))).length;
  return matched >= Math.ceil(content.length / 2); // an idiom's irregular verb ("got" for "get") may not match, its other words must
}

// Character ranges in `text` that match the term, for highlighting what the learner said. Matching words that are
// separated only by small words ("break the ice", "help me, help you") are joined into one range.
export function termRanges(text: string, term: string): [number, number][] {
  const content = words(term).filter((w) => !FLEX.has(w));
  const src = String(text ?? "");
  const toks = [...src.matchAll(WORD)].map((m) => {
    const low = m[0].normalize("NFKC").toLowerCase().replace(/’/g, "'");
    return { a: m.index!, b: m.index! + m[0].length, low, hit: content.some((w) => formOf(low, w)) };
  });
  const out: [number, number][] = [];
  let i = 0;
  while (i < toks.length) {
    if (!toks[i]!.hit) { i++; continue; }
    let end = i, j = i + 1;
    while (j < toks.length && j - end <= 3) { // at most three small words in between
      if (toks[j]!.hit) { end = j; j++; continue; }
      if (!FLEX.has(toks[j]!.low)) break;
      j++;
    }
    out.push([toks[i]!.a, toks[end]!.b]);
    i = end + 1;
  }
  return out;
}
