import { afterEach, describe, expect, it, vi } from "vitest";
import { AIError, AIErrorCode } from "firebase/ai";
import { streamHybrid, type StreamAskable } from "@/ai/hybrid";
import { buildReplyPrompt, buildScenePrompt, validateScene, validateVerdict, type Scene, type TalkCard } from "@/ai/conversation";
import { pickSeeds, SEEDS } from "@/lib/scenarios";
import { createSpeaker, listenOnce, pickVoice, speak, takeSentences } from "@/lib/speech";
import { learnerLines, marked, outcomeOf, ratingOf, type Line } from "@/lib/talk";
import { termRanges } from "@/lib/usesTerm";

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const card: TalkCard = { selectedText: "smooth things over", selectionKind: "phrase", category: "idiom", meaningEn: "to fix a disagreement and make people calm again", contextualMeaningEn: "", sourceSentence: "I tried to smooth things over after the fight.", videoTitle: "Some show" };
const scene: Scene = { situation: "You are at the office. Your coworker looks upset.", partnerName: "Maya", partnerRole: "your coworker", openingLine: "Hey, do you have a minute?", seedKey: "coffee-machine", setting: "x" };

describe("scenarios", () => {
  it("offers three different settings, skipping the ones used lately", () => {
    const recent = SEEDS.slice(0, SEEDS.length - 5).map((x) => x.key);
    for (let i = 1; i < 20; i++) {
      const picks = pickSeeds("idiom", recent, 3, seeded(i));
      expect(picks).toHaveLength(3);
      expect(new Set(picks.map((x) => x.key)).size).toBe(3);
      for (const p of picks) expect(recent).not.toContain(p.key);
    }
  });
  it("puts slang among friends, never in a formal setting", () => {
    for (let i = 1; i < 40; i++) for (const p of pickSeeds("slang", [], 3, seeded(i))) expect(p.tone).toBe("casual");
  });
  it("still offers settings when nearly all were used recently", () => {
    expect(pickSeeds("idiom", SEEDS.map((x) => x.key), 3, seeded(3))).toHaveLength(3);
  });
  it("has plenty of different real-world settings", () => {
    expect(new Set(SEEDS.map((x) => x.key)).size).toBe(SEEDS.length);
    expect(SEEDS.length).toBeGreaterThanOrEqual(25);
  });
});

describe("the scene", () => {
  const seeds = [SEEDS[0]!, SEEDS[7]!, SEEDS[16]!];
  const raw = (over: object = {}) => JSON.stringify({ settingNumber: 2, situation: "You are at a restaurant. Your order came out wrong.", partnerName: "Sam", partnerRole: "the waiter", openingLine: "I'm so sorry, the dish was wrong. How would you like to handle this?", ...over });
  it("offers the settings, asks for a different scene from the card's, and never names the expression", () => {
    const p = buildScenePrompt(card, seeds);
    for (const s of seeds) expect(p).toContain(s.setting);
    expect(p).toMatch(/pick the ONE where/);
    expect(p).toContain("I tried to smooth things over after the fight.");
    expect(p).toMatch(/Do not reuse that scene/);
    expect(p).toMatch(/Never put the expression/);
  });
  it("uses the setting the model chose, or the first if the number makes no sense", () => {
    expect(validateScene(raw(), card, seeds).seedKey).toBe(seeds[1]!.key);
    expect(validateScene(raw({ settingNumber: 9 }), card, seeds).seedKey).toBe(seeds[0]!.key);
  });
  it("rejects a scene that hands the answer over, unless lenient", () => {
    const bad = raw({ openingLine: "Can you help me smooth things over with my boss?" });
    expect(() => validateScene(bad, card, seeds)).toThrow("scene_gives_the_answer_away");
    expect(validateScene(bad, card, seeds, { lenient: true }).openingLine).toContain("smooth things over");
  });
  it("rejects an unusable answer", () => {
    expect(() => validateScene("nope", card, seeds)).toThrow();
    expect(() => validateScene(raw({ openingLine: "" }), card, seeds)).toThrow();
  });
});

describe("the partner", () => {
  const lines: Line[] = [{ who: "partner", text: "Hey, do you have a minute?" }, { who: "learner", text: "Sure, what's up?" }];
  it("speaks briefly, stays in role, and does not teach", () => {
    const p = buildReplyPrompt(scene, card, lines, false);
    expect(p).toMatch(/one or two short/);
    expect(p).toMatch(/Never mention being an AI/);
    expect(p).toContain("Maya: Hey, do you have a minute?");
    expect(p).toContain("Learner: Sure, what's up?");
    expect(p).toMatch(/Never use the words "smooth things over" yourself/);
  });
  it("closes the conversation on the last turn", () => {
    expect(buildReplyPrompt(scene, card, lines, true)).toMatch(/last thing you say/);
    expect(buildReplyPrompt(scene, card, lines, false)).not.toMatch(/last thing you say/);
  });
});

