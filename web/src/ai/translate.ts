// Translation + explanation in the learner's language (FR-AI-006 / FR-AI-007).
// Same contract for every language; only the routing differs.
import { getGenerativeModel, InferenceMode, Schema } from "firebase/ai";
import type { FirebaseApp } from "firebase/app";
import { findLanguage } from "@/languages";
import { translationOutputSchema, type TranslationContent } from "@/lib/schemas";
import type { Route } from "./support";
import { CLOUD_MODEL, getAi, getCloudModel } from "./client";
import { askHybrid } from "./hybrid";

export const TRANSLATION_PROMPT_VERSION = "1.0";
export interface CardContext {
  selectedText: string;
  selectionKind?: string;
  category?: string;
  sourceSentence: string;
  contextualMeaningEn?: string;
  meaningEn?: string;
}

export const translationSchema = () =>
  Schema.object({
    properties: {
      translation: Schema.string(),
      explanation: Schema.string(),
      literalMeaningNote: Schema.string(),
    },
    optionalProperties: ["explanation", "literalMeaningNote"],
  });

export function buildPrompt({ card, languageCode }: { card: CardContext; languageCode: string }): string {
  const lang = findLanguage(languageCode);
  const target = lang ? `${lang.name} (${lang.code})` : languageCode;
  return [
    `You help a non-native English speaker learn English from the subtitles of videos they watch.`,
    `Write in ${target}, using that language's standard script. Return only the requested fields.`,
    ``,
    `Selected ${card.selectionKind || "text"}: "${card.selectedText}"`,
    `Category: ${card.category || "unknown"}`,
    `Full subtitle sentence: "${card.sourceSentence}"`,
    `English meaning in this context: ${card.contextualMeaningEn || card.meaningEn || "(not provided)"}`,
    ``,
    `- "translation": a natural translation of the selected text that fits THIS context, not a word-for-word one.`,
    `- "explanation": one or two short sentences in ${target} explaining the meaning. Needed especially for idioms and slang.`,
    `- "literalMeaningNote": only if a literal reading helps; otherwise omit it.`,
    `For idioms and slang, give the natural equivalent in ${target} or explain that none exists. Never present a misleading literal translation as the meaning.`,
    `Use only the text above as evidence. Do not invent plot details.`,
  ].join("\n");
}

// Builds the getGenerativeModel() options for a route. Pure, so it can be unit-tested.
export function buildModelConfig({ route, languageCode, cloudModel = CLOUD_MODEL }: { route: Route; languageCode: string; cloudModel?: string }) {
  const schema = translationSchema();
  const inCloudParams = {
    model: cloudModel,
    generationConfig: { responseMimeType: "application/json", responseSchema: schema },
  };
  if (route === "PREFER_ON_DEVICE") {
    return {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams, // fallback when the local model is unavailable or fails
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text" as const, languages: ["en"] }],
          expectedOutputs: [{ type: "text" as const, languages: [languageCode] }],
        },
        promptOptions: { responseConstraint: schema },
      },
    };
  }
  if (route === "ONLY_IN_CLOUD") {
    // The on-device model is never configured, so it is never asked for an unsupported language.
    return { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams };
  }
  throw new Error(`No translation is needed for route "${route}"`);
}

// Returns clean content or throws; invalid output is never saved.
export function validateTranslation(raw: unknown): TranslationContent {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { throw new Error("The translation came back in an unexpected format."); }
  }
  const r = translationOutputSchema.safeParse(obj);
  if (!r.success) throw new Error(r.error.issues[0]?.message || "The translation was not valid.");
  return r.data;
}

export interface TranslationResult extends TranslationContent {
  languageCode: string;
  inferenceSource: "ON_DEVICE" | "IN_CLOUD";
  promptVersion: string;
}

// Runs one translation, only when the learner asks for it. `inferenceSource` is what actually answered
// (the SDK's report, or the cloud when the device failed), never what we expected.
export async function translateCard({ app, card, languageCode, route }: { app: FirebaseApp; card: CardContext; languageCode: string; route: Route }): Promise<TranslationResult> {
  const config = buildModelConfig({ route, languageCode, cloudModel: getCloudModel() });
  const ai = getAi(app);
  const { value, source } = await askHybrid({
    hybrid: getGenerativeModel(ai, config),
    cloud: () => getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: config.inCloudParams }),
    prompt: buildPrompt({ card, languageCode }),
    parse: validateTranslation,
  });
  return { ...value, languageCode, inferenceSource: source, promptVersion: TRANSLATION_PROMPT_VERSION };
}
