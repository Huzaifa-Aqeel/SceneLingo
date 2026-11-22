// The English learning card (FR-AI-001..005): one structured request, on-device first, cloud as fallback.
import { getGenerativeModel, InferenceMode, Schema } from "firebase/ai";
import type { FirebaseApp } from "firebase/app";
import { CATEGORIES, englishCardOutputSchema, type EnglishCardContent } from "@/lib/schemas";
import type { SelectionKind } from "@/lib/text";
import { CLOUD_MODEL, getAi, getCloudModel, type Source } from "./client";
import { askHybrid } from "./hybrid";
import { usesTerm } from "@/lib/usesTerm";

export const ENGLISH_PROMPT_VERSION = "1.2";

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
    `- synonyms: only words or expressions that could replace the selected text in this sentence without changing its meaning, most useful first. Give up to 6, but fewer, even none, if fewer truly fit. Never pad the list with loosely related words, and never use a long paraphrase as a synonym.`,
    `- exampleSentences: 3 or 4 natural, original sentences in different everyday situations. Each one must use the selected text itself (in the same or a normal grammatical form, such as -ed, -ing or -s), not a synonym. Do not copy the subtitle.`,
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

// With `input`, the card is also checked against what was selected: synonyms are cleaned, and every example
// must use the selected text. Strict mode needs at least two such examples (so the caller can ask again);
// lenient mode keeps the good ones, or, if there are none, what the model wrote, so a card is never lost.
export function validateEnglishCard(raw: unknown, input?: Pick<ExplainInput, "selectedText" | "selectionKind">, opts: { lenient?: boolean } = {}): EnglishCardContent {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { throw new Error("invalid_format"); }
  }
  const r = englishCardOutputSchema.safeParse(obj);
  if (!r.success) throw new Error("invalid_card");
  if (!input) return r.data;

  const term = input.selectedText.trim().toLowerCase();
  const seen = new Set<string>();
  const synonyms = r.data.synonyms.filter((s) => {
    const k = s.trim().toLowerCase();
    if (!k || k === term || term.includes(k) || k.includes(term) || k.split(/\s+/).length > 5 || seen.has(k)) return false; // itself, a part of itself, a long paraphrase, a repeat
    seen.add(k);
    return true;
  });

  if (input.selectionKind === "sentence") return { ...r.data, synonyms };
  const good = r.data.exampleSentences.filter((e) => usesTerm(e, input.selectedText, input.selectionKind));
  if (!opts.lenient && good.length < Math.min(2, r.data.exampleSentences.length)) throw new Error("examples_miss_the_term");
  return { ...r.data, synonyms, exampleSentences: good.length > 0 ? good : r.data.exampleSentences };
}

const RETRY_NOTE = (term: string) =>
  `\nImportant: every example sentence must contain "${term}" itself (or a normal form of it), not a synonym. List only true synonyms that could replace it here, and fewer is fine.`;

export interface ExplainResult { content: EnglishCardContent; source: Source; promptVersion: string }

// Runs only when the learner presses Explain. Nothing here (and no on-device model) is touched before that.
export async function explain({ app, input }: { app: FirebaseApp; input: ExplainInput }): Promise<ExplainResult> {
  const config = buildExplainConfig(getCloudModel());
  const ai = getAi(app);
  const { value, source } = await askHybrid({
    hybrid: getGenerativeModel(ai, config),
    cloud: () => getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: config.inCloudParams }),
    prompt: buildExplainPrompt(input),
    retryPrompt: buildExplainPrompt(input) + RETRY_NOTE(input.selectedText),
    parse: (text) => validateEnglishCard(text, input),
    lenient: (text) => validateEnglishCard(text, input, { lenient: true }),
  });
  return { content: value, source, promptVersion: ENGLISH_PROMPT_VERSION };
}
