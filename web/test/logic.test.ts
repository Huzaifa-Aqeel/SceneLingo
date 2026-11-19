import { describe, expect, it } from "vitest";
import { blankOut, cardIdFor, normalizeText, selectedFrom, splitSentences, tokenize, wordsOf } from "@/lib/text";
import { describeGap, gapFor, INTERVAL_DAYS, isDue, nextReview } from "@/lib/schedule";
import { buildOptions, buildQuestion, planQuiz, shuffle } from "@/lib/quiz";
import { buildSession, dueCount, mistakes, needsWork } from "@/lib/session";
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

describe("blanking the saved text", () => {
  it("splits the sentence around it", () => {
    const b = blankOut("I think we're getting ahead of ourselves.", "getting ahead of ourselves");
    expect(b).toEqual({ before: "I think we're ", match: "getting ahead of ourselves", after: "." });
    expect(blankOut("Nothing here.", "missing")).toBeNull();
  });
});

describe("review schedule", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const days = (n: { dueAt: Date }) => Math.round((n.dueAt.getTime() - now.getTime()) / 86_400_000);
  it("sends a missed card to the start, due straight away", () => {
    const n = nextReview(4, "again", now);
    expect(n.stage).toBe(0);
    expect(n.dueAt.getTime()).toBe(now.getTime());
    expect(isDue(n.dueAt, now)).toBe(true);
  });
  it("climbs the ladder one step on Got it and caps at the top", () => {
    let stage = 0;
    const gaps: number[] = [];
    for (let i = 0; i < 7; i++) {
      const n = nextReview(stage, "good", now);
      gaps.push(days(n));
      stage = n.stage;
    }
    expect(gaps).toEqual([...INTERVAL_DAYS, 60, 60]);
  });
  it("describes the gaps in plain words", () => {
    expect(gapFor(2, "again", now)).toBe("Today");
    expect(gapFor(0, "good", now)).toBe("3 days");
    expect(gapFor(3, "good", now)).toBe("1 month");
    expect(gapFor(4, "good", now)).toBe("2 months");
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

describe("quiz questions", () => {
  const mk = (id: string, text: string, sentence: string, meaning: string, ctx: string, kind = "phrase") =>
    ({ id, selectedText: text, selectionKind: kind, sourceSentence: sentence, meaningEn: meaning, contextualMeaningEn: ctx });
  const cards = [
    mk("a", "jump the gun", "You always jump the gun.", "to act too early", "he is rushing"),
    mk("b", "under the weather", "I'm under the weather today.", "slightly ill", "she feels sick"),
    mk("c", "break a leg", "Break a leg tonight!", "good luck", "he wishes her luck"),
    mk("d", "piece of cake", "That was a piece of cake.", "very easy", "the test was easy"),
    mk("s", "Nothing lasts forever, does it?", "Nothing lasts forever, does it?", "things end", "she is sad", "sentence"),
  ];
  it("builds a complete-the-sentence question whose options are other expressions", () => {
    const q = buildQuestion(cards[0]!, cards, "complete", seeded())!;
    expect(q.sentence).toEqual({ before: "You always ", match: "jump the gun", after: "." });
    expect(q.options.find((o) => o.correct)!.text).toBe("jump the gun");
    expect(q.options.some((o) => o.text.startsWith("Nothing lasts"))).toBe(false);
  });
  it("builds a contextual question with in-scene meanings as options", () => {
    const q = buildQuestion(cards[1]!, cards, "context", seeded())!;
    expect(q.options.find((o) => o.correct)!.text).toBe("she feels sick");
  });
  it("can't make a complete question for a whole sentence or when the text isn't in the subtitle", () => {
    expect(buildQuestion(cards[4]!, cards, "complete", seeded())).toBeNull();
    expect(buildQuestion({ ...cards[0]!, sourceSentence: "Something else." }, cards, "context", seeded())).toBeNull();
  });
  it("plans a mix of formats and falls back to the meaning question", () => {
    const qs = planQuiz(cards, cards, seeded(2));
    expect(qs).toHaveLength(5);
    expect(new Set(qs.map((q) => q.format)).size).toBe(3);
    expect(qs.every((q) => q.options.filter((o) => o.correct).length === 1)).toBe(true);
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
  it("puts the most-missed mistakes first and ranks cards that need work", () => {
    const miss = (id: string, wrong: number, tries: number, last: "correct" | "incorrect") => ({ id, review: { reviewStage: 0, lastResult: last, incorrectCount: wrong, attemptCount: tries } });
    const set = [miss("once", 1, 2, "incorrect"), miss("often", 4, 5, "incorrect"), miss("fixed", 3, 9, "correct"), miss("clean", 0, 3, "correct")];
    expect(mistakes(set).map((c) => c.id)).toEqual(["often", "once"]);
    expect(needsWork(set).map((c) => c.id)).toEqual(["often", "fixed", "once"]);
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
  const good = { category: "idiom", meaningEn: "To act too early.", contextualMeaningEn: "The speaker thinks they're rushing.", synonyms: ["rush", "jump the gun", "assume too much", "a fourth", "a fifth", "a sixth", "a seventh"], exampleSentences: ["Let's wait for the results.", "Don't rush.", "A third", "A fourth", "A fifth"], usageNote: null };
  it("accepts a good card, caps synonyms at 6 and examples at 4, fills missing optionals with null", () => {
    const c = validateEnglishCard(JSON.stringify(good));
    expect(c.synonyms).toHaveLength(6);
    expect(c.exampleSentences).toHaveLength(4);
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