describe("the verdict", () => {
  const lines: Line[] = [{ who: "learner", text: "I want to patch things up with her." }];
  const raw = (over: object = {}) => JSON.stringify({ understoodSituation: "yes", similarExpression: "patch things up", fit: "natural", feedback: "Good, natural reply.", betterVersion: "I'll try to smooth things over.", ...over });
  it("keeps a similar expression only if the learner really said it", () => {
    expect(validateVerdict(raw(), lines).similarExpression).toBe("patch things up");
    expect(validateVerdict(raw({ similarExpression: "make amends" }), lines).similarExpression).toBeNull();
    expect(validateVerdict(raw({ similarExpression: undefined }), lines).similarExpression).toBeNull();
  });
  it("rejects an unusable verdict", () => {
    expect(() => validateVerdict(raw({ fit: "great" }), lines)).toThrow();
    expect(() => validateVerdict("nope", lines)).toThrow();
  });
});

describe("the outcome is decided by what was said", () => {
  const said = (t: string): Line[] => [{ who: "partner", text: "Hi" }, { who: "learner", text: t }];
  it("counts the words used, in a normal form, as used", () => {
    expect(outcomeOf(said("I will smooth things over tomorrow"), "smooth things over", "phrase", null)).toBe("used");
    expect(outcomeOf(said("She smoothed things over quickly"), "smooth things over", "phrase", null)).toBe("used");
  });
  it("counts a similar expression, but only if the model named one", () => {
    expect(outcomeOf(said("I want to patch things up"), "smooth things over", "phrase", "patch things up")).toBe("similar");
    expect(outcomeOf(said("I want to patch things up"), "smooth things over", "phrase", null)).toBe("missed");
  });
  it("does not trust the model that the words were used when they were not", () => {
    expect(outcomeOf(said("Nothing really"), "smooth things over", "phrase", "smooth things over")).toBe("similar"); // only a similar one, never "used"
  });
  it("rates used and similar as good, and missed as again", () => {
    expect([ratingOf("used"), ratingOf("similar"), ratingOf("missed")]).toEqual(["good", "good", "again"]);
  });
  it("lists only the learner's lines, and marks the words used", () => {
    expect(learnerLines(said("Hello"))).toEqual(["Hello"]);
    const parts = marked("I will smooth things over now", "smooth things over");
    expect(parts.filter((p) => p.on).map((p) => p.text).join(" ")).toBe("smooth things over");
    expect(parts.map((p) => p.text).join("")).toBe("I will smooth things over now");
    expect(termRanges("nothing here", "groggy")).toEqual([]);
    expect(termRanges("I wanted to break the ice, so I came", "break the ice").map(([x, y]) => "I wanted to break the ice, so I came".slice(x, y))).toEqual(["break the ice"]);
    expect(termRanges("She was groggy and then groggier", "groggy").length).toBe(2);
  });
});

describe("speaking in sentences", () => {
  it("splits streamed text into whole sentences and keeps the growing end", () => {
    expect(takeSentences("Hi there. How are you")).toEqual({ sentences: ["Hi there."], rest: "How are you" });
    expect(takeSentences("Really? Yes! Okay. Go")).toEqual({ sentences: ["Really?", "Yes!", "Okay."], rest: "Go" });
    expect(takeSentences("No end yet")).toEqual({ sentences: [], rest: "No end yet" });
  });
  it("does not split after Dr. or Mr.", () => {
    expect(takeSentences("Ask Dr. Lee about it. Then call")).toEqual({ sentences: ["Ask Dr. Lee about it."], rest: "Then call" });
  });
  it("prefers a voice that runs on the device", () => {
    const v = [{ name: "online", lang: "en-US", localService: false }, { name: "local", lang: "en-GB", localService: true }, { name: "fr", lang: "fr-FR", localService: true }];
    expect(pickVoice(v)?.name).toBe("local");
    expect(pickVoice([{ name: "fr", lang: "fr-FR", localService: true }])).toBeNull();
    expect(pickVoice([{ name: "online", lang: "en-US", localService: false }])?.name).toBe("online");
  });
});

