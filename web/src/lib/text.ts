// Text handling for subtitles: sentences, word tokens, selections, normalization, card identity.

export interface Token { text: string; start: number; end: number; isWord: boolean }
export type SelectionKind = "word" | "phrase" | "sentence";
export interface Selection { sentenceIndex: number; from: number; to: number; whole: boolean }
export interface Selected { text: string; start: number; end: number; kind: SelectionKind }

const TITLE_END = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|Gen|Capt|Lt|Sgt|Col|vs)\.$/i;

// Sentence segmentation. Intl.Segmenter splits after "Dr." and "Mrs.", so those are re-joined.
export function splitSentences(text: string): string[] {
  const t = String(text ?? "").trim();
  if (!t) return [];
  let parts: string[] = [];
  try {
    parts = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(t)].map((x) => x.segment.trim()).filter(Boolean);
  } catch {
    parts = t.split(/(?<=[.!?…]["')\]]?)\s+/).map((x) => x.trim()).filter(Boolean);
  }
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let cur = parts[i]!;
    while (TITLE_END.test(cur) && i + 1 < parts.length) cur = `${cur} ${parts[++i]!}`;
    out.push(cur);
  }
  return out.length ? out : [t];
}

export function tokenize(sentence: string): Token[] {
  return [...new Intl.Segmenter("en", { granularity: "word" }).segment(sentence)].map((s) => ({
    text: s.segment,
    start: s.index,
    end: s.index + s.segment.length,
    isWord: !!s.isWordLike,
  }));
}

export const wordsOf = (sentence: string): Token[] => tokenize(sentence).filter((t) => t.isWord);

// A selection is a "sentence" only when it is the whole line AND long enough to be one. A short line that is
// selected whole ("Break a leg!", "Help me, help you.") is an expression, and is practised like any phrase.
export const SENTENCE_MIN_WORDS = 7;
const wordCount = (text: string): number => wordsOf(text).length;
export const kindOf = (count: number, whole: boolean): SelectionKind => (count <= 1 ? "word" : whole && count >= SENTENCE_MIN_WORDS ? "sentence" : "phrase");

// For cards saved before that rule: a short "sentence" card is really a phrase.
export const effectiveKind = (selectedText: string, kind: string): string => (kind === "sentence" && wordCount(selectedText) < SENTENCE_MIN_WORDS ? (wordCount(selectedText) <= 1 ? "word" : "phrase") : kind);
export const isSentenceCard = (c: { selectedText: string; selectionKind: string }): boolean => effectiveKind(c.selectedText, c.selectionKind) === "sentence";

// The exact text the learner selected, with the character range inside the sentence.
export function selectedFrom(sentence: string, words: Token[], sel: Selection): Selected | null {
  if (sel.whole) {
    const text = sentence.trim();
    if (!text) return null;
    const start = sentence.indexOf(text);
    return { text, start, end: start + text.length, kind: kindOf(wordCount(text), true) };
  }
  const a = words[Math.min(sel.from, sel.to)];
  const b = words[Math.max(sel.from, sel.to)];
  if (!a || !b) return null;
  const text = sentence.slice(a.start, b.end);
  const lo = Math.min(sel.from, sel.to), hi = Math.max(sel.from, sel.to);
  const kind: SelectionKind = kindOf(hi - lo + 1, lo === 0 && hi === words.length - 1);
  return { text, start: a.start, end: b.end, kind };
}

// Lower-cased, single-spaced, edge punctuation removed. Used for card identity and answer checking.
export function normalizeText(s: string): string {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
}

// A card is identified by what was selected and the sentence it came from (never by category).
// Deterministic, so saving the same thing twice, even from two devices, lands on the same document.
export async function cardIdFor(selectedText: string, sourceSentence: string): Promise<string> {
  const data = new TextEncoder().encode(`${normalizeText(selectedText)}\u241f${normalizeText(sourceSentence)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Splits a sentence around the saved text so it can be shown as a fill-in-the-blank. Null if it can't be located.
export function blankOut(sentence: string, term: string): { before: string; match: string; after: string } | null {
  const t = term.trim();
  if (!t) return null;
  const i = sentence.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return null;
  return { before: sentence.slice(0, i), match: sentence.slice(i, i + t.length), after: sentence.slice(i + t.length) };
}
