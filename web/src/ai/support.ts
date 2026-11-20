// Which translation languages can the on-device model handle on THIS device? (FR-AI-011)
// Detected at runtime from the Chrome Prompt API. Never hard-coded: the documented list is growing
// and differs by Chrome version and device.

export type Availability = "available" | "downloadable" | "downloading" | "unavailable";
export type Route = "NONE" | "PREFER_ON_DEVICE" | "ONLY_IN_CLOUD";
export type SupportMap = Record<string, Availability>;

export interface LanguageModelLike {
  availability(options: {
    expectedInputs: { type: "text"; languages: string[] }[];
    expectedOutputs: { type: "text"; languages: string[] }[];
  }): Promise<string>;
}

export const ON_DEVICE_STATES: ReadonlySet<string> = new Set(["available", "downloadable", "downloading"]);

// Documented list, only a hint for the UI before the probe finishes. It never decides routing.
export const DOCUMENTED_ON_DEVICE = ["ja", "es", "de", "fr"];

export const hasPromptApi = (g: { LanguageModel?: { availability?: unknown } } = globalThis as never): boolean =>
  typeof g.LanguageModel?.availability === "function";

// Resolves to an availability state. Never throws: the Prompt API rejects unsupported languages,
// and that simply means "use the cloud".
export async function probeLanguage(LM: LanguageModelLike, code: string): Promise<Availability> {
  try {
    const state = await LM.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: [code] }],
    });
    return ON_DEVICE_STATES.has(state) ? (state as Availability) : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function probeLanguages(LM: LanguageModelLike, codes: string[]): Promise<SupportMap> {
  const entries = await Promise.all(codes.map(async (c) => [c, await probeLanguage(LM, c)] as const));
  return Object.fromEntries(entries);
}

// The single place that decides where a translation runs.
//   NONE              English learners need no translation
//   PREFER_ON_DEVICE  the model supports this language here (cloud fallback is automatic)
//   ONLY_IN_CLOUD     unsupported, not probed yet, or no Prompt API in this browser
export function routeFor(code: string | undefined, support: SupportMap | null | undefined, promptApiPresent: boolean): Route {
  if (!code || code === "en" || code.startsWith("en-")) return "NONE";
  if (!promptApiPresent) return "ONLY_IN_CLOUD";
  const state = support?.[code];
  return state && ON_DEVICE_STATES.has(state) ? "PREFER_ON_DEVICE" : "ONLY_IN_CLOUD";
}

// `state` is the probe result for the language: until the model is actually here, the cloud answers.
export function whereItRuns(route: Route, state?: Availability): string {
  if (route === "PREFER_ON_DEVICE") return state === "available" ? "On this device" : "On this device once downloaded";
  return route === "ONLY_IN_CLOUD" ? "In the cloud" : "";
}
