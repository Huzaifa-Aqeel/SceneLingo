// "Talk it out": a short spoken scene in which the learner has a reason to use a saved expression.
// Three model tasks, all hybrid (the device first, the cloud as fallback):
//   makeScene   one structured request: a situation, a partner, and the partner's first line
//   replyStream the partner's answers, streamed so they can be spoken sentence by sentence
//   judge       one structured request at the end: how well the learner did
// What the learner said is never judged by the model alone: whether the words were used is checked in code.
import { getGenerativeModel, InferenceMode, Schema } from "firebase/ai";
import type { FirebaseApp } from "firebase/app";
import { z } from "zod";
import { usesTerm } from "@/lib/usesTerm";
import { learnerLines, transcript, type Line } from "@/lib/talk";
import type { Seed } from "@/lib/scenarios";
import { getAi, getCloudModel } from "./client";
import { askHybrid, streamHybrid } from "./hybrid";

export const CONVERSATION_PROMPT_VERSION = "1.0";

export interface TalkCard {
  selectedText: string;
  selectionKind: string;
  category: string;
  meaningEn: string;
  contextualMeaningEn: string;
  sourceSentence: string;
  videoTitle?: string;
}

// ---------------------------------------------------------------- shared configuration
const onDevice = (schema?: unknown) => ({
  createOptions: {
    expectedInputs: [{ type: "text" as const, languages: ["en"] }],
    expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
  },
  ...(schema ? { promptOptions: { responseConstraint: schema } } : {}),
});

export function structuredConfig(schema: ReturnType<typeof Schema.object>, cloudModel = getCloudModel()) {
  return {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: onDevice(schema),
    inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: "application/json", responseSchema: schema } },
  };
}

export function chatConfig(cloudModel = getCloudModel()) {
  return {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: onDevice(),
    inCloudParams: { model: cloudModel, generationConfig: { temperature: 0.9, maxOutputTokens: 200 } },
  };
}

const cloudOnly = (app: FirebaseApp, inCloudParams: { model: string }) =>
  () => getGenerativeModel(getAi(app), { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams } as never);

const target = (c: TalkCard) => c.selectedText.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");

// ---------------------------------------------------------------- the scene
export const sceneSchema = () =>
  Schema.object({
    properties: {
      settingNumber: Schema.integer(),
      situation: Schema.string(),
      partnerName: Schema.string(),
      partnerRole: Schema.string(),
      openingLine: Schema.string(),
    },
  });

const sceneOutput = z.object({
  settingNumber: z.number().int().min(1).max(9).default(1),
  situation: z.string().trim().min(10).max(320),
  partnerName: z.string().trim().min(1).max(30),
  partnerRole: z.string().trim().min(3).max(60),
  openingLine: z.string().trim().min(3).max(240),
});
export type Scene = Omit<z.infer<typeof sceneOutput>, "settingNumber"> & { seedKey: string; setting: string };

export function buildScenePrompt(card: TalkCard, seeds: readonly Seed[]): string {
  const t = target(card);
  return [
    `You write short, realistic scenes for people learning English to practise speaking out loud.`,
    `Settings to choose from (pick the ONE where the expression below would feel most natural):`,
    ...seeds.map((s, i) => `${i + 1}. ${s.setting}`),
    `The learner is practising this expression: "${t}" (meaning: ${card.meaningEn}).`,
    `Write a scene in that setting where saying it would feel natural, but where a good answer is not forced. Never put the expression, or a near copy of it, in the scene.`,
    `The learner first met the expression in a different scene (${card.videoTitle ? `the video "${card.videoTitle}", ` : ""}the line "${card.sourceSentence}"). Do not reuse that scene, its topic, or its characters.`,
    ``,
    `Return:`,
    `- settingNumber: the number of the setting you chose.`,
    `- situation: one or two short sentences in the second person ("You are ..."), telling the learner where they are and what is happening. Plain English.`,
    `- partnerName: a common first name.`,
    `- partnerRole: who the partner is to the learner, in a few words (for example "your manager").`,
    `- openingLine: what the partner says first, at most 25 words, natural spoken English, ending in a way the learner can answer.`,
  ].join("\n");
}

export function validateScene(raw: unknown, card: TalkCard, seeds: readonly Seed[], opts: { lenient?: boolean } = {}): Scene {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { throw new Error("invalid_format"); } }
  const r = sceneOutput.safeParse(obj);
  if (!r.success) throw new Error("invalid_scene");
  const t = target(card);
  // The first line must not hand the answer over.
  if (!opts.lenient && (usesTerm(r.data.openingLine, t, card.selectionKind) || usesTerm(r.data.situation, t, card.selectionKind))) throw new Error("scene_gives_the_answer_away");
  const seed = seeds[r.data.settingNumber - 1] ?? seeds[0]!; // an out-of-range choice falls back to the first
  const { settingNumber: _n, ...scene } = r.data;
  return { ...scene, seedKey: seed.key, setting: seed.setting };
}

