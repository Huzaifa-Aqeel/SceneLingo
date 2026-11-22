import { describe, expect, it } from "vitest";
import { blankOut, cardIdFor, effectiveKind, isSentenceCard, normalizeText, selectedFrom, splitSentences, tokenize, wordsOf } from "@/lib/text";
import { isDue, LADDER_DAYS, nextReview } from "@/lib/schedule";
import { buildOptions, buildQuestion, planQuiz, shuffle } from "@/lib/quiz";
import { categoriesPresent, inCategory, parseCategory, practiceUrl } from "@/lib/category";
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

describe("what counts as a sentence", () => {
  const pick = (line: string, whole: boolean, from = 0, to?: number) => { const w = wordsOf(line); return selectedFrom(line, w, { sentenceIndex: 0, from, to: to ?? w.length - 1, whole }); };
  it("treats a short line selected whole as a phrase, not a sentence", () => {
    expect(pick("Help me, help you.", true)?.kind).toBe("phrase");
    expect(pick("Help me, help you.", false)?.kind).toBe("phrase"); // all the words, picked by dragging
    expect(pick("Break a leg!", true)?.kind).toBe("phrase");
    expect(pick("Groggy.", true)?.kind).toBe("word");
  });
  it("still calls a long line selected whole a sentence", () => {
    expect(pick("I think we're getting ahead of ourselves here.", true)?.kind).toBe("sentence");
    expect(pick("I think we're getting ahead of ourselves here.", false)?.kind).toBe("sentence");
    expect(pick("I think we're getting ahead of ourselves here.", false, 3, 6)?.kind).toBe("phrase");
  });
  it("reads older short 'sentence' cards as phrases, so they can be practised", () => {
    expect(effectiveKind("Help me, help you.", "sentence")).toBe("phrase");
    expect(effectiveKind("Groggy", "sentence")).toBe("word");
    expect(effectiveKind("I think we're getting ahead of ourselves here.", "sentence")).toBe("sentence");
    expect(isSentenceCard({ selectedText: "Break a leg!", selectionKind: "sentence" })).toBe(false);
    expect(isSentenceCard({ selectedText: "I think we're getting ahead of ourselves here.", selectionKind: "sentence" })).toBe(true);
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
  it("climbs the ladder one step on Got it and stops at the top", () => {
    let stage = 0;
    const gaps: number[] = [];
    for (let i = 0; i < 7; i++) {
      const n = nextReview(stage, "good", now);
      gaps.push(days(n));
      stage = n.stage;
    }
    expect(gaps).toEqual([3, 7, 14, 30, 60, 60, 60]);
  });
  it("moves down one step on Still learning, so the wait depends on how far the card had climbed", () => {
    expect(LADDER_DAYS).toEqual([1, 3, 7, 14, 30, 60]);
    const waits = [0, 1, 2, 3, 4, 5].map((stage) => days(nextReview(stage, "again", now)));
    expect(waits).toEqual([1, 1, 3, 7, 14, 30]);
    expect(nextReview(3, "again", now).stage).toBe(2);
    expect(nextReview(0, "again", now).stage).toBe(0);
  });
  it("never makes a missed card due today", () => {
    expect(isDue(nextReview(0, "again", now).dueAt, now)).toBe(false);
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
  const mk = (id: string, text: string, sentence: string, meaning: string, ctx: string, kind = "phrase", category = "idiom") =>
    ({ id, category, selectedText: text, selectionKind: kind, sourceSentence: sentence, meaningEn: meaning, contextualMeaningEn: ctx });
  const cards = [
    mk("a", "jump the gun", "You always jump the gun.", "to act too early", "he is rushing"),
    mk("b", "under the weather", "I'm under the weather today.", "slightly ill", "she feels sick"),
    mk("c", "break a leg", "Break a leg tonight!", "good luck", "he wishes her luck"),
    mk("d", "piece of cake", "That was a piece of cake.", "very easy", "the test was easy"),
    mk("s", "Nothing lasts forever and nobody ever really knows why.", "Nothing lasts forever and nobody ever really knows why.", "things end", "she is sad", "sentence"),
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

describe("practising one category", () => {
  const c = (id: string, category: string) => ({ id, category });
  const list = [c("a", "idiom"), c("b", "slang"), c("c", "idiom"), c("d", "vocabulary")];
  it("reads the category from the address and ignores anything else", () => {
    expect(parseCategory("idiom")).toBe("idiom");
    expect(parseCategory("nonsense")).toBe("all");
    expect(parseCategory(null)).toBe("all");
  });
  it("filters cards by category, and All keeps everything", () => {
    expect(inCategory(list, "idiom").map((x) => x.id)).toEqual(["a", "c"]);
    expect(inCategory(list, "all")).toHaveLength(4);
    expect(inCategory(list, "expression")).toEqual([]);
  });
  it("lists only the categories the learner has, in the usual order", () => {
    expect(categoriesPresent(list)).toEqual(["vocabulary", "idiom", "slang"]);
    expect(categoriesPresent([c("x", "idiom")])).toEqual(["idiom"]);
  });
  it("builds addresses with only the parts that are set", () => {
    expect(practiceUrl("/practice/quiz")).toBe("/practice/quiz");
    expect(practiceUrl("/practice/quiz", { cat: "all" })).toBe("/practice/quiz");
    expect(practiceUrl("/practice/flashcards", { cat: "slang", set: "all", dir: "reverse" })).toBe("/practice/flashcards?set=all&dir=reverse&cat=slang");
  });
  it("prefers wrong options from the same category, then fills up from the others", () => {
    const o = buildOptions("right", ["other1", "other2", "other3", "same1", "same2"], seeded(7), 4, ["same1", "same2"])!;
    const wrong = o.filter((x) => !x.correct).map((x) => x.text);
    expect(wrong).toContain("same1");
    expect(wrong).toContain("same2");
    expect(wrong).toHaveLength(3);
    const few = buildOptions("right", ["other1", "other2", "other3"], seeded(7), 4, ["same1"])!;
    expect(few.filter((x) => !x.correct).map((x) => x.text)).toContain("same1");
  });
  it("quiz questions take their wrong options from the same category first", () => {
    const mk = (id: string, category: string, meaning: string) => ({ id, category, selectedText: id, selectionKind: "phrase", sourceSentence: `a ${id} b`, meaningEn: meaning, contextualMeaningEn: meaning });
    const cards = [mk("i1", "idiom", "idiom one"), mk("i2", "idiom", "idiom two"), mk("i3", "idiom", "idiom three"), mk("s1", "slang", "slang one"), mk("s2", "slang", "slang two")];
    for (let seed = 1; seed < 8; seed++) {
      const q = buildQuestion(cards[0]!, cards, "meaning", seeded(seed))!;
      const wrong = q.options.filter((o) => !o.correct).map((o) => o.text);
      expect(wrong).toContain("idiom two");
      expect(wrong).toContain("idiom three");
    }
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
  const ids = (l: { id: string }[]) => l.map((c) => c.id).sort();
  it("counts due cards and a due session holds exactly those", () => {
    expect(dueCount(cards, now)).toBe(3);
    expect(ids(buildSession(cards, "due", now, 20, seeded(4)))).toEqual(["new", "overdue-new", "overdue-old"]);
  });
  it("study-all puts due cards first, then the rest", () => {
    const all = buildSession(cards, "all", now, 20, seeded(4));
    expect(ids(all.slice(0, 3))).toEqual(["new", "overdue-new", "overdue-old"]);
    expect(all[3]!.id).toBe("future");
  });
  it("mistakes are the cards last answered wrong", () => {
    expect(mistakes(cards).map((c) => c.id)).toEqual(["overdue-new"]);
    expect(buildSession(cards, "mistakes", now).map((c) => c.id)).toEqual(["overdue-new"]);
  });
  it("puts the most-missed mistakes first", () => {
    const miss = (id: string, wrong: number, tries: number, last: "correct" | "incorrect") => ({ id, review: { reviewStage: 0, lastResult: last, incorrectCount: wrong, attemptCount: tries } });
    const set = [miss("once", 1, 2, "incorrect"), miss("often", 4, 5, "incorrect"), miss("fixed", 3, 9, "correct"), miss("clean", 0, 3, "correct")];
    expect(mistakes(set).map((c) => c.id)).toEqual(["often", "once"]);
  });
  it("respects the session size", () => {
    expect(buildSession(cards, "all", now, 2)).toHaveLength(2);
  });
  describe("mixing overdue and new cards (65 / 35)", () => {
    const overdue = (n: number) => Array.from({ length: n }, (_, i) => card(`o${String(i).padStart(2, "0")}`, 1, new Date(now.getTime() - (n - i) * 86_400_000).toISOString())); // o00 is the most overdue
    const fresh = (n: number) => Array.from({ length: n }, (_, i) => card(`n${i}`, 0, null));
    const split = (l: { id: string }[]) => ({ overdue: l.filter((c) => c.id.startsWith("o")).length, fresh: l.filter((c) => c.id.startsWith("n")).length });
    it("takes 13 overdue and 7 new when there are plenty of both, the most overdue first", () => {
      const s = buildSession([...fresh(60), ...overdue(40)], "due", now, 20, seeded(2));
      expect(s).toHaveLength(20);
      expect(split(s)).toEqual({ overdue: 13, fresh: 7 });
      expect(ids(s).filter((i) => i.startsWith("o"))).toEqual(Array.from({ length: 13 }, (_, i) => `o${String(i).padStart(2, "0")}`));
    });
    it("hands spare slots to new cards when there are few overdue ones", () => {
      expect(split(buildSession([...fresh(40), ...overdue(3)], "due", now, 20, seeded(2)))).toEqual({ overdue: 3, fresh: 17 });
    });
    it("hands spare slots to overdue cards when there are few new ones", () => {
      expect(split(buildSession([...fresh(2), ...overdue(30)], "due", now, 20, seeded(2)))).toEqual({ overdue: 18, fresh: 2 });
    });
    it("is not filled up when little is due, and shuffles old and new together", () => {
      expect(buildSession([...fresh(2), ...overdue(3)], "due", now, 20, seeded(2))).toHaveLength(5);
      const s = buildSession([...fresh(60), ...overdue(40)], "due", now, 20, seeded(5)).map((c) => c.id[0]);
      expect(s.join("")).not.toBe([...s].sort().join("")); // not all the old ones first, then the new
    });
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
