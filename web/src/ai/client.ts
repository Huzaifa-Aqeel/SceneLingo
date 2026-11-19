import { getAI, GoogleAIBackend } from "firebase/ai";
import type { FirebaseApp } from "firebase/app";

// Verified live against this project: gemini-2.5-flash returns 404 (retired for new users),
// gemini-3.8-flash timed out, gemini-3.5-flash-lite answered in 3-4 s with valid JSON.
// This is only the fallback. The live value comes from Remote Config (parameter "cloud_model"),
// so a retired model can be replaced from the Firebase console without redeploying.
export const DEFAULT_CLOUD_MODEL = "gemini-3.5-flash-lite";
export const CLOUD_MODEL: string = import.meta.env?.VITE_CLOUD_MODEL || DEFAULT_CLOUD_MODEL;

// A model name is lower-case letters, digits, dots and dashes. Anything else is ignored.
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{2,60}$/;
export function resolveModel(value: unknown, fallback: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  return MODEL_NAME.test(v) ? v : fallback;
}

let current = CLOUD_MODEL;
export const getCloudModel = (): string => current;
export const setCloudModel = (value: unknown): void => { current = resolveModel(value, current); };

let instance: ReturnType<typeof getAI> | undefined;
export const getAi = (app: FirebaseApp) => (instance ??= getAI(app, { backend: new GoogleAIBackend() }));

export type Source = "ON_DEVICE" | "IN_CLOUD";
export const sourceOf = (s: string | undefined): Source => (s === "on_device" ? "ON_DEVICE" : "IN_CLOUD");