export async function makeScene({ app, card, seeds }: { app: FirebaseApp; card: TalkCard; seeds: readonly Seed[] }): Promise<Scene> {
  const config = structuredConfig(sceneSchema());
  const prompt = buildScenePrompt(card, seeds);
  const { value } = await askHybrid({
    hybrid: getGenerativeModel(getAi(app), config),
    cloud: cloudOnly(app, config.inCloudParams),
    prompt,
    retryPrompt: `${prompt}\nImportant: neither the situation nor the opening line may contain "${target(card)}" or a form of it.`,
    parse: (t) => validateScene(t, card, seeds),
    lenient: (t) => validateScene(t, card, seeds, { lenient: true }),
  });
  return value;
}

// ---------------------------------------------------------------- the partner's replies
export function buildReplyPrompt(scene: Scene, card: TalkCard, lines: readonly Line[], last: boolean): string {
  return [
    `You are ${scene.partnerName}, ${scene.partnerRole}. Situation: ${scene.situation}`,
    `You are talking out loud with someone who is learning English.`,
    `Rules: stay in the role. Reply in one or two short, natural sentences, in plain everyday English, as people speak. Never mention being an AI, a lesson, or any phrase to practise. Do not correct their English. React to what they just said. Never use the words "${target(card)}" yourself.`,
    last ? `This is the last thing you say: close the conversation naturally and warmly in one short sentence, with no question.` : `Keep the conversation going with a comment or a short question.`,
    ``,
    `The conversation so far:`,
    transcript(lines, scene.partnerName),
    ``,
    `Write only what ${scene.partnerName} says next.`,
  ].join("\n");
}

export async function replyStream({ app, scene, card, lines, last, onText, isCancelled }: { app: FirebaseApp; scene: Scene; card: TalkCard; lines: readonly Line[]; last: boolean; onText: (chunk: string) => void; isCancelled?: () => boolean }): Promise<string> {
  const config = chatConfig();
  const { text } = await streamHybrid({
    hybrid: getGenerativeModel(getAi(app), config),
    cloud: cloudOnly(app, config.inCloudParams),
    prompt: buildReplyPrompt(scene, card, lines, last),
    onText,
    isCancelled,
  });
  return text.trim();
}

// ---------------------------------------------------------------- the verdict
export const judgeSchema = () =>
  Schema.object({
    properties: {
      understoodSituation: Schema.enumString({ enum: ["yes", "partly", "no"] }),
      similarExpression: Schema.string(),
      fit: Schema.enumString({ enum: ["natural", "awkward", "off"] }),
      feedback: Schema.string(),
      betterVersion: Schema.string(),
    },
    optionalProperties: ["similarExpression"],
  });

const judgeOutput = z.object({
  understoodSituation: z.enum(["yes", "partly", "no"]),
  similarExpression: z.string().trim().max(120).nullish(),
  fit: z.enum(["natural", "awkward", "off"]),
  feedback: z.string().trim().min(1).max(400),
  betterVersion: z.string().trim().max(240).default(""),
});
export type Verdict = Omit<z.infer<typeof judgeOutput>, "similarExpression"> & { similarExpression: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

export function buildJudgePrompt(scene: Scene, card: TalkCard, lines: readonly Line[]): string {
  return [
    `You are a kind English speaking coach. A learner just had a spoken conversation to practise using an expression. The text below was typed by speech recognition, so tiny mishearings are possible.`,
    `Expression: "${target(card)}" (meaning: ${card.meaningEn}).`,
    `Situation: ${scene.situation} The partner was ${scene.partnerName}, ${scene.partnerRole}.`,
    ``,
    transcript(lines, scene.partnerName),
    ``,
    `Judge the learner's lines only. Refer to the expression by its words, never as "the target". Return:`,
    `- understoodSituation: "yes" if their answers fit the situation, "partly", or "no".`,
    `- similarExpression: if they did not use the expression but said something with the same idea, copy those exact words from their lines; otherwise leave it out. Never invent words they did not say.`,
    `- fit: how natural their English sounded in this situation ("natural", "awkward", "off").`,
    `- feedback: one or two short, specific, encouraging sentences. Mention what worked and one thing to improve. No lists.`,
    `- betterVersion: one natural sentence they could have said in this situation using the expression "${target(card)}".`,
  ].join("\n");
}

export function validateVerdict(raw: unknown, lines: readonly Line[]): Verdict {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { throw new Error("invalid_format"); } }
  const r = judgeOutput.safeParse(obj);
  if (!r.success) throw new Error("invalid_verdict");
  // The model may only point to words the learner really said.
  const said = norm(learnerLines(lines).join(" . "));
  const sim = r.data.similarExpression ? r.data.similarExpression.trim() : "";
  return { ...r.data, similarExpression: sim && norm(sim).length > 2 && said.includes(norm(sim)) ? sim : null };
}

export async function judge({ app, scene, card, lines }: { app: FirebaseApp; scene: Scene; card: TalkCard; lines: readonly Line[] }): Promise<Verdict> {
  const config = structuredConfig(judgeSchema());
  const { value } = await askHybrid({
    hybrid: getGenerativeModel(getAi(app), config),
    cloud: cloudOnly(app, config.inCloudParams),
    prompt: buildJudgePrompt(scene, card, lines),
    parse: (t) => validateVerdict(t, lines),
  });
  return value;
}
