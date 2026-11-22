// The logic of a spoken conversation, kept apart from the screen so it can be tested.
import { termRanges, usesTerm } from "./usesTerm";

export interface Line { who: "partner" | "learner"; text: string }

export const MAX_TURNS = 3;      // how many times the learner speaks
export const MAX_SILENCES = 2;   // quiet turns in a row before the conversation ends

export const learnerLines = (lines: readonly Line[]): string[] => lines.filter((l) => l.who === "learner").map((l) => l.text);

export function transcript(lines: readonly Line[], partnerName: string): string {
  return lines.map((l) => `${l.who === "partner" ? partnerName : "Learner"}: ${l.text}`).join("\n");
}

export type Outcome = "used" | "similar" | "missed";

// The words were used only if the learner's own lines contain them (checked here, never taken from the model).
export function outcomeOf(lines: readonly Line[], target: string, kind: string, similarExpression: string | null): Outcome {
  const said = learnerLines(lines);
  if (said.some((t) => usesTerm(t, target, kind))) return "used";
  return similarExpression ? "similar" : "missed";
}

export const ratingOf = (o: Outcome): "good" | "again" => (o === "missed" ? "again" : "good");

// A line split into pieces so the words the learner used can be shown in bold.
export function marked(text: string, target: string): { text: string; on: boolean }[] {
  const out: { text: string; on: boolean }[] = [];
  let at = 0;
  for (const [a, b] of termRanges(text, target)) {
    if (a > at) out.push({ text: text.slice(at, a), on: false });
    out.push({ text: text.slice(a, b), on: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), on: false });
  return out.length ? out : [{ text, on: false }];
}

// The partner lines spoken when the learner says nothing.
export const NUDGES = ["Sorry, I didn't catch that.", "Are you still there?"];

export const headline = (o: Outcome): string => (o === "used" ? "You used it" : o === "similar" ? "You said it another way" : "Not this time");
