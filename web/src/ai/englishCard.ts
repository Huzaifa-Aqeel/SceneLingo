// The English learning card (FR-AI-001..005): one structured request, on-device first, cloud as fallback.
import { getGenerativeModel, InferenceMode, Schema } from "firebase/ai";
import type { FirebaseApp } from "firebase/app";
import { CATEGORIES, englishCardOutputSchema, type EnglishCardContent } from "@/lib/schemas";
import type { SelectionKind } from "@/lib/text";
import { CLOUD_MODEL, getAi, getCloudModel, sourceOf, type Source } from "./client";

export const ENGLISH_PROMPT_VERSION = "1.0";

export interface ExplainInput {
  selectedText: string;
  selectionKind: SelectionKind;
  sourceSentence: string;
  contextBefore?: string;
  contextAfter?: string;
}

export const englishCardSchema = () =>
  Schema.object({
    properties: {
      category: Schema.enumString({ enum: [...CATEGORIES] }),
      meaningEn: Schema.string(),
      contextualMeaningEn: Schema.string(),
      partOfSpeech: Schema.string(),
      synonyms: Schema.array({ items: Schema.string() }),
      exampleSentences: Schema.array({ items: Schema.string() }),
      usageNote: Schema.string(),
      confidenceNote: Schema.string(),
    },
    optionalProperties: ["partOfSpeech", "usageNote", "confidenceNote"],
  });

export function buildExplainPrompt(i: ExplainInput): string {
  return [
    `You help a non-native English speaker learn English from the subtitles of videos they watch. Use simple, plain English.`,
    `Explain the selected text as it is used in this subtitle. Do not give unrelated dictionary entries.`,
    ``,
    `Selected ${i.selectionKind}: "${i.selectedText}"`,
    `Full subtitle sentence: "${i.sourceSentence}"`,
    i.contextBefore ? `Previous sentence: "${i.contextBefore}"` : "",
    i.contextAfter ? `Next sentence: "${i.contextAfter}"` : "",
    ``,
    `Fields:`,
    `- category: exactly one of vocabulary, idiom, slang, expression.`,
    `- meaningEn: a short plain-English definition.`,
    `- contextualMeaningEn: what it means in THIS sentence.`,
    `- partOfSpeech: for a single word only; omit otherwise.`,
    `- synonyms: up to 3 that are genuinely close in this context; an empty list is fine.`,
    `- exampleSentences: 1 or 2 natural, original sentences. Do not copy the subtitle.`,
    `- usageNote: optional note on register or formality.`,
    `- confidenceNote: only if the context is too thin to be sure; say the meaning may depend on the scene.`,
    `For an idiom, explain the idiomatic meaning, not the literal words. For a whole sentence, explain what is useful in it.`,
    `Use only the text above as evidence. Do not invent plot details, characters, or facts.`,
  ].filter((l) => l !== "").join("\n");
}

// Builds the options for getGenerativeModel(). Pure, so it can be unit-tested.
export function buildExplainConfig(cloudModel: string = CLOUD_MODEL) {
  const schema = englishCardSchema();
  return {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text" as const, languages: ["en"] }],
        expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
      },
      promptOptions: { responseConstraint: schema },
    },
    inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: "application/json", responseSchema: schema } },
  };
}

export function validateEnglishCard(raw: unknown): EnglishCardContent {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { throw new Error("invalid_format"); }
  }
  const r = englishCardOutputSchema.safeParse(obj);
  if (!r.success) throw new Error("invalid_card");
  return r.data;
}

export interface ExplainResult { content: EnglishCardContent; source: Source; promptVersion: string }

export async function explain({ app, input }: { app: FirebaseApp; input: ExplainInput }): Promise<ExplainResult> {
  const model = getGenerativeModel(getAi(app), buildExplainConfig(getCloudModel()));
  const prompt = buildExplainPrompt(input);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) { // one retry if the answer isn't a valid card
    const result = await model.generateContent(prompt);
    try {
      return { content: validateEnglishCard(result.response.text()), source: sourceOf(result.response.inferenceSource), promptVersion: ENGLISH_PROMPT_VERSION };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
