import { describe, expect, it } from "vitest";
import { hasPromptApi, probeLanguage, probeLanguages, routeFor, whereItRuns, type LanguageModelLike } from "@/ai/support";
import { buildModelConfig, buildPrompt, validateTranslation } from "@/ai/translate";
import { LANGUAGES, directionOf, findLanguage, suggestLanguage, translationKey } from "@/languages";
import { needsAttentionSchema, parseCapture, pingSchema } from "@/lib/schemas";

// A fake Chrome Prompt API: supports exactly the output languages given, rejects the rest.
const fakeLM = (supported: string[], state = "available"): LanguageModelLike => ({
  availability: async ({ expectedOutputs }) => {
    const lang = expectedOutputs[0]!.languages[0]!;
    if (!supported.includes(lang)) throw new DOMException("unsupported", "NotSupportedError");
    return state;
  },
});

describe("per-language routing", () => {
  it("sends supported languages on-device and the rest to the cloud", async () => {
    const support = await probeLanguages(fakeLM(["es", "ja"]), ["es", "ja", "ur", "ar"]);
    expect(support).toEqual({ es: "available", ja: "available", ur: "unavailable", ar: "unavailable" });
    expect(routeFor("es", support, true)).toBe("PREFER_ON_DEVICE");
    expect(routeFor("ur", support, true)).toBe("ONLY_IN_CLOUD");
  });

  it("follows the device: a newly supported language switches to on-device with no code change", async () => {
    const before = await probeLanguages(fakeLM(["es"]), ["ur"]);
    const after = await probeLanguages(fakeLM(["es", "ur"]), ["ur"]);
    expect(routeFor("ur", before, true)).toBe("ONLY_IN_CLOUD");
    expect(routeFor("ur", after, true)).toBe("PREFER_ON_DEVICE");
  });

  it("treats downloadable and downloading as on-device capable", () => {
    for (const state of ["downloadable", "downloading"] as const) {
      expect(routeFor("es", { es: state }, true)).toBe("PREFER_ON_DEVICE");
    }
  });

  it("never goes on-device without a probe result or without the Prompt API", () => {
    expect(routeFor("es", {}, true)).toBe("ONLY_IN_CLOUD");
    expect(routeFor("es", null, true)).toBe("ONLY_IN_CLOUD");
    expect(routeFor("es", { es: "available" }, false)).toBe("ONLY_IN_CLOUD");
    expect(routeFor("es", { es: "unavailable" }, true)).toBe("ONLY_IN_CLOUD");
  });

  it("needs no translation for English", () => {
    expect(routeFor("en", { en: "available" }, true)).toBe("NONE");
    expect(routeFor("en-GB", {}, true)).toBe("NONE");
    expect(routeFor("", {}, true)).toBe("NONE");
    expect(routeFor(undefined, {}, true)).toBe("NONE");
  });

  it("probe never throws; any error or odd answer means cloud", async () => {
    expect(await probeLanguage({ availability: async () => { throw new Error("boom"); } }, "es")).toBe("unavailable");
    expect(await probeLanguage({ availability: async () => "something-new" }, "es")).toBe("unavailable");
  });

  it("probe asks for English input and the candidate output language", async () => {
    let seen: unknown;
    await probeLanguage({ availability: async (o) => ((seen = o), "available") }, "ja");
    expect(seen).toEqual({ expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["ja"] }] });
  });

  it("detects the Prompt API and labels in plain words", () => {
    expect(hasPromptApi({})).toBe(false);
    expect(hasPromptApi({ LanguageModel: { availability() {} } })).toBe(true);
    expect(whereItRuns("PREFER_ON_DEVICE")).toBe("On this device");
    expect(whereItRuns("ONLY_IN_CLOUD")).toBe("In the cloud");
  });
});

