// Zod schemas for everything that crosses a trust boundary: Firestore documents, replies from
// the extension, and AI output. Anything that fails validation is dropped or rejected, never rendered.
import { z } from "zod";
import type { Timestamp } from "firebase/firestore";

const timestamp = z.custom<Timestamp>((v) => typeof (v as Timestamp | null)?.toDate === "function");

export const captureSchema = z.object({
  text: z.string().min(1).max(1000),
  platform: z.enum(["youtube", "netflix"]),
  videoTitle: z.string().max(300).default("Untitled video"),
  videoUrl: z.string().max(2048).optional(),
  videoId: z.string().nullish(),
  playbackTimeSeconds: z.number().nonnegative().default(0),
  sentences: z.array(z.string()).default([]),
  status: z.enum(["new", "processed", "dismissed"]).default("new"),
  capturedAt: timestamp.optional(),
});
export type Capture = z.infer<typeof captureSchema> & { id: string };

export function parseCapture(id: string, data: unknown): Capture | null {
  const r = captureSchema.safeParse(data);
  if (!r.success) {
    console.warn("Skipping a malformed capture", id, r.error.issues[0]?.message);
    return null;
  }
  return { id, ...r.data };
}

const line = z.object({
  id: z.string(),
  text: z.string(),
  videoTitle: z.string().optional(),
  capturedAt: z.number().optional(),
});
export type UnsavedLine = z.infer<typeof line>;

export const needsAttentionSchema = z.object({
  ok: z.literal(true),
  own: z.array(line),
  other: z.array(z.object({ accountHint: z.string(), lines: z.array(line) })),
});
export type NeedsAttention = z.infer<typeof needsAttentionSchema>;

export const pingSchema = z.object({
  ok: z.literal(true),
  protocol: z.number(),
  signedInUid: z.string().nullable(),
  authState: z.string(),
});

export const clearSchema = z.object({ ok: z.literal(true), unsaved: z.boolean().optional() });

const clip = (n: number) => z.string().trim().max(n);
// Translation content from the model (FR-AI-006). Over-long text is cut, empty or missing text is rejected.
export const translationOutputSchema = z.object({
  translation: z.string().trim().min(1, "The translation was empty.").transform((s) => s.slice(0, 600)),
  explanation: clip(100_000).nullish().transform((s) => (s ? s.slice(0, 1200) : null)),
  literalMeaningNote: clip(100_000).nullish().transform((s) => (s ? s.slice(0, 400) : null)),
});
export type TranslationContent = z.infer<typeof translationOutputSchema>;

// ---------------------------------------------------------------- learning cards

export const CATEGORIES = ["vocabulary", "idiom", "slang", "expression"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = { vocabulary: "Vocabulary", idiom: "Idiom", slang: "Slang", expression: "Expression" };
export const CATEGORY_PLURAL: Record<Category, string> = { vocabulary: "Vocabulary", idiom: "Idioms", slang: "Slang", expression: "Expressions" };

const short = (n: number) => z.string().trim().min(1).max(n);
const optional = (n: number) => z.string().trim().max(n).nullish().transform((v) => v || null);
const list = (n: number, max: number) => z.array(z.string()).transform((a) => a.map((x) => x.trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, n)));

// What the model must return for an English card (FR-AI-001). Anything else is rejected, never saved.
export const englishCardOutputSchema = z.object({
  category: z.enum(CATEGORIES),
  meaningEn: short(500),
  contextualMeaningEn: short(500),
  partOfSpeech: optional(40),
  synonyms: list(80, 6),
  exampleSentences: list(300, 4).refine((a) => a.length >= 1, "No example sentence was provided."),
  usageNote: optional(300),
  confidenceNote: optional(300),
});
export type EnglishCardContent = z.infer<typeof englishCardOutputSchema>;

export const inferenceSourceSchema = z.enum(["ON_DEVICE", "IN_CLOUD"]);
export type InferenceSource = z.infer<typeof inferenceSourceSchema>;

export const translationEntrySchema = z.object({
  translation: z.string(),
  explanation: z.string().nullish(),
  literalMeaningNote: z.string().nullish(),
  inferenceSource: inferenceSourceSchema.optional(),
  promptVersion: z.string().optional(),
});
export type TranslationEntry = z.infer<typeof translationEntrySchema>;

const reviewSchema = z.object({
  attemptCount: z.number().default(0),
  correctCount: z.number().default(0),
  incorrectCount: z.number().default(0),
  lastResult: z.enum(["correct", "incorrect"]).nullish(),
  lastReviewedAt: timestamp.nullish(),
  nextReviewAt: timestamp.nullish(),
  reviewStage: z.number().default(0),
});

export const cardSchema = z.object({
  selectedText: z.string().min(1),
  selectionKind: z.enum(["word", "phrase", "sentence"]).default("phrase"),
  selectionStart: z.number().nullish(),
  selectionEnd: z.number().nullish(),
  sourceSentence: z.string(),
  category: z.enum(CATEGORIES),
  partOfSpeech: z.string().nullish(),
  meaningEn: z.string(),
  contextualMeaningEn: z.string(),
  synonyms: z.array(z.string()).default([]),
  exampleSentences: z.array(z.string()).default([]),
  usageNote: z.string().nullish(),
  confidenceNote: z.string().nullish(),
  translations: z.record(z.string(), translationEntrySchema).default({}),
  source: z
    .object({
      platform: z.enum(["youtube", "netflix"]).optional(),
      videoId: z.string().nullish(),
      videoTitle: z.string().optional(),
      videoUrl: z.string().nullish(),
      playbackTimeSeconds: z.number().optional(),
      captureId: z.string().nullish(),
    })
    .default({}),
  ai: z.object({ englishInferenceSource: inferenceSourceSchema.optional(), englishPromptVersion: z.string().optional() }).default({}),
  review: reviewSchema.default({ attemptCount: 0, correctCount: 0, incorrectCount: 0, reviewStage: 0 }),
  createdAt: timestamp.optional(),
});
export type LearningCard = Omit<z.infer<typeof cardSchema>, "review"> & {
  id: string;
  review: { attemptCount: number; correctCount: number; incorrectCount: number; lastResult?: "correct" | "incorrect" | null; reviewStage: number; lastReviewedAt: Date | null; nextReviewAt: Date | null };
};

export function parseCard(id: string, data: unknown): LearningCard | null {
  const r = cardSchema.safeParse(data);
  if (!r.success) {
    console.warn("Skipping a malformed card", id, r.error.issues[0]?.message);
    return null;
  }
  const v = r.data;
  return { ...v, id, review: { ...v.review, lastReviewedAt: v.review.lastReviewedAt?.toDate() ?? null, nextReviewAt: v.review.nextReviewAt?.toDate() ?? null } };
}

export const reviewEventSchema = z.object({
  cardId: z.string(),
  mode: z.enum(["flashcard", "reverse", "quiz", "fill", "mistakes"]),
  result: z.enum(["correct", "incorrect"]),
  rating: z.enum(["again", "hard", "good", "easy"]).nullish(), // older reviews may carry hard or easy; new ones are again or good
  reviewedAt: timestamp,
});
export type ReviewEvent = { id: string; cardId: string; mode: string; result: "correct" | "incorrect"; rating: "again" | "hard" | "good" | "easy" | null; reviewedAt: Date };
export function parseEvent(id: string, data: unknown): ReviewEvent | null {
  const r = reviewEventSchema.safeParse(data);
  return r.success ? { id, cardId: r.data.cardId, mode: r.data.mode, result: r.data.result, rating: r.data.rating ?? null, reviewedAt: r.data.reviewedAt.toDate() } : null;
}
