// Firestore reads and writes for learning cards and review events.
import {
  arrayUnion, collection, deleteDoc, doc, getDoc, increment, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase";
import type { EnglishCardContent, InferenceSource, LearningCard } from "@/lib/schemas";
import { cardIdFor, normalizeText, type SelectionKind } from "@/lib/text";
import { nextReview, type Rating } from "@/lib/schedule";
import { translationKey } from "@/languages";
import type { TranslationResult } from "@/ai/translate";

const cardRef = (uid: string, id: string) => doc(db, "users", uid, "learningCards", id);

export interface NewCard {
  selectedText: string;
  selectionKind: SelectionKind;
  selectionStart: number | null;
  selectionEnd: number | null;
  sourceSentence: string;
  english: EnglishCardContent;
  englishSource: InferenceSource;
  promptVersion: string;
  translations: Record<string, TranslationResult>;
  source: { platform?: string; videoId?: string | null; videoTitle?: string; videoUrl?: string | null; playbackTimeSeconds?: number; captureId?: string | null };
}

const entryOf = (t: TranslationResult) => ({
  translation: t.translation,
  explanation: t.explanation,
  literalMeaningNote: t.literalMeaningNote,
  inferenceSource: t.inferenceSource,
  promptVersion: t.promptVersion,
  createdAt: Timestamp.now(),
});

export async function saveCard(uid: string, c: NewCard): Promise<{ id: string; existed: boolean }> {
  const id = await cardIdFor(c.selectedText, c.sourceSentence);
  const ref = cardRef(uid, id);
  const existed = (await getDoc(ref)).exists(); // same text + same sentence = same card, whatever the category says
  if (!existed) {
    await setDoc(ref, {
      selectedText: c.selectedText,
      normalizedText: normalizeText(c.selectedText),
      normalizedSourceSentence: normalizeText(c.sourceSentence),
      selectionKind: c.selectionKind,
      selectionStart: c.selectionStart,
      selectionEnd: c.selectionEnd,
      sourceSentence: c.sourceSentence,
      category: c.english.category,
      partOfSpeech: c.english.partOfSpeech,
      meaningEn: c.english.meaningEn,
      contextualMeaningEn: c.english.contextualMeaningEn,
      synonyms: c.english.synonyms,
      exampleSentences: c.english.exampleSentences,
      usageNote: c.english.usageNote,
      confidenceNote: c.english.confidenceNote,
      translations: Object.fromEntries(Object.entries(c.translations).map(([code, t]) => [translationKey(code), entryOf(t)])),
      source: {
        platform: c.source.platform ?? null,
        videoId: c.source.videoId ?? null,
        videoTitle: c.source.videoTitle ?? null,
        videoUrl: c.source.videoUrl ?? null,
        playbackTimeSeconds: c.source.playbackTimeSeconds ?? null,
        captureId: c.source.captureId ?? null,
      },
      ai: { englishInferenceSource: c.englishSource, englishPromptVersion: c.promptVersion },
      review: { attemptCount: 0, correctCount: 0, incorrectCount: 0, lastResult: null, lastReviewedAt: null, nextReviewAt: null, reviewStage: 0 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  if (c.source.captureId) {
    await updateDoc(doc(db, "users", uid, "captures", c.source.captureId), { status: "processed", savedCardIds: arrayUnion(id) });
  }
  return { id, existed };
}

export const addTranslation = (uid: string, cardId: string, t: TranslationResult) =>
  updateDoc(cardRef(uid, cardId), { [`translations.${translationKey(t.languageCode)}`]: entryOf(t), updatedAt: serverTimestamp() });

export const deleteCard = (uid: string, cardId: string) => deleteDoc(cardRef(uid, cardId));

export type PracticeMode = "flashcard" | "reverse" | "quiz" | "mistakes";

// One atomic write: the review event (history) and the card's current statistics change together or not at all.
// Only forward flashcards move a card up the ladder. In the other modes a miss sends the card back to the
// start (due in minutes) and a correct answer leaves its date alone.
export async function recordReview(uid: string, card: LearningCard, rating: Rating, mode: PracticeMode, now = new Date()): Promise<void> {
  const correct = rating !== "again";
  const moves = mode === "flashcard" || mode === "mistakes" || !correct;
  const { stage, dueAt } = nextReview(card.review.reviewStage, rating, now);
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "users", uid, "reviewEvents")), {
    cardId: card.id,
    mode,
    result: correct ? "correct" : "incorrect",
    rating,
    reviewedAt: Timestamp.fromDate(now),
    createdAt: serverTimestamp(),
  });
  batch.update(cardRef(uid, card.id), {
    "review.attemptCount": increment(1),
    "review.correctCount": increment(correct ? 1 : 0),
    "review.incorrectCount": increment(correct ? 0 : 1),
    "review.lastResult": correct ? "correct" : "incorrect",
    "review.lastReviewedAt": Timestamp.fromDate(now),
    ...(moves ? { "review.nextReviewAt": Timestamp.fromDate(dueAt), "review.reviewStage": stage } : {}),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}
