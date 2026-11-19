import { describe, expect, it } from "vitest";
import { blankOut, cardIdFor, isCorrectAnswer, normalizeText, selectedFrom, splitSentences, tokenize, wordsOf } from "@/lib/text";
import { INTERVAL_DAYS, isDue, nextReview } from "@/lib/schedule";
import { buildOptions, shuffle } from "@/lib/quiz";
import { buildSession, dueCount, mistakes } from "@/lib/session";
import { summarize } from "@/lib/stats";
import { buildExplainConfig, buildExplainPrompt, validateEnglishCard } from "@/ai/englishCard";
import { parseCard } from "@/lib/schemas";

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("sentences and selection", () => {
  it("splits on real sentence ends and keeps titles together", () => {
    expect(splitSentences("I think so. Do you? Yes!")).toEqual(["I think so.", "Do you?", "Yes!"]);
    expect(splitSentences("Dr. Smith is here.")).toEqual(["Dr. Smith is here."]);
    expect(splitSentences("Mr. and Mrs. Jones left.")).toEqual(["Mr. and Mrs. Jones left."]);
    expect(splitSentences("  ")).toEqual([]);
  });

  const s = "I think we're getting ahead of ourselves.";
  const words = wordsOf(s);
  it("tokenizes words, keeps contractions whole, and drops punctuation", () => {
    expect(words.map((w) => w.text)).toEqual(["I", "think", "we're", "getting", "ahead", "of", "ourselves"]);
    expect(tokenize(s).some((t) => !t.isWord)).toBe(true);
  });
  it("selects a word, a phrase, and the whole sentence, exactly as typed", () => {
    expect(selectedFrom(s, words, { sentenceIndex: 0, from: 1, to: 1, whole: false })).toMatchObject({ text: "think", kind: "word" });
    expect(selectedFrom(s, words, { sentenceIndex: 0, from: 3, to: 6, whole: false })).toMatchObject({ text: "getting ahead of ourselves", kind: "phrase" });
    expect(selectedFrom(s, words, { sentenceIndex: 0, from: 6, to: 3, whole: false })?.text).toBe("getting ahead of ourselves"); // either drag direction
    expect(selectedFrom(s, words, { sentenceIndex: 0, from: 0, to: 0, whole: true })).toMatchObject({ text: s, kind: "sentence" });
    expect(selectedFrom(s, words, { sentenceIndex: 0, from: 99, to: 99, whole: false })).toBeNull();
  });
  it("keeps internal punctuation of a phrase", () => {
    const t = "Well, you know, it's fine.";
    expect(selectedFrom(t, wordsOf(t), { sentenceIndex: 0, from: 0, to: 2, whole: false })?.text).toBe("Well, you know");
  });
});