describe("browser speech, with a stand-in", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSynthesis(log: string[]) {
    class U { text: string; lang = ""; rate = 1; voice = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
    vi.stubGlobal("SpeechSynthesisUtterance", U);
    vi.stubGlobal("speechSynthesis", { getVoices: () => [], cancel: () => log.push("cancel"), speak: (u: U) => { log.push(u.text); setTimeout(() => u.onend?.(), 1); } });
  }

  it("speaks sentences one after another, in order, as they arrive", async () => {
    const log: string[] = [];
    stubSynthesis(log);
    const s = createSpeaker();
    s.push("Hello there. How a");
    s.push("re you today? Fine");
    await s.finish();
    expect(log).toEqual(["Hello there.", "How are you today?", "Fine"]);
  });
  it("does nothing for empty text", async () => {
    const log: string[] = [];
    stubSynthesis(log);
    await speak("   ");
    expect(log).toEqual([]);
  });

  class Rec {
    static last: Rec;
    lang = ""; continuous = true; interimResults = false; maxAlternatives = 0; processLocally?: boolean; phrases?: unknown[];
    onresult: ((e: unknown) => void) | null = null; onerror: ((e: { error: string }) => void) | null = null; onend: (() => void) | null = null;
    started = false;
    constructor() { Rec.last = this; }
    start() { this.started = true; }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
    static available = async () => "available";
  }
  const result = (text: string, isFinal: boolean) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it("listens for one utterance, on the device when the pack is installed, favouring the target phrase", async () => {
    vi.stubGlobal("SpeechRecognition", Rec);
    vi.stubGlobal("SpeechRecognitionPhrase", class { constructor(public phrase: string, public boost: number) {} });
    const interim: string[] = [];
    const l = listenOnce({ phrases: ["smooth things over"], onInterim: (t) => interim.push(t) });
    await tick();
    expect(Rec.last.processLocally).toBe(true);
    expect(Rec.last.continuous).toBe(false);
    expect(Rec.last.phrases).toHaveLength(1);
    Rec.last.onresult?.(result("I will smooth", false));
    Rec.last.onresult?.(result("I will smooth things over", true));
    expect(await l.done).toEqual({ kind: "speech", text: "I will smooth things over" });
    expect(interim[0]).toBe("I will smooth");
  });
  it("reports silence, a denied microphone, and other errors", async () => {
    vi.stubGlobal("SpeechRecognition", Rec);
    for (const [error, kind] of [["no-speech", "silence"], ["not-allowed", "denied"], ["audio-capture", "error"]] as const) {
      const l = listenOnce();
      await tick();
      Rec.last.onerror?.({ error });
      expect((await l.done).kind).toBe(kind);
    }
  });
  it("can be cancelled", async () => {
    vi.stubGlobal("SpeechRecognition", Rec);
    const l = listenOnce();
    await tick();
    l.cancel();
    expect((await l.done).kind).toBe("silence");
  });
});

describe("streaming a reply with a cloud fallback", () => {
  const chunks = (parts: string[], fail = false): StreamAskable => ({
    generateContentStream: async () => ({ stream: (async function* () { for (const p of parts) yield { text: () => p, inferenceSource: "in_cloud" }; if (fail) throw new TypeError("local model crashed"); })() }),
  });
  const failing = (e: unknown): StreamAskable => ({ generateContentStream: async () => { throw e; } });

  it("passes text through as it arrives", async () => {
    const got: string[] = [];
    const r = await streamHybrid({ hybrid: chunks(["Hel", "lo."]), cloud: () => chunks([]), prompt: "p", onText: (t) => got.push(t) });
    expect(got).toEqual(["Hel", "lo."]);
    expect(r.text).toBe("Hello.");
  });
  it("asks the cloud when the device fails before saying anything", async () => {
    const r = await streamHybrid({ hybrid: failing(new TypeError("crash")), cloud: () => chunks(["From the cloud."]), prompt: "p", onText: () => {} });
    expect(r).toEqual({ text: "From the cloud.", source: "IN_CLOUD" });
  });
  it("keeps what was already said when the device fails halfway", async () => {
    const cloud = vi.fn();
    const r = await streamHybrid({ hybrid: chunks(["Half a sentence"], true), cloud, prompt: "p", onText: () => {} });
    expect(r.text).toBe("Half a sentence");
    expect(cloud).not.toHaveBeenCalled();
  });
  it("does not retry a cloud-service error", async () => {
    const cloud = vi.fn();
    await expect(streamHybrid({ hybrid: failing(new AIError(AIErrorCode.FETCH_ERROR, "quota")), cloud, prompt: "p", onText: () => {} })).rejects.toBeInstanceOf(AIError);
    expect(cloud).not.toHaveBeenCalled();
  });
  it("asks the cloud when the device answers with nothing", async () => {
    const r = await streamHybrid({ hybrid: chunks([]), cloud: () => chunks(["Okay."]), prompt: "p", onText: () => {} });
    expect(r.text).toBe("Okay.");
  });
  it("stops when cancelled", async () => {
    let n = 0;
    const r = await streamHybrid({ hybrid: chunks(["a", "b", "c"]), cloud: () => chunks([]), prompt: "p", onText: () => { n++; }, isCancelled: () => n >= 1 });
    expect(r.text).toBe("a");
  });
});
