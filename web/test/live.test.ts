// Calls the REAL cloud model with the real prompt and schema. Skipped unless LIVE=1.
//   LIVE=1 npx vitest run test/live.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildExplainConfig, buildExplainPrompt, englishCardSchema, validateEnglishCard, type ExplainInput } from "@/ai/englishCard";
import { buildPrompt as buildTranslatePrompt, translationSchema, validateTranslation } from "@/ai/translate";

const env = Object.fromEntries(
  ["../../.env.local", "../../.env.development.local"].flatMap((f) => {
    const p = path.resolve(import.meta.dirname, f);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]) : [];
  })
) as Record<string, string>;

const asJson = (schema: unknown) => (schema as { toJSON(): unknown }).toJSON();
const live = process.env.LIVE === "1";
const MODEL = buildExplainConfig().inCloudParams.model;

async function appCheckToken() {
  const r = await fetch(`https://firebaseappcheck.googleapis.com/v1/projects/${env.VITE_FIREBASE_PROJECT_ID}/apps/${env.VITE_FIREBASE_APP_ID}:exchangeDebugToken?key=${env.VITE_FIREBASE_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ debug_token: env.VITE_APPCHECK_DEBUG_TOKEN }),
  });
  return ((await r.json()) as { token: string }).token;
}
async function generate(prompt: string, schema: unknown, token: string) {
  const r = await fetch(`https://firebasevertexai.googleapis.com/v1beta/projects/${env.VITE_FIREBASE_PROJECT_ID}/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.VITE_FIREBASE_API_KEY!, "X-Firebase-AppCheck": token },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema } }),
  });
  const j = (await r.json()) as { candidates?: { content: { parts: { text: string }[] } }[]; error?: { message: string } };
  if (!j.candidates) throw new Error(`HTTP ${r.status}: ${j.error?.message}`);
  return j.candidates[0]!.content.parts[0]!.text;
}

const samples: { name: string; input: ExplainInput; expectCategory?: string[] }[] = [
  { name: "idiom", input: { selectedText: "getting ahead of ourselves", selectionKind: "phrase", sourceSentence: "I think we're getting ahead of ourselves." }, expectCategory: ["idiom", "expression"] },
  { name: "single word", input: { selectedText: "reluctant", selectionKind: "word", sourceSentence: "She was reluctant to say anything about it." }, expectCategory: ["vocabulary"] },
  { name: "slang", input: { selectedText: "no cap", selectionKind: "phrase", sourceSentence: "That was the best pizza I've ever had, no cap." }, expectCategory: ["slang", "expression"] },
  { name: "whole sentence", input: { selectedText: "Don't count your chickens before they hatch.", selectionKind: "sentence", sourceSentence: "Don't count your chickens before they hatch." } },
];

describe.skipIf(!live)("live cloud model", () => {
  for (const s of samples) {
    it(`English card for ${s.name} is valid`, async () => {
      const token = await appCheckToken();
      const raw = await generate(buildExplainPrompt(s.input), asJson(englishCardSchema()), token);
      const card = validateEnglishCard(raw);
      console.log(`  ${s.name}: [${card.category}] ${card.meaningEn} | ex: ${card.exampleSentences[0]}`);
      if (s.expectCategory) expect(s.expectCategory).toContain(card.category);
      expect(card.exampleSentences.every((e) => e.toLowerCase() !== s.input.sourceSentence.toLowerCase())).toBe(true);
    }, 60_000);
  }
  it("translation (Urdu, cloud) is valid and in Urdu script", async () => {
    const token = await appCheckToken();
    const raw = await generate(buildTranslatePrompt({ languageCode: "ur", card: { selectedText: "getting ahead of ourselves", selectionKind: "phrase", category: "idiom", sourceSentence: "I think we're getting ahead of ourselves.", contextualMeaningEn: "assuming something too early" } }), asJson(translationSchema()), token);
    const t = validateTranslation(raw);
    console.log(`  ur: ${t.translation}`);
    expect(/[\u0600-\u06FF]/.test(t.translation)).toBe(true);
  }, 60_000);
});