describe("card identity", () => {
  it("ignores case, spacing and edge punctuation; ignores nothing that matters", async () => {
    const a = await cardIdFor("Getting ahead of ourselves", "I think we're getting ahead of ourselves.");
    const b = await cardIdFor("  getting AHEAD of ourselves!", "i think we're getting ahead of ourselves");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
  it("gives a different card for a different source sentence", async () => {
    const a = await cardIdFor("break the ice", "Let's break the ice.");
    const b = await cardIdFor("break the ice", "He tried to break the ice at dinner.");
    expect(a).not.toBe(b);
  });
  it("normalizes text", () => {
    expect(normalizeText("  “Hello,   World!” ")).toBe("hello, world");
  });
});

describe("fill in the blank", () => {
  it("blanks the saved text and checks answers loosely", () => {
    const b = blankOut("I think we're getting ahead of ourselves.", "getting ahead of ourselves");
    expect(b).toEqual({ before: "I think we're ", match: "getting ahead of ourselves", after: "." });
    expect(blankOut("Nothing here.", "missing")).toBeNull();
    expect(isCorrectAnswer("  Getting ahead of OURSELVES ", "getting ahead of ourselves")).toBe(true);
    expect(isCorrectAnswer("", "x")).toBe(false);
    expect(isCorrectAnswer("wrong", "right")).toBe(false);
  });
});

describe("review schedule", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  it("moves up on correct answers through the intervals, and caps", () => {
    let stage = 0;
    const days: number[] = [];
    for (let i = 0; i < 7; i++) {
      const n = nextReview(stage, true, now);
      days.push(Math.round((n.dueAt.getTime() - now.getTime()) / 86_400_000));
      stage = n.stage;
    }
    expect(days).toEqual([...INTERVAL_DAYS, 30, 30]);
  });
  it("sends a wrong answer back to the start and brings it back within minutes", () => {
    const n = nextReview(4, false, now);
    expect(n.stage).toBe(0);
    expect(n.dueAt.getTime() - now.getTime()).toBe(10 * 60_000);
  });
  it("treats a never-reviewed card as due", () => {
    expect(isDue(null, now)).toBe(true);
    expect(isDue(new Date(now.getTime() + 1000), now)).toBe(false);
    expect(isDue(new Date(now.getTime() - 1000), now)).toBe(true);
  });
});

describe("quiz options", () => {
  it("includes the right answer plus distinct wrong ones", () => {
    const o = buildOptions("to act too early", ["to act too early", "to start a talk", "a kind of boat", "a kind of boat", "to leave"], seeded(3))!;
    expect(o).toHaveLength(4);
    expect(o.filter((x) => x.correct)).toHaveLength(1);
    expect(new Set(o.map((x) => x.text.toLowerCase())).size).toBe(4);
  });
  it("returns fewer options when there are few cards, and none when there are no alternatives", () => {
    expect(buildOptions("a", ["b"], seeded())).toHaveLength(2);
    expect(buildOptions("a", ["a", "A "], seeded())).toBeNull();
    expect(buildOptions("", ["b"], seeded())).toBeNull();
  });
  it("shuffles without losing items", () => {
    expect(shuffle([1, 2, 3, 4, 5], seeded(9)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("practice sessions", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const card = (id: string, stage: number, due: string | null, last: "correct" | "incorrect" | null = null) =>
    ({ id, review: { reviewStage: stage, nextReviewAt: due ? new Date(due) : null, lastResult: last } });
  const cards = [
    card("future", 3, "2026-01-20T00:00:00Z", "correct"),
    card("new", 0, null),
    card("overdue-old", 1, "2026-01-02T00:00:00Z", "correct"),
    card("overdue-new", 1, "2026-01-08T00:00:00Z", "incorrect"),
  ];
  it("counts due cards and picks them oldest first", () => {
    expect(dueCount(cards, now)).toBe(3);
    expect(buildSession(cards, "due", now).map((c) => c.id)).toEqual(["new", "overdue-old", "overdue-new"]);
  });
  it("study-all puts due cards first, then the rest", () => {
    expect(buildSession(cards, "all", now).map((c) => c.id)).toEqual(["new", "overdue-old", "overdue-new", "future"]);
  });
  it("mistakes are the cards last answered wrong", () => {
    expect(mistakes(cards).map((c) => c.id)).toEqual(["overdue-new"]);
    expect(buildSession(cards, "mistakes", now).map((c) => c.id)).toEqual(["overdue-new"]);
  });
  it("respects the session size", () => {
    expect(buildSession(cards, "all", now, 2)).toHaveLength(2);
  });
});

describe("progress statistics", () => {
  const now = new Date(2026, 0, 10, 15, 0);
  const ev = (d: number, result: "correct" | "incorrect") => ({ result, reviewedAt: new Date(2026, 0, d, 9, 0) });
  it("computes totals, accuracy, the 14-day series and the streak", () => {
    const s = summarize([ev(10, "correct"), ev(10, "incorrect"), ev(9, "correct"), ev(8, "correct"), ev(5, "correct")], now);
    expect(s).toMatchObject({ total: 5, correct: 4, accuracy: 80, streak: 3 });
    expect(s.recent).toHaveLength(14);
    expect(s.recent.at(-1)).toMatchObject({ total: 2, correct: 1 });
  });
  it("keeps the streak alive when only yesterday has reviews, and resets after a gap", () => {
    expect(summarize([ev(9, "correct"), ev(8, "correct")], now).streak).toBe(2);
    expect(summarize([ev(7, "correct")], now).streak).toBe(0);
  });
  it("handles no history", () => {
    expect(summarize([], now)).toMatchObject({ total: 0, accuracy: null, streak: 0 });
  });
});

describe("English card", () => {
  const good = { category: "idiom", meaningEn: "To act too early.", contextualMeaningEn: "The speaker thinks they're rushing.", synonyms: ["rush", "jump the gun", "assume too much", "a fourth"], exampleSentences: ["Let's wait for the results.", "Don't rush.", "A third"], usageNote: null };
  it("accepts a good card, caps synonyms at 3 and examples at 2, fills missing optionals with null", () => {
    const c = validateEnglishCard(JSON.stringify(good));
    expect(c.synonyms).toHaveLength(3);
    expect(c.exampleSentences).toHaveLength(2);
    expect(c).toMatchObject({ partOfSpeech: null, usageNote: null, confidenceNote: null });
  });
  it("rejects anything unusable so it is never saved", () => {
    expect(() => validateEnglishCard("nope")).toThrow();
    expect(() => validateEnglishCard({ ...good, category: "phrase" })).toThrow();
    expect(() => validateEnglishCard({ ...good, meaningEn: "  " })).toThrow();
    expect(() => validateEnglishCard({ ...good, exampleSentences: [] })).toThrow();
    expect(() => validateEnglishCard({ ...good, contextualMeaningEn: undefined })).toThrow();
  });
  it("is on-device first with the same structured output on both paths", () => {
    const c = buildExplainConfig();
    expect(c.mode).toBe("prefer_on_device");
    expect(c.onDeviceParams.promptOptions.responseConstraint).toBeTruthy();
    expect(c.inCloudParams.generationConfig.responseMimeType).toBe("application/json");
    expect(c.inCloudParams.model).toBe("gemini-3.5-flash-lite");
  });
  it("keeps the selection and the sentence separate in the prompt", () => {
    const p = buildExplainPrompt({ selectedText: "ahead of ourselves", selectionKind: "phrase", sourceSentence: "We're getting ahead of ourselves." });
    expect(p).toMatch(/Selected phrase: "ahead of ourselves"/);
    expect(p).toMatch(/Full subtitle sentence: "We're getting ahead of ourselves\."/);
    expect(p).not.toMatch(/Previous sentence/);
  });
});

describe("stored cards", () => {
  it("parses a stored card with defaults, and rejects a broken one", () => {
    const c = parseCard("c1", { selectedText: "break the ice", sourceSentence: "Let's break the ice.", category: "idiom", meaningEn: "m", contextualMeaningEn: "c" });
    expect(c).toMatchObject({ id: "c1", synonyms: [], translations: {}, review: { reviewStage: 0, attemptCount: 0, nextReviewAt: null } });
    expect(parseCard("c2", { selectedText: "", category: "idiom" })).toBeNull();
    expect(parseCard("c3", { selectedText: "x", sourceSentence: "x", category: "weird", meaningEn: "m", contextualMeaningEn: "c" })).toBeNull();
  });
});