describe("model configuration", () => {
  it("on-device route sets the language and keeps a cloud fallback", () => {
    const c = buildModelConfig({ route: "PREFER_ON_DEVICE", languageCode: "es" });
    expect(c.mode).toBe("prefer_on_device");
    if (!("onDeviceParams" in c) || !c.onDeviceParams) throw new Error("on-device params missing");
    expect(c.onDeviceParams.createOptions.expectedOutputs).toEqual([{ type: "text", languages: ["es"] }]);
    expect(c.onDeviceParams.promptOptions.responseConstraint).toBeTruthy();
    expect(c.inCloudParams.generationConfig.responseMimeType).toBe("application/json");
  });

  it("cloud-only route never configures the on-device model", () => {
    const c = buildModelConfig({ route: "ONLY_IN_CLOUD", languageCode: "ur" });
    expect(c.mode).toBe("only_in_cloud");
    expect("onDeviceParams" in c).toBe(false);
  });

  it("uses the verified cloud model by default, and rejects the NONE route", () => {
    expect(buildModelConfig({ route: "ONLY_IN_CLOUD", languageCode: "ur" }).inCloudParams.model).toBe("gemini-3.5-flash-lite");
    expect(() => buildModelConfig({ route: "NONE", languageCode: "en" })).toThrow();
  });

  it("builds a prompt that names the language and keeps the sentence separate", () => {
    const p = buildPrompt({
      languageCode: "ur",
      card: { selectedText: "getting ahead of ourselves", selectionKind: "phrase", category: "idiom", sourceSentence: "I think we're getting ahead of ourselves.", contextualMeaningEn: "assuming too early" },
    });
    expect(p).toMatch(/Urdu \(ur\)/);
    expect(p).toMatch(/Full subtitle sentence: "I think we're getting ahead of ourselves\."/);
    expect(p).toMatch(/idioms and slang/);
  });
});

describe("AI output validation (Zod)", () => {
  it("accepts good output, trims, and nulls the optional fields", () => {
    expect(validateTranslation(JSON.stringify({ translation: "  hola  " }))).toEqual({ translation: "hola", explanation: null, literalMeaningNote: null });
  });
  it("rejects empty or malformed output so it is never saved", () => {
    expect(() => validateTranslation("not json")).toThrow();
    expect(() => validateTranslation(JSON.stringify({ translation: "   " }))).toThrow();
    expect(() => validateTranslation(JSON.stringify({ explanation: "x" }))).toThrow();
    expect(() => validateTranslation(null)).toThrow();
    expect(() => validateTranslation({ translation: 42 })).toThrow();
  });
  it("length-limits what it stores", () => {
    const v = validateTranslation({ translation: "a".repeat(5000), explanation: "b".repeat(5000) });
    expect(v.translation).toHaveLength(600);
    expect(v.explanation).toHaveLength(1200);
  });
});

describe("boundary validation (Zod)", () => {
  it("parses a good capture and drops malformed ones instead of rendering them", () => {
    const good = parseCapture("c1", { text: "hello", platform: "youtube", videoTitle: "T", playbackTimeSeconds: 12 });
    expect(good).toMatchObject({ id: "c1", text: "hello", status: "new" });
    expect(parseCapture("c2", { text: "", platform: "youtube" })).toBeNull();
    expect(parseCapture("c3", { text: "x", platform: "vimeo" })).toBeNull();
    expect(parseCapture("c4", null)).toBeNull();
  });
  it("validates replies from the extension", () => {
    expect(pingSchema.safeParse({ ok: true, protocol: 1, signedInUid: null, authState: "ok" }).success).toBe(true);
    expect(pingSchema.safeParse({ ok: false, error: "x" }).success).toBe(false);
    expect(needsAttentionSchema.safeParse({ ok: true, own: [], other: [{ accountHint: "a***@x.com", lines: [{ id: "1", text: "t" }] }] }).success).toBe(true);
    expect(needsAttentionSchema.safeParse({ ok: true, own: "nope", other: [] }).success).toBe(false);
  });
});

describe("language catalog", () => {
  it("has unique codes, right directions, and path-safe keys", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of ["ar", "ur", "fa", "he"]) expect(directionOf(c)).toBe("rtl");
    expect(directionOf("es")).toBe("ltr");
    expect(directionOf("unknown")).toBe("ltr");
    expect(translationKey("pt-BR")).toBe("pt_BR");
    expect(findLanguage("ur") && findLanguage("es") && findLanguage("en")).toBeTruthy();
  });
  it("suggests a language from the browser's list", () => {
    expect(suggestLanguage(["ur-PK", "en-US"])).toBe("ur");
    expect(suggestLanguage(["pt-BR"])).toBe("pt-BR");
    expect(suggestLanguage(["xx-YY"])).toBeNull();
    expect(suggestLanguage(["en-US", "ur-PK"])).toBe("ur"); // English listed first must not hide the learner's own language
    expect(suggestLanguage(["en-US", "en"])).toBeNull();   // nothing to suggest for an English-only browser
  });
});
