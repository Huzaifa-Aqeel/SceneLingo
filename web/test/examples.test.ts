import { describe, expect, it, vi } from "vitest";
import { usesTerm } from "@/lib/usesTerm";
import { buildExplainPrompt, validateEnglishCard } from "@/ai/englishCard";
import { askHybrid, type Askable } from "@/ai/hybrid";

describe("an example must use the word being taught", () => {
  it("accepts the word and its normal forms", () => {
    expect(usesTerm("I felt groggy after the nap.", "groggy")).toBe(true);
    expect(usesTerm("She looked even groggier today.", "groggy")).toBe(true);
    expect(usesTerm("He stopped at the corner.", "stop")).toBe(true);
    expect(usesTerm("She carries her bag everywhere.", "carry")).toBe(true);
    expect(usesTerm("We were waking up slowly.", "wake")).toBe(true);
    expect(usesTerm("They are running late.", "run")).toBe(true);
  });
  it("rejects a sentence that only uses synonyms", () => {
    expect(usesTerm("My cat looked very drowsy after sleeping in the sun.", "groggy")).toBe(false);
    expect(usesTerm("I drank a cup of coffee because I felt so sleepy.", "groggy")).toBe(false);
  });
  it("does not accept a longer, different word that merely starts the same", () => {
    expect(usesTerm("The runway was closed.", "run")).toBe(false);
  });
  it("lets the pronouns and the verb form of a phrase change", () => {
    expect(usesTerm("If you help us, we help you.", "help me, help you")).toBe(true);
    expect(usesTerm("He tried to break the ice at dinner.", "break the ice")).toBe(true);
    expect(usesTerm("She got ahead of herself again.", "getting ahead of ourselves")).toBe(true); // "got" is irregular, "ahead" still matches
    expect(usesTerm("Please cooperate with me so we finish early.", "help me, help you")).toBe(false);
  });
  it("asks nothing of a whole-sentence selection, or of a term with no checkable words", () => {
    expect(usesTerm("Something unrelated.", "Don't count your chickens.", "sentence")).toBe(true);
    expect(usesTerm("Anything.", "you and I")).toBe(true);
  });
});

describe("validating a card against what was selected", () => {
  const card = (over: object = {}) => JSON.stringify({
    category: "vocabulary", meaningEn: "Feeling weak and sleepy.", contextualMeaningEn: "Tired and unable to think clearly.", partOfSpeech: "adjective",
    synonyms: ["drowsy", "sleepy", "groggy", "make it easier for me to wake up properly now", "Drowsy"],
    exampleSentences: ["I felt groggy after the nap.", "My cat looked drowsy in the sun.", "He was groggier than usual."], usageNote: null, confidenceNote: null, ...over,
  });
  const input = { selectedText: "groggy", selectionKind: "word" as const };

  it("keeps only the examples that use the word, and cleans the synonyms", () => {
    const c = validateEnglishCard(card(), input);
    expect(c.exampleSentences).toEqual(["I felt groggy after the nap.", "He was groggier than usual."]);
    expect(c.synonyms).toEqual(["drowsy", "sleepy"]); // not the word itself, no long paraphrase, no repeat
  });
  it("is strict when fewer than two examples use the word, so the caller can ask again", () => {
    const bad = card({ exampleSentences: ["My cat looked drowsy.", "I felt sleepy.", "I felt groggy once."] });
    expect(() => validateEnglishCard(bad, input)).toThrow("examples_miss_the_term");
  });
  it("in lenient mode keeps the good examples, or all of them if none is good, so a card is never lost", () => {
    const one = card({ exampleSentences: ["My cat looked drowsy.", "I felt sleepy.", "I felt groggy once."] });
    expect(validateEnglishCard(one, input, { lenient: true }).exampleSentences).toEqual(["I felt groggy once."]);
    const none = card({ exampleSentences: ["My cat looked drowsy.", "I felt sleepy."] });
    expect(validateEnglishCard(none, input, { lenient: true }).exampleSentences).toHaveLength(2);
  });
  it("leaves examples alone for a whole sentence, and when no selection is given", () => {
    expect(validateEnglishCard(card(), { selectedText: "Whole line.", selectionKind: "sentence" }).exampleSentences).toHaveLength(3);
    expect(validateEnglishCard(card()).exampleSentences).toHaveLength(3);
  });
  it("accepts a card with no synonyms at all", () => {
    expect(validateEnglishCard(card({ synonyms: [] }), input).synonyms).toEqual([]);
  });
  it("asks for true synonyms and examples that use the word", () => {
    const p = buildExplainPrompt({ selectedText: "groggy", selectionKind: "word", sourceSentence: "I'm so groggy." });
    expect(p).toMatch(/replace the selected text/);
    expect(p).toMatch(/fewer, even none/);
    expect(p).toMatch(/use the selected text itself/);
  });
});

describe("asking again when the examples miss the word", () => {
  const reply = (text: string): Askable => ({ generateContent: async () => ({ response: { text: () => text, inferenceSource: "in_cloud" } }) });
  const parse = (t: string) => { if (t === "bad") throw new Error("invalid"); return t; };

  it("asks the cloud once more, with the corrected prompt", async () => {
    const second = { generateContent: vi.fn(async () => ({ response: { text: () => "good", inferenceSource: "in_cloud" } })) };
    const r = await askHybrid({ hybrid: reply("bad"), cloud: () => second, prompt: "first", retryPrompt: "first + note", parse });
    expect(r).toEqual({ value: "good", source: "IN_CLOUD" });
    expect(second.generateContent).toHaveBeenCalledWith("first + note");
  });
  it("keeps the lenient reading of the second answer when it is still imperfect", async () => {
    const r = await askHybrid({ hybrid: reply("bad"), cloud: () => reply("bad"), prompt: "p", parse, lenient: () => "kept" });
    expect(r).toEqual({ value: "kept", source: "IN_CLOUD" });
  });
  it("still gives up when even the lenient reading fails", async () => {
    await expect(askHybrid({ hybrid: reply("bad"), cloud: () => reply("bad"), prompt: "p", parse, lenient: () => { throw new Error("no"); } })).rejects.toThrow("invalid");
  });
  it("does not make a third request after a local failure already went to the cloud", async () => {
    const cloud = { generateContent: vi.fn(async () => ({ response: { text: () => "bad", inferenceSource: "in_cloud" } })) };
    const local: Askable = { generateContent: async () => { throw new TypeError("local model crashed"); } };
    await expect(askHybrid({ hybrid: local, cloud: () => cloud, prompt: "p", parse })).rejects.toThrow("invalid");
    expect(cloud.generateContent).toHaveBeenCalledTimes(1);
  });
});
