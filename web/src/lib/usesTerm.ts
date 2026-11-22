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
